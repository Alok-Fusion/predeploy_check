'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { run } = require('../checks/03-case-sensitivity');

function withTempProject(files, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy-test-'));
  try {
    for (const [filename, content] of Object.entries(files)) {
      const fullPath = path.join(dir, filename);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
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

test('passes when import casing exactly matches the file on disk', async () => {
  await withTempProject(
    {
      'index.js': "const utils = require('./utils');\n",
      'utils.js': 'module.exports = {};\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('flags an import whose casing differs from the actual filename', async () => {
  await withTempProject(
    {
      'index.js': "const utils = require('./Utils');\n",
      'utils.js': 'module.exports = {};\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.equal(result.details.length, 1);
      assert.match(result.details[0].message, /utils\.js/);
    }
  );
});

test('flags a case mismatch in a directory name used for an index import', async () => {
  await withTempProject(
    {
      'index.js': "const helpers = require('./Helpers');\n",
      'helpers/index.js': 'module.exports = {};\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
    }
  );
});

test('does not flag imports that resolve to a file extension mismatch only (no case issue)', async () => {
  await withTempProject(
    {
      'index.ts': "import { foo } from './missing';\n",
    },
    async (dir) => {
      const result = await run(dir);
      // "missing" doesn't exist at all under any case — not a case-sensitivity issue
      assert.equal(result.status, 'pass');
    }
  );
});

test('skips node_modules and other ignored directories', async () => {
  await withTempProject(
    {
      'index.js': "const x = require('./utils');\n",
      'utils.js': 'module.exports = {};\n',
      'node_modules/some-pkg/Index.js': 'module.exports = {};\n',
    },
    async (dir) => {
      const result = await run(dir);
      // Only index.js + utils.js should count toward the scanned total (2),
      // node_modules contents must not be scanned or counted.
      assert.equal(result.status, 'pass');
      assert.match(result.message, /all 2 files checked/);
    }
  );
});
