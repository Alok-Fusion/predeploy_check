'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { run } = require('../checks/02-eslint-vercel');

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

function pkgJson(deps) {
  return JSON.stringify({ name: 'test-app', version: '1.0.0', dependencies: deps });
}

test('skips when no package.json exists', async () => {
  await withTempProject({}, async (dir) => {
    const result = await run(dir);
    assert.equal(result.status, 'skip');
  });
});

test('fails gracefully on malformed package.json', async () => {
  await withTempProject({ 'package.json': '{ not valid json' }, async (dir) => {
    const result = await run(dir);
    assert.equal(result.status, 'fail');
    assert.match(result.message, /could not parse/);
  });
});

test('skips when project has no next dependency', async () => {
  await withTempProject(
    { 'package.json': pkgJson({ express: '^4.0.0' }) },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'skip');
      assert.match(result.message, /not a Next\.js project/);
    }
  );
});

test('passes when eslint-config-next matches next major version', async () => {
  await withTempProject(
    {
      'package.json': pkgJson({
        next: '^14.0.0',
        eslint: '^8.57.0',
        'eslint-config-next': '^14.0.0',
      }),
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('fails when eslint-config-next major version does not match next', async () => {
  await withTempProject(
    {
      'package.json': pkgJson({
        next: '^14.0.0',
        eslint: '^8.57.0',
        'eslint-config-next': '^12.0.0',
      }),
    },
    async (dir) => {
      const results = await run(dir);
      const arr = Array.isArray(results) ? results : [results];
      assert.ok(arr.some((r) => r.status === 'fail'));
    }
  );
});

test('warns on ESLint 9+ with older eslint-config-next', async () => {
  await withTempProject(
    {
      'package.json': pkgJson({
        next: '^14.0.0',
        eslint: '^9.0.0',
        'eslint-config-next': '^14.0.0',
      }),
    },
    async (dir) => {
      const results = await run(dir);
      const arr = Array.isArray(results) ? results : [results];
      assert.ok(arr.some((r) => r.status === 'warn'));
    }
  );
});

test('warns on deprecated ignoreDuringBuilds with Next 16+', async () => {
  await withTempProject(
    {
      'package.json': pkgJson({ next: '^16.0.0' }),
      'next.config.js': 'module.exports = { eslint: { ignoreDuringBuilds: true } }',
    },
    async (dir) => {
      const results = await run(dir);
      const arr = Array.isArray(results) ? results : [results];
      assert.ok(arr.some((r) => r.status === 'warn' && /ignoreDuringBuilds/.test(r.message)));
    }
  );
});

test('does not flag ignoreDuringBuilds on Next versions below 16', async () => {
  await withTempProject(
    {
      'package.json': pkgJson({ next: '^14.0.0' }),
      'next.config.js': 'module.exports = { eslint: { ignoreDuringBuilds: true } }',
    },
    async (dir) => {
      const result = await run(dir);
      // Next 14 + no eslint/eslint-config-next deps means nothing to flag
      assert.equal(result.status, 'pass');
    }
  );
});
