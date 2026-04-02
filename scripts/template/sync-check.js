#!/usr/bin/env node
/**
 * Claude Cortex — Sync Check
 *
 * Lightweight check for template updates via npm registry.
 * Writes result to .claude/logs/.cortex-status.json
 *
 * Called by:
 * - SessionStart hook (always runs)
 * - PreToolUse hook (async, max every 30 min via cache check)
 *
 * Read by:
 * - StatusLine for notification display
 */

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CACHE_FILE = path.join(PROJECT_DIR, '.claude', 'logs', '.cortex-status.json');
const CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const NPM_PACKAGE_NAME = 'cortex-init';
const FETCH_TIMEOUT_MS = 5000;

/**
 * Compare two semver strings. Returns true if remote > local.
 * @param {string} local - e.g. "1.0.0"
 * @param {string} remote - e.g. "1.2.0"
 * @returns {boolean}
 */
function isNewerVersion(local, remote) {
  if (!local || !remote) return false;
  const l = local.split('.').map(Number);
  const r = remote.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

async function syncCheck() {
  // Ensure logs directory exists
  const logsDir = path.join(PROJECT_DIR, '.claude', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  // Check cache age
  if (fs.existsSync(CACHE_FILE)) {
    const stat = fs.statSync(CACHE_FILE);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < CACHE_MAX_AGE_MS) {
      // Cache is fresh — still show notification if update was found previously
      try {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        if (cached.hasUpdate) {
          console.error(`[Cortex] Update: ${cached.currentVersion} → ${cached.latestVersion} — Run: npx cortex-init@latest --update`);
        }
      } catch {}
      return;
    }
  }

  // Read manifest
  const manifestPath = path.join(PROJECT_DIR, '.claude-template.json');
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const currentVersion = manifest.version;

  let status = {
    hasUpdate: false,
    currentVersion,
    latestVersion: currentVersion,
    checkedAt: new Date().toISOString()
  };

  try {
    // Check npm registry for latest version
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const latestVersion = data.version;

      status.latestVersion = latestVersion;
      status.hasUpdate = isNewerVersion(currentVersion, latestVersion);
    }
  } catch {
    // Network unreachable, npm registry down, timeout — silent fail
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(status, null, 2) + '\n');

  // Show notification if update available
  if (status.hasUpdate) {
    console.error(`[Cortex] Update: ${status.currentVersion} → ${status.latestVersion} — Run: npx cortex-init@latest --update`);
  }
}

// CLI
if (require.main === module) {
  syncCheck();
}

module.exports = { syncCheck, isNewerVersion };
