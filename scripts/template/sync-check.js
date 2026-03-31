#!/usr/bin/env node
/**
 * Claude Cortex — Sync Check
 *
 * Lightweight check for template updates + new team learnings.
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
const { execSync } = require('child_process');

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CACHE_FILE = path.join(PROJECT_DIR, '.claude', 'logs', '.cortex-status.json');
const CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

function syncCheck() {
  // Ensure logs directory exists
  const logsDir = path.join(PROJECT_DIR, '.claude', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  // Check cache age
  if (fs.existsSync(CACHE_FILE)) {
    const stat = fs.statSync(CACHE_FILE);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < CACHE_MAX_AGE_MS) {
      return; // Cache is fresh, skip check
    }
  }

  // Read manifest
  const manifestPath = path.join(PROJECT_DIR, '.claude-template.json');
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const repo = manifest.repo;

  let status = {
    hasUpdate: false,
    newLearnings: 0,
    latestSha: null,
    checkedAt: new Date().toISOString()
  };

  try {
    // Check latest commit SHA
    const latestSha = execSync(`gh api repos/${repo}/commits/HEAD --jq .sha`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000
    }).trim();

    // Read previous status to compare
    let previousSha = null;
    if (fs.existsSync(CACHE_FILE)) {
      try {
        const prev = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        previousSha = prev.latestSha;
      } catch {}
    }

    status.latestSha = latestSha;
    status.hasUpdate = previousSha !== null && previousSha !== latestSha;

    // Check for new learnings
    try {
      const remoteJson = execSync(`gh api repos/${repo}/contents/.claude/team-learnings.json --jq .content`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000
      }).trim();
      const remoteData = JSON.parse(Buffer.from(remoteJson, 'base64').toString('utf-8'));

      const localPath = path.join(PROJECT_DIR, '.claude', 'team-learnings.json');
      if (fs.existsSync(localPath)) {
        const localData = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
        const localFingerprints = new Set(localData.learnings.map(l => l.fingerprint));
        const newOnes = remoteData.learnings.filter(l => !localFingerprints.has(l.fingerprint));
        status.newLearnings = newOnes.length;
      }
    } catch {}

  } catch {
    // GitHub unreachable — write cache with no update
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(status, null, 2) + '\n');
}

// CLI
if (require.main === module) {
  syncCheck();
}

module.exports = { syncCheck };
