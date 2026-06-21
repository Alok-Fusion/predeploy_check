'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { run } = require('../checks/05-env-vars');

function withTempProject(files, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy-test-'));
  try {
    for (const [filename, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, filename), content);
    }
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('skips when no JS/TS files exist', async () => {
  await withTempProject({}, async (dir) => {
    const result = await run(dir);
    assert.equal(result.status, 'skip');
  });
});

test('passes when no custom env vars are referenced', async () => {
  await withTempProject(
    { 'index.js': "console.log(process.env.NODE_ENV);\n" },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('warns when env vars are referenced but no .env file exists at all', async () => {
  await withTempProject(
    { 'index.js': "const key = process.env.API_KEY;\n" },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.match(result.message, /no \.env \/ \.env\.example file found/);
    }
  );
});

test('passes when a referenced var is declared in .env.example', async () => {
  await withTempProject(
    {
      'index.js': "const key = process.env.API_KEY;\n",
      '.env.example': 'API_KEY=\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('warns when a referenced var is missing from an existing .env.example', async () => {
  await withTempProject(
    {
      'index.js': "const key = process.env.API_KEY;\nconst secret = process.env.SECRET_TOKEN;\n",
      '.env.example': 'API_KEY=\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.match(result.message, /1 env var/);
      assert.match(result.details[0].message, /SECRET_TOKEN/);
    }
  );
});

test('supports bracket notation process.env["VAR"]', async () => {
  await withTempProject(
    { 'index.js': "const key = process.env['API_KEY'];\n" },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.match(result.details[0].message, /API_KEY/);
    }
  );
});

test('ignores references inside comment lines', async () => {
  await withTempProject(
    { 'index.js': "// const key = process.env.IGNORED_VAR;\nconsole.log('hi');\n" },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});
