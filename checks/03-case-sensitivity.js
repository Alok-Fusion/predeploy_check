'use strict';

const fs = require('fs');
const path = require('path');

const name = 'Case Sensitivity: import path mismatches';

// File extensions to scan for import statements
const SCAN_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.mts']);

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.vercel',
  '.output', 'coverage', '__pycache__', '.cache',
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
 * Extract relative import paths from a file's content.
 * Returns array of { line, importPath } objects.
 */
function extractImports(content) {
  const imports = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: import ... from './path' or import ... from "../path"
    // Match: require('./path') or require("../path")
    // Match: import('./path') dynamic imports
    const patterns = [
      /(?:from|require|import)\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
      /from\s+['"](\.[^'"]+)['"]/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        imports.push({
          line: i + 1,
          importPath: match[1],
        });
      }
    }
  }

  return imports;
}

/**
 * Build a map of directory → Set of actual filenames (preserving case).
 */
function buildFilenameCache(projectRoot) {
  const cache = new Map();

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const names = new Set();
    for (const entry of entries) {
      names.add(entry.name);
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        walk(path.join(dir, entry.name));
      }
    }
    cache.set(dir, names);
  }

  walk(projectRoot);
  return cache;
}

/**
 * Resolve an import path to an actual file, trying common extensions.
 * Returns { resolved, actual } where:
 *   - resolved is the expected filename from the import
 *   - actual is the real filename on disk (may differ in case)
 *   - null if the file doesn't exist at all
 */
function resolveImport(importPath, fromFile, filenameCache) {
  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);
  const dir = path.dirname(resolved);
  const basename = path.basename(resolved);

  const dirFiles = filenameCache.get(dir);
  if (!dirFiles) return null;

  // Extensions to try if the import has no extension
  const ext = path.extname(basename);
  const candidates = ext
    ? [basename]
    : [
        `${basename}.js`, `${basename}.ts`, `${basename}.jsx`, `${basename}.tsx`,
        `${basename}.mjs`, `${basename}.mts`,
        // index files
        `${basename}/index.js`, `${basename}/index.ts`,
        `${basename}/index.jsx`, `${basename}/index.tsx`,
      ];

  for (const candidate of candidates) {
    // Handle directory/index patterns
    if (candidate.includes('/')) {
      const [subDir, indexFile] = candidate.split('/');
      const subDirPath = path.join(dir, subDir);
      const subFiles = filenameCache.get(subDirPath);

      if (subFiles) {
        // Check if directory name itself has a case mismatch
        if (dirFiles) {
          for (const actual of dirFiles) {
            if (actual.toLowerCase() === subDir.toLowerCase() && actual !== subDir) {
              return { expected: subDir, actual, type: 'directory' };
            }
          }
        }
        // Check index file inside the directory
        for (const actual of subFiles) {
          if (actual.toLowerCase() === indexFile.toLowerCase() && actual !== indexFile) {
            return { expected: indexFile, actual, type: 'file' };
          }
        }
      }
      continue;
    }

    // Direct file match
    for (const actual of dirFiles) {
      if (actual.toLowerCase() === candidate.toLowerCase()) {
        if (actual !== candidate) {
          return { expected: candidate, actual, type: 'file' };
        }
        // Exact match — no case issue
        return null;
      }
    }
  }

  return null; // File not found at all — not a case issue, just a missing file
}

async function run(projectRoot) {
  const files = collectFiles(projectRoot);

  if (files.length === 0) {
    return {
      status: 'skip',
      message: `${name} — no JS/TS files found to scan`,
    };
  }

  const filenameCache = buildFilenameCache(projectRoot);
  const mismatches = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const imports = extractImports(content);

    for (const imp of imports) {
      const result = resolveImport(imp.importPath, file, filenameCache);
      if (result) {
        const relFile = path.relative(projectRoot, file);
        mismatches.push({
          file: relFile,
          line: imp.line,
          importPath: imp.importPath,
          expected: result.expected,
          actual: result.actual,
        });
      }
    }
  }

  if (mismatches.length === 0) {
    return {
      status: 'pass',
      message: `${name} — all ${files.length} files checked, no case mismatches found`,
    };
  }

  return {
    status: 'warn',
    message: `${name} — ${mismatches.length} case mismatch(es) found (will fail on Vercel's Linux filesystem)`,
    fix: 'Rename the import paths to exactly match the filename casing on disk',
    details: mismatches.map((m) => ({
      file: m.file,
      line: m.line,
      message: `Import "${m.importPath}" references "${m.expected}" but file on disk is "${m.actual}"`,
    })),
  };
}

module.exports = { name, run };
