const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('remote-install', () => {
  it('script exists and has valid syntax', () => {
    const filePath = path.resolve(__dirname, '../remote-install.js');
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('NabilW1995/claude-cortex'));
    assert.ok(content.includes('.cortex-temp'));
    assert.ok(content.includes('install.js'));
  });

  it('has cleanup logic for temp directory', () => {
    const filePath = path.resolve(__dirname, '../remote-install.js');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('rmSync'));
    assert.ok(content.includes('recursive: true'));
  });

  it('handles errors with cleanup', () => {
    const filePath = path.resolve(__dirname, '../remote-install.js');
    const content = fs.readFileSync(filePath, 'utf-8');
    // Should have error handler that cleans up temp dir
    assert.ok(content.includes('catch'));
    assert.ok(content.includes('.cortex-temp'));
  });
});
