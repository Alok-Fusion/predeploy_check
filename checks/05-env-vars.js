'use strict';

const fs = require('fs');
const path = require('path');

const name = 'Env Var Check: undeclared environment variables';

// File extensions to scan
const SCAN_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.mts']);

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.vercel',
  '.output', 'coverage', '__pycache__', '.cache',
]);

// Common built-in env vars to ignore
const BUILTIN_VARS = new Set([
  'NODE_ENV', 'PORT', 'HOME', 'PATH', 'PWD', 'USER', 'HOSTNAME',
  'CI', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION',
  'RENDER', 'RENDER_EXTERNAL_URL', 'RENDER_SERVICE_NAME',
  'IS_PULL_REQUEST', 'RENDER_GIT_COMMIT', 'RENDER_GIT_BRANCH',
  'NEXT_RUNTIME', 'npm_lifecycle_event', 'npm_package_name',
]);

/**
 * Recursively collect all scannable files.
 */
function collectFiles(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        collectFiles(path.join(dir, entry.name), files);
      }
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

/**
 * Parse a .env file and return a Set of variable names.
 */
function parseEnvFile(filePath) {
  const vars = new Set();
  if (!fs.existsSync(filePath)) return vars;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      vars.add(match[1]);
    }
  }

  return vars;
}

/**
 * Scan a file for process.env.VAR_NAME references.
 * Returns array of { line, varName }.
 */
function extractEnvReferences(content) {
  const refs = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comment-only lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Match process.env.VARIABLE_NAME
    const pattern = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      refs.push({
        line: i + 1,
        varName: match[1],
      });
    }

    // Match process.env['VAR_NAME'] or process.env["VAR_NAME"]
    const bracketPattern = /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g;
    while ((match = bracketPattern.exec(line)) !== null) {
      refs.push({
        line: i + 1,
        varName: match[1],
      });
    }
  }

  return refs;
}

async function run(projectRoot) {
  // Gather declared env vars from .env files
  const envFiles = ['.env.example', '.env.local', '.env'];
  const declaredVars = new Set();
  let foundEnvFile = false;

  for (const envFile of envFiles) {
    const envPath = path.join(projectRoot, envFile);
    if (fs.existsSync(envPath)) {
      foundEnvFile = true;
      const vars = parseEnvFile(envPath);
      for (const v of vars) declaredVars.add(v);
    }
  }

  // Scan source files
  const files = collectFiles(projectRoot);

  if (files.length === 0) {
    return {
      status: 'skip',
      message: `${name} — no JS/TS files found to scan`,
    };
  }

  // Collect all env var references
  const allRefs = new Map(); // varName → [{ file, line }]

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const refs = extractEnvReferences(content);
    for (const ref of refs) {
      if (BUILTIN_VARS.has(ref.varName)) continue;

      if (!allRefs.has(ref.varName)) {
        allRefs.set(ref.varName, []);
      }
      allRefs.get(ref.varName).push({
        file: path.relative(projectRoot, file),
        line: ref.line,
      });
    }
  }

  if (allRefs.size === 0) {
    return {
      status: 'pass',
      message: `${name} — no custom environment variables referenced in code`,
    };
  }

  if (!foundEnvFile) {
    // All referenced vars are undeclared since there's no env file
    const varNames = [...allRefs.keys()];
    return {
      status: 'warn',
      message: `${name} — ${varNames.length} env var(s) referenced but no .env / .env.example file found`,
      fix: 'Create a .env.example file listing all required environment variables',
      details: varNames.slice(0, 15).map((v) => {
        const locs = allRefs.get(v);
        return {
          file: locs[0].file,
          line: locs[0].line,
          message: `process.env.${v} — not declared in any .env file`,
        };
      }),
    };
  }

  // Find undeclared vars
  const undeclared = [];
  for (const [varName, locations] of allRefs) {
    if (!declaredVars.has(varName)) {
      undeclared.push({ varName, locations });
    }
  }

  if (undeclared.length === 0) {
    return {
      status: 'pass',
      message: `${name} — all ${allRefs.size} referenced env vars are declared`,
    };
  }

  return {
    status: 'warn',
    message: `${name} — ${undeclared.length} env var(s) referenced in code but not declared in .env files`,
    fix: 'Add the missing variables to .env.example and configure them in your deployment platform\'s env settings',
    details: undeclared.slice(0, 15).map((u) => ({
      file: u.locations[0].file,
      line: u.locations[0].line,
      message: `process.env.${u.varName} — used in ${u.locations.length} file(s) but not declared`,
    })),
  };
}

module.exports = { name, run };
