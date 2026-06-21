'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { run } = require('../checks/01-python-render');

/**
 * Create a temporary project directory with the given files, run the
 * check against it, then clean up. Keeps each test isolated and avoids
 * leftover fixture state leaking between runs.
 */
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

test('skips when no Python project files exist', async () => {
  await withTempProject({}, async (dir) => {
    const result = await run(dir);
    assert.equal(result.status, 'skip');
  });
});

test('skips version check when runtime.txt is missing', async () => {
  await withTempProject({ 'requirements.txt': 'fastapi==0.100.0\n' }, async (dir) => {
    const result = await run(dir);
    assert.equal(result.status, 'skip');
    assert.match(result.message, /no runtime\.txt found/);
  });
});

test('passes for Python versions below 3.13 regardless of dependencies', async () => {
  await withTempProject(
    {
      'runtime.txt': 'python-3.12.7',
      'requirements.txt': 'pydantic==2.5.0\nfastapi==0.100.0\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('warns on Python 3.13+ with a known Rust-compiled dependency', async () => {
  await withTempProject(
    {
      'runtime.txt': 'python-3.13.0',
      'requirements.txt': 'pydantic==2.5.0\nrequests==2.31.0\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.equal(result.details.length, 1);
      assert.match(result.details[0].message, /pydantic/);
    }
  );
});

test('flags multiple Rust-compiled dependencies, not just the first match', async () => {
  await withTempProject(
    {
      'runtime.txt': 'python-3.14.0',
      'requirements.txt': 'pydantic==2.5.0\ntiktoken==0.5.0\northttx==1.0.0\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      const flaggedNames = result.details.map((d) => d.message);
      assert.ok(flaggedNames.some((m) => m.includes('pydantic')));
      assert.ok(flaggedNames.some((m) => m.includes('tiktoken')));
    }
  );
});

test('passes on Python 3.13+ when no Rust-compiled deps are present', async () => {
  await withTempProject(
    {
      'runtime.txt': 'python-3.13.0',
      'requirements.txt': 'flask==3.0.0\nrequests==2.31.0\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'pass');
    }
  );
});

test('handles version specifiers and extras in requirements.txt correctly', async () => {
  await withTempProject(
    {
      'runtime.txt': 'python-3.13.0',
      // Mix of pinned versions, extras, comments, and editable installs
      'requirements.txt':
        '# core deps\npydantic[email]>=2.0,<3.0\nfastapi~=0.100\n-e git+https://example.com/pkg.git\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.equal(result.details.length, 2); // pydantic + fastapi, both flagged once each
    }
  );
});

test('warns with a clear message when runtime.txt has an unparseable version', async () => {
  await withTempProject(
    {
      'runtime.txt': 'latest',
      'requirements.txt': 'pydantic==2.5.0\n',
    },
    async (dir) => {
      const result = await run(dir);
      assert.equal(result.status, 'warn');
      assert.match(result.message, /could not parse/);
    }
  );
});

// ── --live mode tests (PyPI calls mocked, no real network access) ──

function withMockedFetch(responseMap, callback) {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    for (const [key, response] of Object.entries(responseMap)) {
      if (url.includes(key)) {
        return {
          ok: response.ok !== false,
          json: async () => response.body,
        };
      }
    }
    throw new Error(`Unmocked fetch call: ${url}`);
  };
  try {
    return callback();
  } finally {
    global.fetch = originalFetch;
  }
}

test('live mode: passes when PyPI confirms a matching wheel exists', async () => {
  await withMockedFetch(
    {
      'pydantic-core/2.40.0/json': {
        body: { urls: [{ packagetype: 'bdist_wheel', filename: 'pydantic_core-2.40.0-cp314-cp314-linux_x86_64.whl' }] },
      },
    },
    () =>
      withTempProject(
        {
          'runtime.txt': 'python-3.14.0',
          'requirements.txt': 'pydantic-core==2.40.0\n',
        },
        async (dir) => {
          const result = await run(dir, { live: true });
          assert.equal(result.status, 'pass');
          assert.match(result.message, /verified wheels exist/);
        }
      )
  );
});

test('live mode: fails when PyPI confirms no matching wheel exists', async () => {
  await withMockedFetch(
    {
      'pydantic-core/2.20.0/json': {
        body: { urls: [{ packagetype: 'bdist_wheel', filename: 'pydantic_core-2.20.0-cp313-cp313-linux_x86_64.whl' }] },
      },
    },
    () =>
      withTempProject(
        {
          'runtime.txt': 'python-3.14.0',
          'requirements.txt': 'pydantic-core==2.20.0\n',
        },
        async (dir) => {
          const result = await run(dir, { live: true });
          assert.equal(result.status, 'fail');
          assert.match(result.details[0].message, /confirmed: no wheel/);
        }
      )
  );
});

test('live mode: falls back to "unverified" warn when the version is unpinned', async () => {
  await withTempProject(
    {
      'runtime.txt': 'python-3.14.0',
      'requirements.txt': 'pydantic-core>=2.0\n', // no exact pin, can't query a specific release
    },
    async (dir) => {
      const result = await run(dir, { live: true });
      assert.equal(result.status, 'warn');
      assert.match(result.message, /unverified/);
    }
  );
});

test('live mode: treats a failed PyPI request as unknown, not a false pass', async () => {
  await withMockedFetch(
    { 'pydantic-core/2.40.0/json': { ok: false, body: {} } },
    () =>
      withTempProject(
        {
          'runtime.txt': 'python-3.14.0',
          'requirements.txt': 'pydantic-core==2.40.0\n',
        },
        async (dir) => {
          const result = await run(dir, { live: true });
          assert.equal(result.status, 'warn');
          assert.match(result.details[0].message, /could not verify/);
        }
      )
  );
});

test('static mode (default, no options) still works exactly as before', async () => {
  await withTempProject(
    {
      'runtime.txt': 'python-3.14.0',
      'requirements.txt': 'pydantic-core==2.40.0\n',
    },
    async (dir) => {
      const result = await run(dir); // no options passed at all
      assert.equal(result.status, 'warn');
      assert.match(result.fix, /--live/);
    }
  );
});

test('live mode: degrades gracefully when global fetch is unavailable (e.g. Node < 18)', async () => {
  const originalFetch = global.fetch;
  delete global.fetch; // simulate an old Node.js runtime with no global fetch
  try {
    await withTempProject(
      {
        'runtime.txt': 'python-3.14.0',
        'requirements.txt': 'pydantic-core==2.40.0\n',
      },
      async (dir) => {
        const result = await run(dir, { live: true });
        // Should not throw — falls back to "unverified" rather than crashing
        assert.equal(result.status, 'warn');
        assert.match(result.message, /unverified/);
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
