'use strict';

const fs = require('fs');
const path = require('path');

const name = 'ESLint + Vercel: Next.js peer-dependency conflicts';

/**
 * Parse a semver-like version string and return the major version number.
 * Handles ranges like "^9.0.0", "~8.2.0", ">=9.0.0", "9.x", etc.
 */
function extractMajor(versionRange) {
  if (!versionRange) return null;
  const match = versionRange.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Normalize a version range to a comparable string by stripping
 * range prefixes like ^, ~, >=, etc.
 */
function normalizeRange(versionRange) {
  if (!versionRange) return '';
  return versionRange.replace(/^[\^~>=<\s]+/, '').trim();
}

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

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const results = [];

  // Check if this is a Next.js project
  const hasNext = !!allDeps['next'];
  const hasEslint = !!allDeps['eslint'];
  const hasEslintConfigNext = !!allDeps['eslint-config-next'];

  if (!hasNext) {
    return {
      status: 'skip',
      message: `${name} — not a Next.js project`,
    };
  }

  // ── Check 1: ESLint / eslint-config-next version mismatch ──

  if (hasEslint && hasEslintConfigNext) {
    const eslintMajor = extractMajor(allDeps['eslint']);
    const configNextMajor = extractMajor(allDeps['eslint-config-next']);
    const nextMajor = extractMajor(allDeps['next']);

    // eslint-config-next should typically match the Next.js major version
    if (configNextMajor !== null && nextMajor !== null && configNextMajor !== nextMajor) {
      results.push({
        status: 'fail',
        message: `${name} — eslint-config-next@${allDeps['eslint-config-next']} does not match next@${allDeps['next']}`,
        fix: `Run: npm install eslint-config-next@${nextMajor} to align with your Next.js version`,
        details: [
          { file: 'package.json', message: `eslint-config-next: ${allDeps['eslint-config-next']}` },
          { file: 'package.json', message: `next: ${allDeps['next']}` },
        ],
      });
    }

    // ESLint 9+ flat config vs older eslint-config-next
    if (eslintMajor !== null && eslintMajor >= 9 && configNextMajor !== null && configNextMajor < 15) {
      results.push({
        status: 'warn',
        message: `${name} — ESLint ${eslintMajor}.x may have peer-dep conflicts with eslint-config-next@${allDeps['eslint-config-next']}`,
        fix: 'Upgrade eslint-config-next to a version compatible with ESLint 9+ flat config, or downgrade ESLint to 8.x',
        details: [
          { file: 'package.json', message: `eslint: ${allDeps['eslint']}` },
          { file: 'package.json', message: `eslint-config-next: ${allDeps['eslint-config-next']}` },
        ],
      });
    }
  }

  // ── Check 2: Deprecated eslint.ignoreDuringBuilds for Next 16+ ──

  const nextMajor = extractMajor(allDeps['next']);

  if (nextMajor !== null && nextMajor >= 16) {
    // Check multiple possible config file names
    const configNames = [
      'next.config.js',
      'next.config.mjs',
      'next.config.ts',
    ];

    for (const configName of configNames) {
      const configPath = path.join(projectRoot, configName);
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        if (content.includes('ignoreDuringBuilds')) {
          results.push({
            status: 'warn',
            message: `${name} — deprecated eslint.ignoreDuringBuilds in ${configName}`,
            fix: 'Next.js 16+ removed built-in ESLint integration. Remove eslint.ignoreDuringBuilds from your config and use a separate ESLint step.',
            details: [{ file: configName, message: 'Contains deprecated "ignoreDuringBuilds" setting' }],
          });
        }
      }
    }
  }

  if (results.length === 0) {
    return {
      status: 'pass',
      message: `${name} — ESLint configuration looks correct`,
    };
  }

  return results;
}

module.exports = { name, run };
