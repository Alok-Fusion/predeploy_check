#!/usr/bin/env node

'use strict';

const path = require('path');
const { runAllChecks } = require('../index');

const args = process.argv.slice(2);
const wantsJson = args.includes('--json');

if (args.includes('--help') || args.includes('-h')) {
  if (wantsJson) {
    console.log(JSON.stringify({
      tool: 'predeploy-check',
      usage: 'npx predeploy-check [directory] [options]',
      options: {
        '-h, --help': 'Show this help message',
        '-v, --version': 'Show version number',
        '--live': 'Verify Python wheel availability against PyPI (slower, needs internet)',
        '--json': 'Output machine-readable JSON instead of colored terminal output',
      },
      checks: [
        { id: 1, name: 'Python + Render', description: 'Rust-compiled deps on unsupported Python versions' },
        { id: 2, name: 'ESLint + Vercel', description: 'Peer-dependency mismatches in Next.js projects' },
        { id: 3, name: 'Case Sensitivity', description: 'Import paths that differ from actual filenames' },
        { id: 4, name: 'Missing Engines', description: 'No "engines" field in package.json' },
        { id: 5, name: 'Env Var Check', description: 'process.env references missing from .env files' },
        { id: 6, name: 'Render Start Cmd', description: 'Missing start command for Render deployments' },
      ],
    }, null, 2));
    process.exit(0);
  }

  console.log(`
  predeploy-check — catch deployment failures before they happen

  Usage:
    npx predeploy-check [directory]

  Arguments:
    directory   Path to the project to scan (defaults to current directory)

  Options:
    -h, --help      Show this help message
    -v, --version   Show version number
    --live          Verify Python wheel availability against PyPI (slower, needs internet)
    --json          Output machine-readable JSON instead of colored terminal output

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
  if (wantsJson) {
    console.log(JSON.stringify({ tool: 'predeploy-check', version: pkg.version }, null, 2));
  } else {
    console.log(pkg.version);
  }
  process.exit(0);
}

const projectRoot = path.resolve(args.find((a) => !a.startsWith('-')) || process.cwd());
const options = { live: args.includes('--live'), json: wantsJson };

runAllChecks(projectRoot, options).then((exitCode) => {
  process.exit(exitCode);
}).catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(2);
});
