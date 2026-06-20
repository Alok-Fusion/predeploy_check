'use strict';

const fs = require('fs');
const path = require('path');

const name = 'Missing Engines Field: Node.js version';

async function run(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return {
      status: 'skip',
      message: `${name} — no package.json found`,
    };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return {
      status: 'fail',
      message: `${name} — could not parse package.json`,
      fix: 'Fix JSON syntax errors in package.json',
      details: [{ file: 'package.json' }],
    };
  }

  if (!pkg.engines) {
    return {
      status: 'warn',
      message: `${name} — no "engines" field in package.json`,
      fix: 'Add "engines": { "node": ">=18.0.0" } to package.json to lock the Node.js version on your platform',
      details: [{ file: 'package.json', message: 'Missing "engines" field — platform may default to an unexpected Node.js version' }],
    };
  }

  if (!pkg.engines.node) {
    return {
      status: 'warn',
      message: `${name} — "engines" exists but no "node" version specified`,
      fix: 'Add "node": ">=18.0.0" inside the "engines" field in package.json',
      details: [{ file: 'package.json', message: 'engines field exists but does not specify a node version' }],
    };
  }

  return {
    status: 'pass',
    message: `${name} — Node.js engine specified: ${pkg.engines.node}`,
  };
}

module.exports = { name, run };
