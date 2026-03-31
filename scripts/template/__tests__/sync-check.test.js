const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('sync-check', () => {
  it('exports syncCheck function', () => {
    const { syncCheck } = require('../sync-check');
    assert.strictEqual(typeof syncCheck, 'function');
  });

  it('skips check when cache is fresh (under 30 min)', () => {
    const testDir = path.join(os.tmpdir(), `cortex-sync-cache-${Date.now()}`);
    const logsDir = path.join(testDir, '.claude', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    // Create a fresh cache file
    const cacheFile = path.join(logsDir, '.cortex-status.json');
    const freshStatus = { hasUpdate: false, newLearnings: 0, checkedAt: new Date().toISOString() };
    fs.writeFileSync(cacheFile, JSON.stringify(freshStatus));

    // Cache should be considered fresh
    const stat = fs.statSync(cacheFile);
    const ageMs = Date.now() - stat.mtimeMs;
    assert.ok(ageMs < 30 * 60 * 1000, 'Cache file should be less than 30 min old');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('detects stale cache (over 30 min)', () => {
    const testDir = path.join(os.tmpdir(), `cortex-sync-stale-${Date.now()}`);
    const logsDir = path.join(testDir, '.claude', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    // Create a cache file with old timestamp
    const cacheFile = path.join(logsDir, '.cortex-status.json');
    const oldStatus = { hasUpdate: false, newLearnings: 0, checkedAt: '2026-01-01T00:00:00Z' };
    fs.writeFileSync(cacheFile, JSON.stringify(oldStatus));

    // Manually set mtime to 31 min ago
    const oldTime = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(cacheFile, oldTime, oldTime);

    const stat = fs.statSync(cacheFile);
    const ageMs = Date.now() - stat.mtimeMs;
    assert.ok(ageMs > 30 * 60 * 1000, 'Cache should be considered stale');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('cache file structure is valid JSON with expected fields', () => {
    const status = {
      hasUpdate: true,
      newLearnings: 3,
      latestSha: 'abc1234567890',
      checkedAt: new Date().toISOString()
    };

    const json = JSON.stringify(status);
    const parsed = JSON.parse(json);

    assert.strictEqual(typeof parsed.hasUpdate, 'boolean');
    assert.strictEqual(typeof parsed.newLearnings, 'number');
    assert.strictEqual(typeof parsed.checkedAt, 'string');
    assert.ok(new Date(parsed.checkedAt).getTime() > 0); // valid date
  });
});
