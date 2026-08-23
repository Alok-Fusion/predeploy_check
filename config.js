'use strict';

const path = require('path');
const fs = require('fs');

/**
 * The canonical check IDs, matching the filenames in /checks/.
 * Used for validation and for building the default checks map.
 */
const VALID_CHECK_IDS = [
  'python-render',
  'eslint-vercel',
  'case-sensitivity',
  'missing-engines',
  'env-vars',
  'render-start',
  'railway',
];

/**
 * Default config — all checks enabled, no ignores, no custom options.
 * This is what you get if there's no predeploy.config.js in the project.
 */
const DEFAULT_CONFIG = {
  checks: Object.fromEntries(VALID_CHECK_IDS.map((id) => [id, true])),
  ignore: [],
  options: {},
};

/**
 * Map from check filename prefix to check ID.
 * e.g. "01-python-render" → "python-render"
 */
function filenameToCheckId(filename) {
  return filename.replace(/^\d+-/, '').replace('.js', '');
}

/**
 * Load and validate the predeploy.config.js from the project root.
 * Returns a fully-resolved config object with all fields present,
 * merged with defaults so partial configs work correctly.
 *
 * Throws with a clear message if the config file exists but is invalid,
 * so users get actionable feedback rather than a cryptic Node require error.
 */
function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'predeploy.config.js');

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, configPath: null, loaded: false };
  }

  let userConfig;
  try {
    userConfig = require(configPath);
  } catch (err) {
    throw new Error(
      `Failed to load predeploy.config.js: ${err.message}\n` +
      `  Check that ${configPath} is valid JavaScript with a module.exports.`
    );
  }

  if (typeof userConfig !== 'object' || userConfig === null || Array.isArray(userConfig)) {
    throw new Error(
      'predeploy.config.js must export a plain object via module.exports.\n' +
      `  Got: ${Array.isArray(userConfig) ? 'Array' : typeof userConfig}`
    );
  }

  // Validate checks field
  if (userConfig.checks !== undefined) {
    if (typeof userConfig.checks !== 'object' || Array.isArray(userConfig.checks)) {
      throw new Error(
        'predeploy.config.js: "checks" must be a plain object mapping check IDs to true/false.\n' +
        '  Example: checks: { "python-render": false, "env-vars": true }'
      );
    }

    const unknownChecks = Object.keys(userConfig.checks).filter(
      (id) => !VALID_CHECK_IDS.includes(id)
    );
    if (unknownChecks.length > 0) {
      throw new Error(
        `predeploy.config.js: unknown check ID(s): ${unknownChecks.map((id) => `"${id}"`).join(', ')}\n` +
        `  Valid IDs are: ${VALID_CHECK_IDS.map((id) => `"${id}"`).join(', ')}`
      );
    }
  }

  // Validate ignore field
  if (userConfig.ignore !== undefined) {
    if (!Array.isArray(userConfig.ignore)) {
      throw new Error(
        'predeploy.config.js: "ignore" must be an array of path patterns.\n' +
        '  Example: ignore: ["legacy/", "scripts/old-deploy.js"]'
      );
    }
    if (userConfig.ignore.some((p) => typeof p !== 'string')) {
      throw new Error(
        'predeploy.config.js: all entries in "ignore" must be strings.'
      );
    }
  }

  // Validate options field
  if (userConfig.options !== undefined) {
    if (typeof userConfig.options !== 'object' || Array.isArray(userConfig.options)) {
      throw new Error(
        'predeploy.config.js: "options" must be a plain object mapping check IDs to option objects.'
      );
    }
  }

  // Merge with defaults — partial configs work correctly
  const resolved = {
    checks: {
      ...DEFAULT_CONFIG.checks,
      ...(userConfig.checks || {}),
    },
    ignore: userConfig.ignore || [],
    options: userConfig.options || {},
    configPath,
    loaded: true,
  };

  return resolved;
}

/**
 * Check whether a given check ID is enabled in the resolved config.
 */
function isCheckEnabled(config, checkFilename) {
  const id = filenameToCheckId(checkFilename);
  // Default to true for any check not explicitly configured,
  // even if it's a future check added after the user wrote their config.
  return config.checks[id] !== false;
}

/**
 * Get the check-specific options from the config for a given check ID.
 * Returns an empty object if no options were specified, so callers can
 * safely destructure without checking for undefined.
 */
function getCheckOptions(config, checkFilename) {
  const id = filenameToCheckId(checkFilename);
  return config.options[id] || {};
}

/**
 * Check whether a given file path matches any of the ignore patterns.
 * Patterns are matched as simple string prefixes or exact matches,
 * relative to the project root — no regex, no glob, no magic.
 * Simple and predictable is the right tradeoff for a config file.
 */
function isIgnored(config, filePath, projectRoot) {
  if (!config.ignore || config.ignore.length === 0) return false;

  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  return config.ignore.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    return (
      relativePath === normalizedPattern ||
      relativePath.startsWith(normalizedPattern.endsWith('/') ? normalizedPattern : normalizedPattern + '/')
    );
  });
}

module.exports = {
  loadConfig,
  isCheckEnabled,
  getCheckOptions,
  isIgnored,
  VALID_CHECK_IDS,
  DEFAULT_CONFIG,
};
