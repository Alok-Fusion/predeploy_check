'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { run } = require('../checks/07-railway');

function withTempProject(files, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy-railway-test-'));
  try {
    for (const [filename, content] of Object.entries(files)) {
      const fullPath = path.join(dir, filename);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(
        fullPath,
        typeof content === 'string' ? content : JSON.stringify(content, null, 2)
      );
    }
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Skip detection ──

test('skips when no Railway config files are present', async () => {
  await withTempProject(
    { 'package.json': { name: 'app', scripts: { start: 'node server.js' } } },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'skip');
    }
  );
});

test('does not skip when railway.toml exists', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n[deploy]\nstartCommand = "node server.js"\n',
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': 'const PORT = process.env.PORT || 3000;\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.notEqual(result.status, 'skip');
    }
  );
});

test('does not skip when railway.json exists', async () => {
  await withTempProject(
    {
      'railway.json': JSON.stringify({ build: { builder: 'nixpacks' } }),
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': 'const PORT = process.env.PORT || 3000;\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.notEqual(result.status, 'skip');
    }
  );
});

test('does not skip when nixpacks.toml exists', async () => {
  await withTempProject(
    {
      'nixpacks.toml': '[phases.build]\ncmds = ["npm install"]\n',
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
    },
    async (dir) => {
      const result = await run(dir);
      assert.notEqual(result.status, 'skip');
    }
  );
});

// ── Check 1: hardcoded port ──

test('fails when app listens on a hardcoded port without $PORT fallback', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n',
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': 'app.listen(3000, () => console.log("running"));\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'fail');
      assert.ok(result.details.some((d) => d.message.includes('Hardcoded port 3000')));
    }
  );
});

test('passes when app uses process.env.PORT correctly', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n',
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('does not flag ports used in comments', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n',
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': '// app.listen(3000) — old way\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

// ── Check 2: invalid builder ──

test('fails when railway.toml has an invalid builder value', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "node"\n',
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'fail');
      assert.ok(result.details.some((d) => d.message.includes('Invalid builder "node"')));
    }
  );
});

test('passes when railway.toml has a valid builder value', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n[deploy]\nstartCommand = "node server.js"\n',
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('fails when railway.json has an invalid builder value', async () => {
  await withTempProject(
    {
      'railway.json': JSON.stringify({ build: { builder: 'auto' } }),
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'fail');
      assert.ok(result.details.some((d) => d.message.includes('Invalid builder "auto"')));
    }
  );
});

test('accepts all four valid Railway builder values', async () => {
  for (const builder of ['nixpacks', 'dockerfile', 'heroku', 'railpack']) {
    await withTempProject(
      {
        'railway.toml': `[build]\nbuilder = "${builder}"\n[deploy]\nstartCommand = "node server.js"\n`,
        'package.json': { name: 'app', scripts: { start: 'node server.js' } },
        'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
      },
      async (dir) => {
        const result = await run(dir);
        assert.ok(
          result.status !== 'fail' || !result.details.some((d) => d.message.includes('Invalid builder')),
          `Builder "${builder}" should be valid but was flagged`
        );
      }
    );
  }
});

// ── Check 3: Nixpacks build plan detection ──

test('warns when no package.json, requirements.txt, or nixpacks.toml exists', async () => {
  await withTempProject(
    { 'railway.toml': '[build]\nbuilder = "nixpacks"\n' },
    async (dir) => {
      const result = await run(dir);
      assert.ok(['warn', 'fail'].includes(result.status));
      assert.ok(result.details.some((d) => d.message.includes('Nixpacks may be unable to detect')));
    }
  );
});

test('does not warn about Nixpacks detection when nixpacks.toml exists', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n',
      'nixpacks.toml': 'providers = ["node"]\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.ok(!result.details || !result.details.some((d) => d.message.includes('Nixpacks may be unable to detect')));
    }
  );
});

// ── Check 4: monorepo detection ──

test('warns on a monorepo structure without explicit root config', async () => {
  await withTempProject(
    {
      // railway.json at root makes this a Railway project,
      // but no explicit subdirectory routing configured
      'railway.json': JSON.stringify({ build: { builder: 'nixpacks' } }),
      'package.json': { name: 'root' },
      'frontend/package.json': { name: 'frontend', scripts: { start: 'node index.js' } },
      'backend/package.json': { name: 'backend', scripts: { start: 'node server.js' } },
      // No nixpacks.toml at root and no startCommand — Nixpacks won't know
      // which subdirectory to build without explicit configuration
    },
    async (dir) => {
      const result = await run(dir);
      assert.ok(['warn', 'fail'].includes(result.status));
      assert.ok(result.details.some((d) => d.message.includes('monorepo')));
    }
  );
});

test('does not flag monorepo when railway.toml has explicit watchPaths', async () => {
  await withTempProject(
    {
      'package.json': { name: 'root', scripts: { start: 'node server.js' } },
      'frontend/package.json': { name: 'frontend' },
      'backend/package.json': { name: 'backend' },
      'railway.toml': '[build]\nbuilder = "nixpacks"\nwatchPaths = ["backend/**"]\n[deploy]\nstartCommand = "node server.js"\n',
      'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.ok(!result.details || !result.details.some((d) => d.message.includes('monorepo')));
    }
  );
});

// ── Check 5: start command ──

test('warns when no start script and no config provides a start command', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n',
      'package.json': { name: 'app' }, // no start script
      'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.ok(['warn', 'fail'].includes(result.status));
      assert.ok(result.details.some((d) => d.message.includes('No "start" script')));
    }
  );
});

test('passes when railway.toml provides a startCommand', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n[deploy]\nstartCommand = "node server.js"\n',
      'package.json': { name: 'app' }, // no start script — but config covers it
      'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.ok(!result.details || !result.details.some((d) => d.message.includes('No "start" script')));
    }
  );
});

// ── Clean project passes all checks ──

test('passes cleanly on a correctly configured Railway project', async () => {
  await withTempProject(
    {
      'railway.toml': '[build]\nbuilder = "nixpacks"\n[deploy]\nstartCommand = "node server.js"\n',
      'package.json': { name: 'app', scripts: { start: 'node server.js' } },
      'server.js': 'const PORT = process.env.PORT || 3000;\napp.listen(PORT, () => console.log("listening"));\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});
