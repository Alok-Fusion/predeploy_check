# predeploy-check

> Stop deployment failures before they happen. `predeploy-check` scans your project for the most common deployment mistakes across Vercel and Render — missing environment variables, case-sensitive imports, Python wheel compatibility, start command issues, and more — before you push your code.

[![npm version](https://img.shields.io/npm/v/predeploy-check.svg)](https://www.npmjs.com/package/predeploy-check)
[![npm downloads](https://img.shields.io/npm/dw/predeploy-check.svg)](https://www.npmjs.com/package/predeploy-check)
[![license](https://img.shields.io/npm/l/predeploy-check.svg)](./LICENSE)

```bash
npx predeploy-check
```

No install required. Run it in any project directory before pushing.

---

## Table of Contents

- [What it checks](#what-it-checks)
- [Usage](#usage)
- [Output modes](#output-modes)
- [JSON output](#json-output)
- [Configuration](#configuration)
- [Adding custom checks](#adding-custom-checks)
- [Testing](#testing)
- [Contributing](#contributing)
- [Author](#author)
- [License](#license)

---

## What it checks

| # | Check | What it catches | Severity |
|---|-------|----------------|----------|
| 1 | **Python + Render** | Rust-compiled dependencies (pydantic, fastapi, orjson…) on Python ≥ 3.13 without prebuilt wheels. Add `--live` to verify against PyPI directly. | ⚠️ Warn / ❌ Fail |
| 2 | **ESLint + Vercel** | Mismatched `eslint` / `eslint-config-next` versions; deprecated `ignoreDuringBuilds` on Next.js 16+ | ❌ Fail / ⚠️ Warn |
| 3 | **Case Sensitivity** | Import paths that differ in casing from actual filenames — works locally on Windows/Mac, breaks silently on Vercel's Linux filesystem | ⚠️ Warn |
| 4 | **Missing Engines** | No `"engines"` field in `package.json` — platform may default to an unexpected Node.js version | ⚠️ Warn |
| 5 | **Env Var Check** | `process.env.X` references in code not declared in `.env` or `.env.example` | ⚠️ Warn |
| 6 | **Render Start Cmd** | No `"start"` script, no Procfile, and no `render.yaml` start command | ❌ Fail |

---

## Usage

```bash
# Scan the current directory
npx predeploy-check

# Scan a specific project path
npx predeploy-check ./my-project

# Verify Python wheel availability live against PyPI
# (slower, requires internet — confirms instead of guesses)
npx predeploy-check --live

# Output structured JSON instead of colored terminal text
npx predeploy-check --json

# Combine flags freely
npx predeploy-check --live --json ./my-project

# Show help
npx predeploy-check --help
```

### Flags

| Flag | Description |
|------|-------------|
| `--live` | Query PyPI directly to confirm whether a prebuilt wheel exists for your exact pinned Python dependency version. Turns a "might be missing" warning into a confirmed pass or fail. Requires Node.js 18+ and internet access. |
| `--json` | Output a single machine-readable JSON object instead of colored terminal text. Safe to pipe into `jq` or `JSON.parse()`. Exit code behavior is identical. |
| `--help` | Show help. Pass `--json` alongside for structured JSON output. |
| `--version` | Show the current version. Pass `--json` alongside for structured JSON output. |

---

## Output modes

### Terminal (default)

Clean, colored output with a status icon per check, file and line context, and a one-line suggested fix for every warning or failure:

```
  predeploy-check  scanning ./my-project
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

⏭️  Python + Render — no Python project detected
✅ ESLint + Vercel — ESLint configuration looks correct
⚠️  Missing Engines Field — no "engines" field in package.json
    package.json
    → Missing "engines" field
    💡 Fix: Add "engines": { "node": ">=18.0.0" } to package.json
❌ Render Start Command — no start command found
    package.json
    → No "start" script in "scripts"
    💡 Fix: Add a "start" script or create a Procfile

  Summary: 1 passed · 1 warning · 1 failed · 2 skipped

  Deploy will likely fail. Fix ❌ issues above.
```

Exit code `1` if any ❌ failures, `0` otherwise.

### CI / GitHub Actions

Since the tool exits with a non-zero code on failure, it works out of the box in any CI pipeline:

```yaml
- name: Check for deploy issues
  run: npx predeploy-check
```

---

## JSON output

`--json` prints a single JSON object to stdout with no decoration — safe to pipe directly into `jq` or any tool that parses JSON:

```bash
npx predeploy-check --json | jq '.summary'
```

Output shape:

```json
{
  "tool": "predeploy-check",
  "version": "1.3.0",
  "projectRoot": "/path/to/project",
  "configFile": "/path/to/predeploy.config.js",
  "live": false,
  "summary": {
    "passed": 3,
    "warnings": 1,
    "failed": 1,
    "skipped": 1
  },
  "willLikelyFail": true,
  "checks": [
    {
      "check": "Render Start Command: missing start configuration",
      "status": "fail",
      "message": "Render Start Command: missing start configuration — no start command found",
      "fix": "Add a \"start\" script to package.json or create a Procfile",
      "details": [
        { "file": "package.json", "message": "No \"start\" script in \"scripts\"" }
      ]
    }
  ]
}
```

`--help --json` and `--version --json` also return structured JSON, for tools that want to introspect the CLI itself.

---

## Configuration

Create a `predeploy.config.js` file in your project root to control which checks run and how they behave. The file is entirely optional — without it, all checks run with their defaults.

```js
// predeploy.config.js
module.exports = {
  // Enable or disable specific checks by ID
  checks: {
    'python-render':    true,
    'eslint-vercel':    true,
    'case-sensitivity': true,
    'missing-engines':  true,
    'env-vars':         true,
    'render-start':     false, // disabled — using a custom start setup
  },

  // Ignore specific files or directories across all checks
  ignore: [
    'legacy/',
    'scripts/old-deploy.js',
  ],

  // Pass additional options to specific checks
  options: {
    'env-vars': {
      // Check extra env files beyond .env and .env.example
      envFiles: ['.env.production', '.env.staging'],
    },
    'python-render': {
      // Extend the built-in list of known Rust-compiled packages
      rustPackages: ['my-custom-rust-package'],
    },
  },
};
```

**Partial configs are supported.** Only specify what you want to change — everything else defaults to enabled.

### Check IDs

| ID | Check |
|----|-------|
| `python-render` | Python + Render |
| `eslint-vercel` | ESLint + Vercel |
| `case-sensitivity` | Case Sensitivity |
| `missing-engines` | Missing Engines |
| `env-vars` | Env Var Check |
| `render-start` | Render Start Cmd |

When a config file is detected, a notice appears at the top of the output confirming it was loaded. Disabled checks appear as ⏭️ skipped with a clear explanation rather than silently disappearing.

---

## Adding custom checks

Create a new file in the `checks/` folder. Checks are loaded alphabetically, so prefix with a number to control execution order.

```js
// checks/07-my-check.js
'use strict';

const name = 'My Custom Check: description';

async function run(projectRoot, options = {}) {
  // options includes: config (loaded predeploy.config.js), live, json flags

  return {
    status: 'pass',   // 'pass' | 'warn' | 'fail' | 'skip'
    message: `${name} — everything looks good`,
    fix: 'Suggested fix if status is warn or fail',
    details: [
      { file: 'some-file.js', line: 42, message: 'What was found and where' }
    ],
  };
}

module.exports = { name, run };
```

---

## Testing

The project has a full automated test suite built on Node's built-in test runner — no extra dependencies required.

```bash
npm test
```

Current coverage: **82 tests** across all 6 checks, the config system, and the JSON output layer — including end-to-end CLI integration tests that spawn the tool as a real subprocess.

---

## Contributing

Found a deployment failure this tool doesn't catch? Open an issue or a pull request. The project is intentionally narrow by design, and it gets more useful with every real-world gotcha that gets added.

When contributing a new check, please include tests — the existing check files in `test/` are good examples of the fixture-based pattern used throughout.

---

## Author

Built by [Alok Kushwaha](https://github.com/Alok-Fusion) — NLP/ML engineer. Born out of a real afternoon lost to a deploy failure that had nothing to do with the actual code.

- GitHub: [Alok-Fusion](https://github.com/Alok-Fusion)
- npm: [predeploy-check](https://www.npmjs.com/package/predeploy-check)

---

## License

MIT — see [LICENSE](./LICENSE) for details.
