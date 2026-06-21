# predeploy-check

> Catch deployment failures **before** you push. Scans your project for known Render & Vercel pitfalls.

```bash
npx predeploy-check
```

No install required — just run it in your project directory.

## What it checks

| # | Check | Targets | Status |
|---|-------|---------|--------|
| 1 | **Python + Render** | Rust-compiled deps (pydantic, fastapi, orjson…) on Python ≥ 3.13 — add `--live` to verify against PyPI instead of guessing | ⚠️ Warn / ❌ Fail (live) |
| 2 | **ESLint + Vercel** | Mismatched eslint / eslint-config-next versions; deprecated `ignoreDuringBuilds` on Next 16+ | ❌ Fail / ⚠️ Warn |
| 3 | **Case Sensitivity** | Import paths that differ in casing from actual filenames (breaks on Linux) | ⚠️ Warn |
| 4 | **Missing Engines** | No `"engines"` field in package.json | ⚠️ Warn |
| 5 | **Env Var Check** | `process.env.X` references not declared in `.env` / `.env.example` | ⚠️ Warn |
| 6 | **Render Start Cmd** | No Procfile, no `"start"` script, no render.yaml start command | ❌ Fail |

## Output

Clean, colored terminal output with:
- ✅ / ⚠️ / ❌ per check
- File and line context
- One-line suggested fix

Exit code `1` if any ❌ failures, `0` otherwise.

## Usage

```bash
# Scan current directory
npx predeploy-check

# Scan a specific project
npx predeploy-check ./my-project

# Verify Python wheel availability live against PyPI, instead of
# relying on the built-in known-package list (slower, needs internet)
npx predeploy-check --live

# Show help
npx predeploy-check --help
```

By default, the Python + Render check warns based on a built-in list of
packages known to have Rust-compiled components — it's instant and works
offline, but the list can go stale as packages ship new wheels over time.
Pass `--live` to query PyPI directly for the exact pinned version in your
`requirements.txt`, which turns a "might be missing" warning into a
confirmed pass or fail.

## Adding custom checks

Create a new file in the `checks/` folder:

```js
// checks/07-my-check.js
'use strict';

const name = 'My Custom Check';

async function run(projectRoot) {
  // Your check logic here
  return {
    status: 'pass',  // 'pass' | 'warn' | 'fail' | 'skip'
    message: 'Everything looks good',
    fix: 'Suggested fix if status is warn or fail',
    details: [
      { file: 'some-file.js', line: 42, message: 'Detail about the issue' }
    ],
  };
}

module.exports = { name, run };
```

Checks are loaded alphabetically, so prefix with a number to control order.

## License

