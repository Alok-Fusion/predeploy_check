'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

// Dynamically load all check modules from /checks/
const checksDir = path.join(__dirname, 'checks');
const checkFiles = fs.readdirSync(checksDir)
  .filter((f) => f.endsWith('.js'))
  .sort();

const checks = checkFiles.map((f) => {
  const mod = require(path.join(checksDir, f));
  return {
    name: mod.name || f.replace('.js', ''),
    run: mod.run,
  };
});

const STATUS_ICONS = {
  pass: chalk.green('✅'),
  warn: chalk.yellow('⚠️ '),
  fail: chalk.red('❌'),
  skip: chalk.gray('⏭️ '),
};

const STATUS_COLORS = {
  pass: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
  skip: chalk.gray,
};

/**
 * Format a single result line.
 */
function formatResult(result) {
  const icon = STATUS_ICONS[result.status] || '?';
  const color = STATUS_COLORS[result.status] || chalk.white;
  const lines = [];

  lines.push(`${icon} ${color.bold(result.message)}`);

  if (result.details && result.details.length > 0) {
    for (const detail of result.details) {
      const loc = detail.file
        ? chalk.dim(`  ${detail.file}${detail.line ? `:${detail.line}` : ''}`)
        : '';
      if (loc) lines.push(loc);
      if (detail.message) lines.push(chalk.dim(`    → ${detail.message}`));
    }
  }

  if (result.fix && result.status !== 'pass') {
    lines.push(chalk.cyan(`  💡 Fix: ${result.fix}`));
  }

  return lines.join('\n');
}

/**
 * Run all checks against the given project root.
 * Returns exit code: 1 if any ❌, 0 otherwise.
 */
async function runAllChecks(projectRoot, options = {}) {
  console.log('');
  console.log(chalk.bold.underline(`  predeploy-check`) + chalk.dim(`  scanning ${projectRoot}`));
  if (options.live) {
    if (typeof fetch === 'function') {
      console.log(chalk.dim('  live mode: verifying wheel availability against PyPI (requires internet)'));
    } else {
      console.log(chalk.yellow('  live mode requested, but this Node.js version has no global fetch (needs Node 18+) — falling back to static checks'));
    }
  }
  console.log(chalk.dim('  ─'.repeat(30)));
  console.log('');

  let hasFail = false;
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const check of checks) {
    try {
      const results = await check.run(projectRoot, options);

      // A check can return a single result or an array of results
      const resultArray = Array.isArray(results) ? results : [results];

      for (const result of resultArray) {
        console.log(formatResult(result));
        console.log('');

        if (result.status === 'fail') {
          hasFail = true;
          failCount++;
        } else if (result.status === 'warn') {
          warnCount++;
        } else if (result.status === 'skip') {
          skipCount++;
        } else {
          passCount++;
        }
      }
    } catch (err) {
      console.log(chalk.red(`❌ ${check.name}: internal error — ${err.message}`));
      console.log('');
      hasFail = true;
      failCount++;
    }
  }

  // Summary bar
  console.log(chalk.dim('  ─'.repeat(30)));

  const parts = [];
  if (passCount > 0) parts.push(chalk.green(`${passCount} passed`));
  if (warnCount > 0) parts.push(chalk.yellow(`${warnCount} warnings`));
  if (failCount > 0) parts.push(chalk.red(`${failCount} failed`));
  if (skipCount > 0) parts.push(chalk.gray(`${skipCount} skipped`));

  console.log(`\n  ${chalk.bold('Summary:')} ${parts.join(chalk.dim(' · '))}`);

  if (hasFail) {
    console.log(chalk.red.bold('\n  Deploy will likely fail. Fix ❌ issues above.\n'));
  } else if (warnCount > 0) {
    console.log(chalk.yellow('\n  Some warnings detected. Review ⚠️  items above.\n'));
  } else {
    console.log(chalk.green.bold('\n  All checks passed! You\'re good to deploy. 🚀\n'));
  }

  return hasFail ? 1 : 0;
}

module.exports = { runAllChecks };
