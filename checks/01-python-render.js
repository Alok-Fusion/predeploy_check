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
 * Parse requirements.txt and return an array of lowercase package names.
 */
function parseRequirements(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
    .map((line) => {
      // Strip version specifiers, extras, etc.
      const name = line.split(/[>=<!~\[;@\s]/)[0];
      return name.toLowerCase().replace(/_/g, '-');
    })
    .filter(Boolean);
}

async function run(projectRoot) {
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
  const flagged = packages.filter((pkg) => RUST_DEP_PACKAGES.includes(pkg));

  if (flagged.length === 0) {
    return {
      status: 'pass',
      message: `${name} — Python ${version.major}.${version.minor} with no known Rust-compiled deps`,
    };
  }

  return {
    status: 'warn',
    message: `${name} — Python ${version.major}.${version.minor} with Rust-compiled dependencies`,
    fix: `Pin to Python 3.12 in runtime.txt ("python-3.12.7") or verify wheel availability for ${version.major}.${version.minor}`,
    details: flagged.map((pkg) => ({
      file: 'requirements.txt',
      message: `"${pkg}" has Rust-compiled components — prebuilt wheels may not exist for Python ${version.major}.${version.minor}`,
    })),
  };
}

module.exports = { name, run };
