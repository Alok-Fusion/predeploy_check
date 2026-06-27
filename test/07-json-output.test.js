'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { collectResults, summarize } = require('../index');

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

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

// ── collectResults / summarize (unit-level) ──

test('collectResults returns one entry per check, with checkName attached', async () => {
  await withTempProject({}, async (dir) => {
    const results = await collectResults(dir, {});
    // 6 checks total; some (eslint) can return multiple results, but on an
    // empty project every check should just skip with one result each.
    assert.ok(results.length >= 6);
    for (const r of results) {
      assert.ok(typeof r.checkName === 'string' && r.checkName.length > 0);
      assert.ok(['pass', 'warn', 'fail', 'skip', 'error'].includes(r.status));
    }
  });
});

test('summarize correctly tallies counts and exit code from a result set', () => {
  const fakeResults = [
    { status: 'pass' },
    { status: 'pass' },
    { status: 'warn' },
    { status: 'fail' },
    { status: 'skip' },
  ];
  const summary = summarize(fakeResults);
  assert.equal(summary.counts.pass, 2);
  assert.equal(summary.counts.warn, 1);
  assert.equal(summary.counts.fail, 1);
  assert.equal(summary.counts.skip, 1);
  assert.equal(summary.hasFail, true);
  assert.equal(summary.exitCode, 1);
});

test('summarize treats an "error" status the same as a failure', () => {
  const summary = summarize([{ status: 'pass' }, { status: 'error' }]);
  assert.equal(summary.hasFail, true);
  assert.equal(summary.exitCode, 1);
});

test('summarize returns exit code 0 when nothing failed', () => {
  const summary = summarize([{ status: 'pass' }, { status: 'skip' }, { status: 'warn' }]);
  assert.equal(summary.hasFail, false);
  assert.equal(summary.exitCode, 0);
});

// ── End-to-end CLI tests: --json output via a real child process ──

function runCli(args, cwd) {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], { cwd, encoding: 'utf-8' });
    return { stdout, exitCode: 0 };
  } catch (err) {
    // execFileSync throws on non-zero exit; the output is still on err.stdout
    return { stdout: err.stdout, exitCode: err.status };
  }
}

test('CLI --json produces valid, parseable JSON on a clean project', () => {
  withTempProject(
    {
      'package.json': JSON.stringify({
        name: 'clean-app',
        engines: { node: '>=18.0.0' },
        scripts: { start: 'node server.js' },
      }),
      'server.js': "console.log('hi');\n",
    },
    (dir) => {
      const { stdout, exitCode } = runCli(['--json', dir], dir);
      const parsed = JSON.parse(stdout); // throws if not valid JSON
      assert.equal(parsed.tool, 'predeploy-check');
      assert.equal(parsed.willLikelyFail, false);
      assert.equal(exitCode, 0);
    }
  );
});

test('CLI --json produces valid JSON and exit code 1 on a broken project', () => {
  withTempProject(
    {
      'package.json': JSON.stringify({ name: 'broken-app' }), // no start script
    },
    (dir) => {
      const { stdout, exitCode } = runCli(['--json', dir], dir);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.willLikelyFail, true);
      assert.equal(exitCode, 1);
      assert.ok(parsed.checks.some((c) => c.status === 'fail'));
    }
  );
});

test('CLI --json output contains no non-JSON text (safe to pipe to JSON.parse directly)', () => {
  withTempProject({}, (dir) => {
    const { stdout } = runCli(['--json', dir], dir);
    // Should parse as a single JSON value with nothing before or after it
    assert.doesNotThrow(() => JSON.parse(stdout));
  });
});

test('CLI --help --json returns valid JSON describing the tool', () => {
  const { stdout, exitCode } = runCli(['--help', '--json']);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tool, 'predeploy-check');
  assert.ok(Array.isArray(parsed.checks));
  assert.equal(exitCode, 0);
});

test('CLI --version --json returns valid JSON with the version field', () => {
  const { stdout, exitCode } = runCli(['--version', '--json']);
  const parsed = JSON.parse(stdout);
  const pkg = require('../package.json');
  assert.equal(parsed.version, pkg.version);
  assert.equal(exitCode, 0);
});

test('CLI without --json still produces human-readable output, not JSON', () => {
  withTempProject({}, (dir) => {
    const { stdout } = runCli([dir], dir);
    assert.ok(stdout.includes('predeploy-check'));
    assert.throws(() => JSON.parse(stdout)); // plain terminal output isn't valid JSON
  });
});
