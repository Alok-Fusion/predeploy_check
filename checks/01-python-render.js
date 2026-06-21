'use strict';

const fs = require('fs');
const path = require('path');

const name = 'Python + Render: Rust-compiled dependencies';

// Packages known to have Rust-compiled components that may lack
// prebuilt wheels for bleeding-edge Python versions.
const RUST_DEP_PACKAGES = [
  'pydantic',
  'pydantic-core',
  'fastapi',
  'orjson',
  'cryptography',
  'tiktoken',
  'tokenizers',
  'safetensors',
  'polars',
  'ruff',
  'rpds-py',
  'jiter',
];

/**
 * Parse a Python version string like "python-3.13.2" or "3.13" into
 * { major, minor } or null if unparseable.
 */
function parsePythonVersion(raw) {
  const match = raw.match(/(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

/**
 * Parse requirements.txt and return an array of { name, version } where
 * version is the pinned version if one was specified with "==", else null.
 */
function parseRequirements(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
    .map((line) => {
      const beforeSemicolon = line.split(';')[0].trim(); // strip env markers
      const name = beforeSemicolon.split(/[>=<!~\[\s]/)[0].toLowerCase().replace(/_/g, '-');
      const pinMatch = beforeSemicolon.match(/==\s*([\d][\w.]*)/);
      return { name, version: pinMatch ? pinMatch[1] : null };
    })
    .filter((pkg) => pkg.name);
}

/**
 * Query PyPI's JSON API to check whether a prebuilt wheel exists for the
 * given package, version, and CPython minor version (e.g. "313" for 3.13).
 * Returns true/false/null (null = couldn't determine, e.g. network error
 * or unpinned version — caller should fall back to the static warning).
 */
async function checkWheelAvailability(pkgName, pkgVersion, major, minor) {
  if (!pkgVersion) return null; // no pinned version, can't query a specific release

  if (typeof fetch !== 'function') {
    // Node < 18 has no global fetch. Treat as unknown rather than crashing,
    // so --live degrades to the same "unverified" warn path as a network failure.
    return null;
  }

  const cpTag = `cp${major}${minor}`;

  try {
    const res = await fetch(`https://pypi.org/pypi/${pkgName}/${pkgVersion}/json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const urls = data.urls || [];

    const hasMatchingWheel = urls.some(
      (u) => u.packagetype === 'bdist_wheel' && u.filename.includes(`-${cpTag}-`)
    );
    return hasMatchingWheel;
  } catch {
    return null; // network error, timeout, bad JSON, etc. — treat as unknown
  }
}

async function run(projectRoot, options = {}) {
  const runtimePath = path.join(projectRoot, 'runtime.txt');
  const requirementsPath = path.join(projectRoot, 'requirements.txt');

  // Check if this is a Python project at all
  if (!fs.existsSync(runtimePath) && !fs.existsSync(requirementsPath)) {
    return {
      status: 'skip',
      message: `${name} — no Python project detected`,
    };
  }

  // If there's no runtime.txt, we can't check the version
  if (!fs.existsSync(runtimePath)) {
    return {
      status: 'skip',
      message: `${name} — no runtime.txt found, skipping version check`,
    };
  }

  const runtimeContent = fs.readFileSync(runtimePath, 'utf-8').trim();
  const version = parsePythonVersion(runtimeContent);

  if (!version) {
    return {
      status: 'warn',
      message: `${name} — could not parse Python version from runtime.txt`,
      fix: 'Ensure runtime.txt contains a valid version like "python-3.12.3"',
      details: [{ file: 'runtime.txt', message: `Content: "${runtimeContent}"` }],
    };
  }

  // Only flag Python >= 3.13
  if (version.major < 3 || (version.major === 3 && version.minor < 13)) {
    return {
      status: 'pass',
      message: `${name} — Python ${version.major}.${version.minor} is well-supported`,
    };
  }

  // Now check requirements.txt for Rust-compiled deps
  if (!fs.existsSync(requirementsPath)) {
    return {
      status: 'warn',
      message: `${name} — Python ${version.major}.${version.minor} detected but no requirements.txt found`,
      fix: 'Add a requirements.txt or pin Python to 3.12 in runtime.txt',
      details: [{ file: 'runtime.txt' }],
    };
  }

  const reqContent = fs.readFileSync(requirementsPath, 'utf-8');
  const packages = parseRequirements(reqContent);
  const flagged = packages.filter((pkg) => RUST_DEP_PACKAGES.includes(pkg.name));

  if (flagged.length === 0) {
    return {
      status: 'pass',
      message: `${name} — Python ${version.major}.${version.minor} with no known Rust-compiled deps`,
    };
  }

  // ── Static mode (default): warn based on the known-package list alone ──
  if (!options.live) {
    return {
      status: 'warn',
      message: `${name} — Python ${version.major}.${version.minor} with Rust-compiled dependencies`,
      fix: `Pin to Python 3.12 in runtime.txt ("python-3.12.7"), or re-run with --live to verify wheel availability for ${version.major}.${version.minor}`,
      details: flagged.map((pkg) => ({
        file: 'requirements.txt',
        message: `"${pkg.name}" has Rust-compiled components — prebuilt wheels may not exist for Python ${version.major}.${version.minor}`,
      })),
    };
  }

  // ── Live mode: actually query PyPI to confirm wheel availability ──
  const liveResults = await Promise.all(
    flagged.map(async (pkg) => {
      const available = await checkWheelAvailability(pkg.name, pkg.version, version.major, version.minor);
      return { ...pkg, available };
    })
  );

  const confirmedMissing = liveResults.filter((r) => r.available === false);
  const unknown = liveResults.filter((r) => r.available === null);
  const confirmedOk = liveResults.filter((r) => r.available === true);

  if (confirmedMissing.length === 0 && unknown.length === 0) {
    return {
      status: 'pass',
      message: `${name} — verified wheels exist on PyPI for Python ${version.major}.${version.minor}`,
      details: confirmedOk.map((pkg) => ({
        file: 'requirements.txt',
        message: `"${pkg.name}${pkg.version ? `==${pkg.version}` : ''}" has a confirmed cp${version.major}${version.minor} wheel`,
      })),
    };
  }

  const details = [];
  for (const pkg of confirmedMissing) {
    details.push({
      file: 'requirements.txt',
      message: `"${pkg.name}${pkg.version ? `==${pkg.version}` : ''}" — confirmed: no wheel for Python ${version.major}.${version.minor}`,
    });
  }
  for (const pkg of unknown) {
    details.push({
      file: 'requirements.txt',
      message: `"${pkg.name}" — could not verify (unpinned version or PyPI lookup failed); treat as at-risk`,
    });
  }

  return {
    status: confirmedMissing.length > 0 ? 'fail' : 'warn',
    message: `${name} — wheel availability ${confirmedMissing.length > 0 ? 'confirmed missing' : 'unverified'} for Python ${version.major}.${version.minor}`,
    fix: `Pin to Python 3.12 in runtime.txt ("python-3.12.7"), or upgrade the affected package(s) to a version with a cp${version.major}${version.minor} wheel`,
    details,
  };
}

module.exports = { name, run };
