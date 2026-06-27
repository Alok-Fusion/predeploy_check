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
 * Run all checks against the given project root and collect their raw
 * results, without printing anything. This is the single source of truth
 * that both the terminal formatter and the JSON formatter consume, so the
 * two output modes can never drift out of sync with each other.
 */
async function collectResults(projectRoot, options = {}) {
  const allResults = [];

  for (const check of checks) {
    try {
      const results = await check.run(projectRoot, options);
      const resultArray = Array.isArray(results) ? results : [results];

      for (const result of resultArray) {
        allResults.push({ checkName: check.name, ...result });
      }
    } catch (err) {
      allResults.push({
        checkName: check.name,
        status: 'error',
        message: `${check.name}: internal error — ${err.message}`,
      });
    }
  }

  return allResults;
}

/**
 * Compute summary counts and the overall exit code from a results array.
 * Both output modes (terminal and JSON) use this so the numbers always
 * match regardless of how they're displayed.
 */
function summarize(allResults) {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 };
  for (const result of allResults) {
    counts[result.status] = (counts[result.status] || 0) + 1;
  }
  const hasFail = counts.fail > 0 || counts.error > 0;
  return { counts, hasFail, exitCode: hasFail ? 1 : 0 };
}

/**
 * Print results to the terminal with colors, icons, and a summary —
 * the original human-readable output format.
 */
function printTerminalOutput(projectRoot, options, allResults, summary) {
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

  for (const result of allResults) {
    if (result.status === 'error') {
      console.log(chalk.red(`❌ ${result.message}`));
    } else {
      console.log(formatResult(result));
    }
    console.log('');
  }

  console.log(chalk.dim('  ─'.repeat(30)));

  const { counts, hasFail } = summary;
  const parts = [];
  if (counts.pass > 0) parts.push(chalk.green(`${counts.pass} passed`));
  if (counts.warn > 0) parts.push(chalk.yellow(`${counts.warn} warnings`));
  if (counts.fail + counts.error > 0) parts.push(chalk.red(`${counts.fail + counts.error} failed`));
  if (counts.skip > 0) parts.push(chalk.gray(`${counts.skip} skipped`));

  console.log(`\n  ${chalk.bold('Summary:')} ${parts.join(chalk.dim(' · '))}`);

  if (hasFail) {
    console.log(chalk.red.bold('\n  Deploy will likely fail. Fix ❌ issues above.\n'));
  } else if (counts.warn > 0) {
    console.log(chalk.yellow('\n  Some warnings detected. Review ⚠️  items above.\n'));
  } else {
    console.log(chalk.green.bold('\n  All checks passed! You\'re good to deploy. 🚀\n'));
  }
}

/**
 * Print results as a single machine-readable JSON object to stdout.
 * No colors, no decoration — designed for CI dashboards, GitHub bots,
 * editor extensions, or anything else that needs to parse the output
 * programmatically rather than read it.
 */
function printJsonOutput(projectRoot, options, allResults, summary) {
  const output = {
    tool: 'predeploy-check',
    version: require('./package.json').version,
    projectRoot,
    live: Boolean(options.live),
    summary: {
      passed: summary.counts.pass,
      warnings: summary.counts.warn,
      failed: summary.counts.fail + summary.counts.error,
      skipped: summary.counts.skip,
    },
    willLikelyFail: summary.hasFail,
    checks: allResults.map((r) => ({
      check: r.checkName,
      status: r.status,
      message: r.message,
      fix: r.fix || null,
      details: r.details || [],
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Run all checks against the given project root.
 * Returns exit code: 1 if any ❌, 0 otherwise.
 */
async function runAllChecks(projectRoot, options = {}) {
  const allResults = await collectResults(projectRoot, options);
  const summary = summarize(allResults);

  if (options.json) {
    printJsonOutput(projectRoot, options, allResults, summary);
  } else {
    printTerminalOutput(projectRoot, options, allResults, summary);
  }

  return summary.exitCode;
}

module.exports = { runAllChecks, collectResults, summarize };
