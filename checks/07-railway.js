'use strict';

const fs = require('fs');
const path = require('path');

const name = 'Railway: deployment configuration';

/**
 * Parse a TOML file just enough to extract simple key=value pairs.
 * Railway's railway.toml and nixpacks.toml are simple enough that a
 * full TOML parser isn't needed — we just need specific known keys.
 * Returns a flat object of key=value strings, lowercased keys.
 */
function parseSimpleToml(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const rawVal = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = rawVal;
  }
  return result;
}

/**
 * Detect whether this looks like a Railway project at all.
 * Returns true if any Railway-specific config files exist.
 */
function isRailwayProject(projectRoot) {
  return (
    fs.existsSync(path.join(projectRoot, 'railway.toml')) ||
    fs.existsSync(path.join(projectRoot, 'railway.json')) ||
    fs.existsSync(path.join(projectRoot, 'nixpacks.toml'))
  );
}

async function run(projectRoot, options = {}) {
  const railwayTomlPath = path.join(projectRoot, 'railway.toml');
  const railwayJsonPath = path.join(projectRoot, 'railway.json');
  const nixpacksTomlPath = path.join(projectRoot, 'nixpacks.toml');
  const pkgPath = path.join(projectRoot, 'package.json');
  const requirementsPath = path.join(projectRoot, 'requirements.txt');

  const hasRailwayToml = fs.existsSync(railwayTomlPath);
  const hasRailwayJson = fs.existsSync(railwayJsonPath);
  const hasNixpacksToml = fs.existsSync(nixpacksTomlPath);
  const hasPkg = fs.existsSync(pkgPath);
  const hasRequirements = fs.existsSync(requirementsPath);

  // Skip entirely if this doesn't look like a Railway project
  if (!isRailwayProject(projectRoot)) {
    return {
      status: 'skip',
      message: `${name} — no Railway config files detected (railway.toml, railway.json, or nixpacks.toml)`,
    };
  }

  const details = [];
  let highestStatus = 'pass';

  function escalate(status) {
    if (status === 'fail') highestStatus = 'fail';
    else if (status === 'warn' && highestStatus !== 'fail') highestStatus = 'warn';
  }

  // ── Check 1: $PORT hardcoding ──────────────────────────────────────────────
  // Railway injects $PORT at runtime. Apps that hardcode a port number (e.g.
  // app.listen(3000)) will appear to build successfully but fail to receive
  // traffic — one of the most common silent Railway failures.
  const sourceExtensions = ['.js', '.ts', '.mjs', '.cjs'];
  const hardcodedPortPattern = /\.listen\s*\(\s*(\d{4,5})\s*[,)]/;

  function scanForHardcodedPort(dir, depth = 0) {
    if (depth > 3) return null; // don't recurse too deep
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return null; }

    const skipDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);

    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const fullPath = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        const found = scanForHardcodedPort(fullPath, depth + 1);
        if (found) return found;
      } else if (sourceExtensions.includes(path.extname(entry))) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const match = content.match(hardcodedPortPattern);
          if (match) {
            // Make sure it's not already using process.env.PORT nearby
            const lines = content.split('\n');
            const matchLine = lines.findIndex((l) => hardcodedPortPattern.test(l));
            const context = lines.slice(Math.max(0, matchLine - 3), matchLine + 3).join('\n');
            if (!context.includes('process.env.PORT') && !context.includes('process.env[')) {
              return { file: path.relative(projectRoot, fullPath), port: match[1], line: matchLine + 1 };
            }
          }
        } catch { continue; }
      }
    }
    return null;
  }

  const hardcodedPort = scanForHardcodedPort(projectRoot);
  if (hardcodedPort) {
    escalate('fail');
    details.push({
      file: hardcodedPort.file,
      line: hardcodedPort.line,
      message: `Hardcoded port ${hardcodedPort.port} detected — Railway injects the port via $PORT at runtime`,
      fix: `Replace ${hardcodedPort.port} with process.env.PORT || ${hardcodedPort.port}`,
    });
  }

  // ── Check 2: railway.toml builder validity ─────────────────────────────────
  // Railway only supports specific builder values. Using anything else
  // (e.g. "node", "auto") causes a silent build failure.
  const validBuilders = new Set(['nixpacks', 'dockerfile', 'heroku', 'railpack']);

  if (hasRailwayToml) {
    try {
      const tomlContent = fs.readFileSync(railwayTomlPath, 'utf-8');
      const parsed = parseSimpleToml(tomlContent);
      if (parsed.builder && !validBuilders.has(parsed.builder.toLowerCase())) {
        escalate('fail');
        details.push({
          file: 'railway.toml',
          message: `Invalid builder "${parsed.builder}" — Railway only supports: ${[...validBuilders].join(', ')}`,
          fix: `Change builder to one of: ${[...validBuilders].join(', ')}`,
        });
      }
    } catch {
      escalate('warn');
      details.push({ file: 'railway.toml', message: 'Could not parse railway.toml — check for syntax errors' });
    }
  }

  if (hasRailwayJson) {
    try {
      const jsonContent = JSON.parse(fs.readFileSync(railwayJsonPath, 'utf-8'));
      const builder = jsonContent.build && jsonContent.build.builder;
      if (builder && !validBuilders.has(builder.toLowerCase())) {
        escalate('fail');
        details.push({
          file: 'railway.json',
          message: `Invalid builder "${builder}" — Railway only supports: ${[...validBuilders].join(', ')}`,
          fix: `Change build.builder to one of: ${[...validBuilders].join(', ')}`,
        });
      }
    } catch {
      escalate('warn');
      details.push({ file: 'railway.json', message: 'Could not parse railway.json — check for syntax errors' });
    }
  }

  // ── Check 3: Nixpacks build plan detection ─────────────────────────────────
  // Nixpacks needs to detect what kind of app this is. Without a package.json
  // (Node) or requirements.txt (Python), it can't generate a build plan and
  // will fail with "Nixpacks was unable to generate a build plan for this app."
  // A nixpacks.toml can override this explicitly and bypass the detection issue.
  if (!hasPkg && !hasRequirements && !hasNixpacksToml) {
    escalate('warn');
    details.push({
      message: 'No package.json, requirements.txt, or nixpacks.toml found — Nixpacks may be unable to detect the project type',
      fix: 'Add a nixpacks.toml with providers = ["node"] (or "python") to explicitly tell Railway how to build',
    });
  }

  // ── Check 4: Monorepo structure without explicit root ──────────────────────
  // If the project root contains multiple subdirectories that each look like
  // apps (multiple package.json files), Nixpacks will be confused about which
  // one to deploy. Railway requires explicit configuration in this case.
  if (hasPkg) {
    let entries;
    try { entries = fs.readdirSync(projectRoot); } catch { entries = []; }

    const skipDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.railway']);
    const subPkgDirs = entries.filter((entry) => {
      if (skipDirs.has(entry)) return false;
      const fullPath = path.join(projectRoot, entry);
      try {
        return (
          fs.statSync(fullPath).isDirectory() &&
          fs.existsSync(path.join(fullPath, 'package.json'))
        );
      } catch { return false; }
    });

    if (subPkgDirs.length >= 2) {
      // Check if railway.toml explicitly sets watchPaths — that's the signal
      // the user has intentionally configured which app to deploy
      let hasExplicitRoot = false;
      if (hasRailwayToml) {
        try {
          const toml = parseSimpleToml(fs.readFileSync(railwayTomlPath, 'utf-8'));
          if (toml.watchpaths || toml['watch paths'] || toml.root) hasExplicitRoot = true;
        } catch { /* ignore */ }
      }

      if (!hasExplicitRoot) {
        escalate('warn');
        details.push({
          message: `Possible monorepo detected (${subPkgDirs.length} subdirectories with package.json: ${subPkgDirs.slice(0, 3).join(', ')}${subPkgDirs.length > 3 ? '…' : ''}) — Nixpacks may not know which app to deploy`,
          fix: 'Add watchPaths to railway.toml, or deploy each service separately in the Railway dashboard',
        });
      }
    }
  }

  // ── Check 5: Start command availability ───────────────────────────────────
  // Nixpacks needs a start command. For Node projects it looks at package.json
  // "start" script. If there's neither a start script nor an explicit command
  // in railway.toml/nixpacks.toml, the deploy will fail at runtime.
  if (hasPkg) {
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch { pkg = {}; }

    const hasStartScript = pkg.scripts && pkg.scripts.start;

    // Check if railway.toml or nixpacks.toml provides a start command
    let configProvidesStart = false;
    if (hasRailwayToml) {
      try {
        const toml = parseSimpleToml(fs.readFileSync(railwayTomlPath, 'utf-8'));
        if (toml.startcommand || toml['start command'] || toml.start) configProvidesStart = true;
      } catch { /* ignore */ }
    }
    if (hasNixpacksToml) {
      try {
        const toml = parseSimpleToml(fs.readFileSync(nixpacksTomlPath, 'utf-8'));
        if (toml.start || toml.startcommand || toml.cmd) configProvidesStart = true;
      } catch { /* ignore */ }
    }

    if (!hasStartScript && !configProvidesStart) {
      escalate('warn');
      details.push({
        file: 'package.json',
        message: 'No "start" script in package.json and no start command in railway.toml/nixpacks.toml',
        fix: 'Add "start": "node server.js" (or your entry point) to package.json scripts',
      });
    }
  }

  // ── Build final result ─────────────────────────────────────────────────────
  if (details.length === 0) {
    return {
      status: 'pass',
      message: `${name} — Railway configuration looks correct`,
    };
  }

  const failCount = details.filter((d) => d.fix && highestStatus === 'fail').length;

  return {
    status: highestStatus,
    message: `${name} — ${details.length} potential issue${details.length > 1 ? 's' : ''} detected`,
    fix: highestStatus === 'fail'
      ? 'Fix the ❌ issues above before deploying to Railway'
      : 'Review the ⚠️ warnings above — they may cause silent failures on Railway',
    details,
  };
}

module.exports = { name, run };
