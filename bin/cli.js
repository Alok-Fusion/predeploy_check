#!/usr/bin/env node

'use strict';

const path = require('path');
const { runAllChecks } = require('../index');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  predeploy-check — catch deployment failures before they happen

  Usage:
    npx predeploy-check [directory]

  Arguments:
    directory   Path to the project to scan (defaults to current directory)

  Options:
    -h, --help      Show this help message
    -v, --version   Show version number

  Checks:
    1. Python + Render:    Rust-compiled deps on unsupported Python versions
    2. ESLint + Vercel:    Peer-dependency mismatches in Next.js projects
    3. Case Sensitivity:   Import paths that differ from actual filenames
    4. Missing Engines:    No "engines" field in package.json
    5. Env Var Check:      process.env references missing from .env files
    6. Render Start Cmd:   Missing start command for Render deployments
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkg = require('../package.json');
  console.log(pkg.version);
  process.exit(0);
}

const projectRoot = path.resolve(args[0] || process.cwd());

runAllChecks(projectRoot).then((exitCode) => {
  process.exit(exitCode);
}).catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(2);
});
