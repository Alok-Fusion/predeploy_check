# predeploy-check

> Stop deployment failures before they happen. `predeploy-check` scans your project for the most common deployment mistakes across Vercel and Render, including missing environment variables, case-sensitive imports, Python wheel compatibility, start command issues, and more — before you push your code.

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

Two output modes, same underlying checks:

**Terminal (default)** — clean, colored output with:
- ✅ / ⚠️ / ❌ per check
- File and line context
- One-line suggested fix

**JSON** (`--json`) — a single structured JSON object on stdout, with no
colors or decoration, designed for CI dashboards, GitHub bots, editor
extensions, or any tool that needs to parse the results programmatically
rather than read them. See [JSON output](#json-output) below for the shape.

Exit code `1` if any ❌ failures, `0` otherwise — in both output modes.

## Usage

```bash
# Scan current directory
npx predeploy-check

# Scan a specific project
npx predeploy-check ./my-project

# Verify Python wheel availability live against PyPI, instead of
# relying on the built-in known-package list (slower, needs internet)
npx predeploy-check --live

# Output machine-readable JSON instead of colored terminal text
npx predeploy-check --json

# Combine flags freely
npx predeploy-check --live --json ./my-project

# Show help
npx predeploy-check --help
```

By default, the Python + Render check warns based on a built-in list of
packages known to have Rust-compiled components — it's instant and works
offline, but the list can go stale as packages ship new wheels over time.
Pass `--live` to query PyPI directly for the exact pinned version in your
`requirements.txt`, which turns a "might be missing" warning into a
confirmed pass or fail.

## JSON output

`--json` prints a single JSON object to stdout, with nothing else mixed
in — safe to pipe directly into `JSON.parse()`, `jq`, or any tool that
expects clean machine-readable output:

```bash
npx predeploy-check --json | jq '.summary'
```

Shape:

```json
{
  "tool": "predeploy-check",
  "version": "1.2.0",
  "projectRoot": "/path/to/project",
  "live": false,
  "summary": { "passed": 4, "warnings": 1, "failed": 1, "skipped": 0 },
  "willLikelyFail": true,
  "checks": [
    {
      "check": "Render Start Command: missing start configuration",
      "status": "fail",
      "message": "...",
      "fix": "Add a \"start\" script to package.json...",
      "details": [ { "file": "package.json", "message": "..." } ]
    }
  ]
}
```

`--help --json` and `--version --json` also return structured JSON
instead of plain text, for tools that want to introspect the CLI itself.

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

## Testing

The project has a full test suite (49 tests covering all 6 checks) built
on Node's built-in test runner — no extra dependencies needed.

```bash
npm test
```

## Contributing

Found a deploy-only failure that isn't on this list? Open an issue or a
PR — the project is intentionally narrow right now (six checks), and it
gets more useful with every real-world gotcha someone adds.

## Author

Built by [Alok Kushwaha](https://github.com/Alok-Fusion) — NLP/ML
engineer, born out of a real afternoon lost to a deploy failure that
had nothing to do with the actual code.

## License

MIT — see [LICENSE](./LICENSE) for details.
