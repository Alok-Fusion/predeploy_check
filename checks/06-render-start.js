'use strict';

const fs = require('fs');
const path = require('path');

const name = 'Render Start Command: missing start configuration';

async function run(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  const procfilePath = path.join(projectRoot, 'Procfile');
  const renderYamlPath = path.join(projectRoot, 'render.yaml');

  const hasPkg = fs.existsSync(pkgPath);
  const hasProcfile = fs.existsSync(procfilePath);
  const hasRenderYaml = fs.existsSync(renderYamlPath);

  // Check for Python project (has requirements.txt but no package.json)
  const hasRequirements = fs.existsSync(path.join(projectRoot, 'requirements.txt'));
  const isPython = hasRequirements && !hasPkg;

  // ── Python project checks ──
  if (isPython) {
    if (hasProcfile) {
      const procContent = fs.readFileSync(procfilePath, 'utf-8').trim();
      if (procContent.match(/^web:/m)) {
        return {
          status: 'pass',
          message: `${name} — Procfile found with web process`,
        };
      }
    }

    // Check for common Python entry points
    const commonEntries = ['app.py', 'main.py', 'wsgi.py', 'asgi.py', 'manage.py'];
    const foundEntries = commonEntries.filter((f) => fs.existsSync(path.join(projectRoot, f)));

    if (hasProcfile) {
      return {
        status: 'pass',
        message: `${name} — Procfile found`,
      };
    }

    if (hasRenderYaml) {
      return {
        status: 'pass',
        message: `${name} — render.yaml found with start command`,
      };
    }

    return {
      status: 'fail',
      message: `${name} — no Procfile or render.yaml for Python project`,
      fix: 'Create a Procfile with: web: gunicorn app:app (or your appropriate start command)',
      details: foundEntries.length > 0
        ? [{ file: foundEntries[0], message: `Found "${foundEntries[0]}" — add a Procfile to specify how to start it` }]
        : [{ message: 'No common Python entry point found (app.py, main.py, etc.)' }],
    };
  }

  // ── Node.js project checks ──
  if (!hasPkg) {
    return {
      status: 'skip',
      message: `${name} — no package.json found, not a Node.js project`,
    };
  }

  // If there's a Procfile, that takes precedence
  if (hasProcfile) {
    return {
      status: 'pass',
      message: `${name} — Procfile found`,
    };
  }

  // If there's a render.yaml, that takes precedence
  if (hasRenderYaml) {
    const content = fs.readFileSync(renderYamlPath, 'utf-8');
    if (content.includes('startCommand')) {
      return {
        status: 'pass',
        message: `${name} — render.yaml with startCommand found`,
      };
    }
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

  // Check for "start" script
  if (pkg.scripts && pkg.scripts.start) {
    return {
      status: 'pass',
      message: `${name} — "start" script found: "${pkg.scripts.start}"`,
    };
  }

  // Check if "main" field points to a file
  if (pkg.main && fs.existsSync(path.join(projectRoot, pkg.main))) {
    return {
      status: 'warn',
      message: `${name} — no "start" script, but "main" field points to "${pkg.main}"`,
      fix: 'Add a "start" script to package.json, e.g.: "start": "node ' + pkg.main + '"',
      details: [{ file: 'package.json', message: 'Render needs an explicit start command; "main" alone may not be used' }],
    };
  }

  return {
    status: 'fail',
    message: `${name} — no start command found`,
    fix: 'Add a "start" script to package.json (e.g. "start": "node server.js") or create a Procfile',
    details: [
      { file: 'package.json', message: 'No "start" script in "scripts"' },
      { message: 'No Procfile found' },
      hasRenderYaml
        ? { file: 'render.yaml', message: 'render.yaml exists but has no "startCommand"' }
        : { message: 'No render.yaml found' },
    ],
  };
}

module.exports = { name, run };
