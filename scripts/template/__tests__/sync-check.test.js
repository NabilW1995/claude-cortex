const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('sync-check', () => {
  it('exports syncCheck function', () => {
    const { syncCheck } = require('../sync-check');
    assert.strictEqual(typeof syncCheck, 'function');
  });
});
