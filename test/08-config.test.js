'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  loadConfig,
  isCheckEnabled,
  getCheckOptions,
  isIgnored,
  DEFAULT_CONFIG,
  VALID_CHECK_IDS,
} = require('../config');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

function withTempProject(files, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy-config-test-'));
  try {
    for (const [filename, content] of Object.entries(files)) {
      const fullPath = path.join(dir, filename);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content));
    }
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args, cwd) {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], { cwd, encoding: 'utf-8' });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status };
  }
}

// ── loadConfig ──

test('returns default config when no predeploy.config.js exists', () => {
  withTempProject({}, (dir) => {
    const config = loadConfig(dir);
    assert.equal(config.loaded, false);
    assert.equal(config.configPath, null);
    assert.deepEqual(config.ignore, []);
    assert.deepEqual(config.options, {});
    // All checks enabled by default
    for (const id of VALID_CHECK_IDS) {
      assert.equal(config.checks[id], true);
    }
  });
});

test('loads a valid partial config and merges it with defaults', () => {
  withTempProject(
    {
      'predeploy.config.js': `module.exports = { checks: { 'python-render': false } };`,
    },
    (dir) => {
      const config = loadConfig(dir);
      assert.equal(config.loaded, true);
      assert.equal(config.checks['python-render'], false);
      // All other checks should still be enabled (merged from defaults)
      assert.equal(config.checks['eslint-vercel'], true);
      assert.equal(config.checks['env-vars'], true);
    }
  );
});

test('loads ignore patterns correctly', () => {
  withTempProject(
    {
      'predeploy.config.js': `module.exports = { ignore: ['legacy/', 'old/script.js'] };`,
    },
    (dir) => {
      const config = loadConfig(dir);
      assert.deepEqual(config.ignore, ['legacy/', 'old/script.js']);
    }
  );
});

test('loads check-specific options correctly', () => {
  withTempProject(
    {
      'predeploy.config.js': `
        module.exports = {
          options: {
            'env-vars': { envFiles: ['.env.production'] },
          }
        };
      `,
    },
    (dir) => {
      const config = loadConfig(dir);
      assert.deepEqual(config.options['env-vars'], { envFiles: ['.env.production'] });
    }
  );
});

test('throws a clear error when config file has a syntax error', () => {
  withTempProject(
    { 'predeploy.config.js': `module.exports = { this is not valid js` },
    (dir) => {
      assert.throws(
        () => loadConfig(dir),
        (err) => {
          assert.match(err.message, /Failed to load predeploy\.config\.js/);
          return true;
        }
      );
    }
  );
});

test('throws a clear error when config exports an array instead of an object', () => {
  withTempProject(
    { 'predeploy.config.js': `module.exports = ['python-render'];` },
    (dir) => {
      assert.throws(
        () => loadConfig(dir),
        (err) => {
          assert.match(err.message, /must export a plain object/);
          return true;
        }
      );
    }
  );
});

test('throws a clear error listing the unknown check IDs when they appear in config', () => {
  withTempProject(
    {
      'predeploy.config.js': `
        module.exports = { checks: { 'nonexistent-check': false, 'another-fake': true } };
      `,
    },
    (dir) => {
      assert.throws(
        () => loadConfig(dir),
        (err) => {
          assert.match(err.message, /unknown check ID/);
          assert.match(err.message, /nonexistent-check/);
          assert.match(err.message, /another-fake/);
          return true;
        }
      );
    }
  );
});

test('throws a clear error when "ignore" is not an array', () => {
  withTempProject(
    { 'predeploy.config.js': `module.exports = { ignore: 'legacy/' };` },
    (dir) => {
      assert.throws(
        () => loadConfig(dir),
        (err) => {
          assert.match(err.message, /"ignore" must be an array/);
          return true;
        }
      );
    }
  );
});

test('throws a clear error when "checks" is not a plain object', () => {
  withTempProject(
    { 'predeploy.config.js': `module.exports = { checks: ['python-render'] };` },
    (dir) => {
      assert.throws(
        () => loadConfig(dir),
        (err) => {
          assert.match(err.message, /"checks" must be a plain object/);
          return true;
        }
      );
    }
  );
});

// ── isCheckEnabled ──

test('isCheckEnabled: returns true for checks not mentioned in config', () => {
  const config = { checks: { 'python-render': false } };
  assert.equal(isCheckEnabled(config, '02-eslint-vercel.js'), true);
});

test('isCheckEnabled: returns false for explicitly disabled checks', () => {
  const config = { checks: { 'python-render': false } };
  assert.equal(isCheckEnabled(config, '01-python-render.js'), false);
});

test('isCheckEnabled: returns true for explicitly enabled checks', () => {
  const config = { checks: { 'env-vars': true } };
  assert.equal(isCheckEnabled(config, '05-env-vars.js'), true);
});

// ── getCheckOptions ──

test('getCheckOptions: returns empty object when no options defined for a check', () => {
  const config = { options: {} };
  assert.deepEqual(getCheckOptions(config, '01-python-render.js'), {});
});

test('getCheckOptions: returns the specific options when defined', () => {
  const config = { options: { 'env-vars': { envFiles: ['.env.prod'] } } };
  assert.deepEqual(getCheckOptions(config, '05-env-vars.js'), { envFiles: ['.env.prod'] });
});

// ── isIgnored ──

test('isIgnored: returns false when ignore list is empty', () => {
  withTempProject({}, (dir) => {
    const config = { ignore: [] };
    assert.equal(isIgnored(config, path.join(dir, 'src/index.js'), dir), false);
  });
});

test('isIgnored: matches exact file paths', () => {
  withTempProject({}, (dir) => {
    const config = { ignore: ['scripts/old-deploy.js'] };
    assert.equal(isIgnored(config, path.join(dir, 'scripts/old-deploy.js'), dir), true);
    assert.equal(isIgnored(config, path.join(dir, 'scripts/new-deploy.js'), dir), false);
  });
});

test('isIgnored: matches directory prefixes with trailing slash', () => {
  withTempProject({}, (dir) => {
    const config = { ignore: ['legacy/'] };
    assert.equal(isIgnored(config, path.join(dir, 'legacy/old-check.js'), dir), true);
    assert.equal(isIgnored(config, path.join(dir, 'legacy/nested/deep.js'), dir), true);
    assert.equal(isIgnored(config, path.join(dir, 'src/legacy/file.js'), dir), false);
  });
});

test('isIgnored: matches directory prefixes without trailing slash', () => {
  withTempProject({}, (dir) => {
    const config = { ignore: ['legacy'] };
    assert.equal(isIgnored(config, path.join(dir, 'legacy/old-check.js'), dir), true);
    assert.equal(isIgnored(config, path.join(dir, 'not-legacy/file.js'), dir), false);
  });
});

// ── End-to-end CLI integration ──

test('CLI respects config: disabled check shows as skipped', () => {
  withTempProject(
    {
      'predeploy.config.js': `module.exports = { checks: { 'missing-engines': false, 'render-start': false } };`,
      'package.json': JSON.stringify({ name: 'test-app', scripts: {} }),
    },
    (dir) => {
      const { stdout } = runCli([dir], dir);
      assert.match(stdout, /disabled in predeploy\.config\.js/);
    }
  );
});

test('CLI shows config-loaded notice when predeploy.config.js exists', () => {
  withTempProject(
    {
      'predeploy.config.js': `module.exports = {};`,
      'package.json': JSON.stringify({ name: 'test-app' }),
    },
    (dir) => {
      const { stdout } = runCli([dir], dir);
      assert.match(stdout, /predeploy\.config\.js loaded/);
    }
  );
});

test('CLI --json includes configFile path when config is present', () => {
  withTempProject(
    {
      'predeploy.config.js': `module.exports = {};`,
      'package.json': JSON.stringify({ name: 'test-app' }),
    },
    (dir) => {
      const { stdout } = runCli(['--json', dir], dir);
      const parsed = JSON.parse(stdout);
      assert.ok(parsed.configFile !== null);
      assert.match(parsed.configFile, /predeploy\.config\.js/);
    }
  );
});

test('CLI --json has null configFile when no config exists', () => {
  withTempProject(
    { 'package.json': JSON.stringify({ name: 'test-app' }) },
    (dir) => {
      const { stdout } = runCli(['--json', dir], dir);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.configFile, null);
    }
  );
});

test('CLI fails with a clear error message when config has invalid syntax', () => {
  withTempProject(
    { 'predeploy.config.js': `module.exports = { this is broken` },
    (dir) => {
      const { stdout, exitCode } = runCli([dir], dir);
      assert.equal(exitCode, 1);
      assert.match(stdout, /Failed to load predeploy\.config\.js/);
    }
  );
});
