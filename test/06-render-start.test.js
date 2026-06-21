'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { run } = require('../checks/06-render-start');

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

test('skips when there is no package.json and no requirements.txt', async () => {
  await withTempProject({}, async (dir) => {
    const result = await run(dir);
    assert.equal(result.status, 'skip');
  });
});

// ── Node.js paths ──

test('Node: passes when a start script exists', async () => {
  await withTempProject(
    { 'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }) },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('Node: passes when a Procfile exists, even without a start script', async () => {
  await withTempProject(
    {
      'package.json': JSON.stringify({ name: 'app' }),
      Procfile: 'web: node server.js\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('Node: warns when only "main" is set, no start script', async () => {
  await withTempProject(
    {
      'package.json': JSON.stringify({ main: 'server.js' }),
      'server.js': 'console.log("hi");\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
    }
  );
});

test('Node: fails when nothing indicates how to start the app', async () => {
  await withTempProject(
    { 'package.json': JSON.stringify({ name: 'app' }) },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'fail');
    }
  );
});

test('Node: passes when render.yaml has a startCommand', async () => {
  await withTempProject(
    {
      'package.json': JSON.stringify({ name: 'app' }),
      'render.yaml': 'services:\n  - type: web\n    startCommand: node server.js\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

// ── Python paths ──

test('Python: passes with a Procfile containing a web process', async () => {
  await withTempProject(
    {
      'requirements.txt': 'fastapi==0.100.0\n',
      Procfile: 'web: gunicorn app:app\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('Python: fails when no Procfile or render.yaml exists', async () => {
  await withTempProject(
    {
      'requirements.txt': 'fastapi==0.100.0\n',
      'main.py': 'print("hi")\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'fail');
      assert.match(result.details[0].message, /main\.py/);
    }
  );
});

test('Python: passes when render.yaml exists', async () => {
  await withTempProject(
    {
      'requirements.txt': 'fastapi==0.100.0\n',
      'render.yaml': 'services:\n  - type: web\n    startCommand: uvicorn app:app\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});
