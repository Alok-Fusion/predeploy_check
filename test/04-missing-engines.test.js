'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { run } = require('../checks/04-missing-engines');

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

test('skips when no package.json exists', async () => {
  await withTempProject({}, async (dir) => {
    const result = await run(dir);
    assert.equal(result.status, 'skip');
  });
});

test('fails gracefully on malformed package.json', async () => {
  await withTempProject({ 'package.json': '{ broken' }, async (dir) => {
    const result = await run(dir);
    assert.equal(result.status, 'fail');
  });
});

test('warns when engines field is entirely missing', async () => {
  await withTempProject(
    { 'package.json': JSON.stringify({ name: 'app' }) },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.match(result.message, /no "engines" field/);
    }
  );
});

test('warns when engines exists but node is not specified', async () => {
  await withTempProject(
    { 'package.json': JSON.stringify({ name: 'app', engines: { npm: '>=9.0.0' } }) },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.match(result.message, /no "node" version specified/);
    }
  );
});

test('passes when engines.node is specified', async () => {
  await withTempProject(
    { 'package.json': JSON.stringify({ name: 'app', engines: { node: '>=18.0.0' } }) },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
      assert.match(result.message, />=18\.0\.0/);
    }
  );
});
