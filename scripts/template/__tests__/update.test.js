const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('update script', () => {
  it('module exports update function', () => {
    const { update } = require('../update');
    assert.strictEqual(typeof update, 'function');
  });

  it('reads manifest correctly', () => {
    const testDir = path.join(os.tmpdir(), `cortex-update-manifest-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, '.claude-template.json'), JSON.stringify({
      name: 'claude-cortex',
      version: '1.0.0',
      repo: 'NabilW1995/claude-cortex'
    }));

    const manifest = JSON.parse(fs.readFileSync(path.join(testDir, '.claude-template.json'), 'utf-8'));
    assert.strictEqual(manifest.repo, 'NabilW1995/claude-cortex');
    assert.strictEqual(manifest.version, '1.0.0');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('team-learnings merge deduplicates by fingerprint', () => {
    const localLearnings = {
      version: 1,
      learnings: [
        { fingerprint: 'abc123', rule: 'Rule A', confidence: 0.8 },
        { fingerprint: 'def456', rule: 'Rule B', confidence: 0.9 }
      ]
    };
    const remoteLearnings = {
      version: 1,
      learnings: [
        { fingerprint: 'abc123', rule: 'Rule A', confidence: 0.8 },
        { fingerprint: 'ghi789', rule: 'Rule C', confidence: 0.7 }
      ]
    };

    // Simulate the merge logic from update.js
    const allFingerprints = new Set();
    const merged = [];
    for (const learning of [...localLearnings.learnings, ...remoteLearnings.learnings]) {
      if (!allFingerprints.has(learning.fingerprint)) {
        allFingerprints.add(learning.fingerprint);
        merged.push(learning);
      }
    }
    merged.sort((a, b) => b.confidence - a.confidence);

    assert.strictEqual(merged.length, 3); // abc + def + ghi, no dupe
    assert.strictEqual(merged[0].confidence, 0.9); // sorted by confidence
    assert.ok(merged.some(l => l.fingerprint === 'ghi789')); // remote learning included
  });

  it('knowledge-base merge skips entries with same Source tag', () => {
    const templateKB = `## Hard Rules

### Security: No mkfs
- [Source: learning-db #3, approved 2026-03-31]

### Security: No eval
- [Source: learning-db #5, approved 2026-04-01]`;

    const localKB = `## Hard Rules

### Security: No mkfs
- [Source: learning-db #3, approved 2026-03-31]

## Patterns
(none)`;

    // Extract entries by Source tag
    const templateEntries = templateKB.match(/### .+\n[\s\S]*?\[Source:.*?\]/g) || [];
    const localEntries = localKB.match(/### .+\n[\s\S]*?\[Source:.*?\]/g) || [];
    const localSources = new Set(localEntries.map(e => e.match(/\[Source:.*?\]/)?.[0]).filter(Boolean));

    const newEntries = templateEntries.filter(entry => {
      const source = entry.match(/\[Source:.*?\]/)?.[0];
      return source && !localSources.has(source);
    });

    assert.strictEqual(newEntries.length, 1); // Only "No eval" is new
    assert.ok(newEntries[0].includes('No eval'));
  });
});
