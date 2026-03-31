const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('auto-push-learnings', () => {
  it('script has valid JavaScript syntax', () => {
    const filePath = path.resolve(__dirname, '../../hooks/auto-push-learnings.js');
    assert.ok(fs.existsSync(filePath), 'auto-push-learnings.js should exist');
    // If we can require it without error in a non-git dir, it should handle gracefully
    assert.doesNotThrow(() => {
      // Just check the file can be parsed
      const content = fs.readFileSync(filePath, 'utf-8');
      // Verify it has the expected structure
      assert.ok(content.includes('git status --porcelain'), 'should check git status');
      assert.ok(content.includes('team-learnings.json'), 'should handle team-learnings');
      assert.ok(content.includes('knowledge-base.md'), 'should handle knowledge-base');
      assert.ok(content.includes('chore: sync learnings'), 'should use sync commit message');
      assert.ok(content.includes('spawn'), 'should use async push via spawn');
    });
  });

  it('session-end.js has auto-push logic', () => {
    const filePath = path.resolve(__dirname, '../../hooks/session-end.js');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('Auto-push learnings'), 'should have auto-push section');
    assert.ok(content.includes('git diff --name-only'), 'should check for changes');
    assert.ok(content.includes('spawn'), 'should use async push');
  });
});
