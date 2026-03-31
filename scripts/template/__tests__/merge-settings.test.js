const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mergeSettings } = require('../merge-settings');

describe('mergeSettings', () => {
  it('merges env vars: template wins, project additions preserved', () => {
    const current = { env: { MY_VAR: "1", CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "70" } };
    const template = { env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "75", NEW_VAR: "2" } };
    const result = mergeSettings(current, template);
    assert.strictEqual(result.env.MY_VAR, "1");
    assert.strictEqual(result.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, "75");
    assert.strictEqual(result.env.NEW_VAR, "2");
  });

  it('merges hook arrays without duplicates', () => {
    const current = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "my-hook.sh" }] }] } };
    const template = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node scripts/hooks/session-start.js" }] }] } };
    const result = mergeSettings(current, template);
    const commands = JSON.stringify(result.hooks.SessionStart);
    assert.ok(commands.includes("my-hook.sh"));
    assert.ok(commands.includes("session-start.js"));
  });

  it('does not duplicate existing hooks', () => {
    const current = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node scripts/hooks/session-start.js" }] }] } };
    const template = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node scripts/hooks/session-start.js" }] }] } };
    const result = mergeSettings(current, template);
    const matches = JSON.stringify(result.hooks.SessionStart).match(/session-start\.js/g);
    assert.strictEqual(matches.length, 1);
  });

  it('preserves project permissions, adds template permissions', () => {
    const current = { permissions: { allow: ["Bash(my-tool *)"], deny: [] } };
    const template = { permissions: { allow: ["Bash(browser-use *)"], deny: ["Bash(rm -rf *)"] } };
    const result = mergeSettings(current, template);
    assert.ok(result.permissions.allow.includes("Bash(my-tool *)"));
    assert.ok(result.permissions.allow.includes("Bash(browser-use *)"));
    assert.ok(result.permissions.deny.includes("Bash(rm -rf *)"));
  });

  it('adds new hook events from template', () => {
    const current = { hooks: {} };
    const template = { hooks: { PreCompact: [{ hooks: [{ type: "command", command: "pre-compact.sh" }] }] } };
    const result = mergeSettings(current, template);
    assert.ok(result.hooks.PreCompact);
    assert.strictEqual(result.hooks.PreCompact[0].hooks[0].command, "pre-compact.sh");
  });

  it('sets template scalars only if project does not have them', () => {
    const current = { cleanupPeriodDays: 60 };
    const template = { cleanupPeriodDays: 90, attribution: { commit: "Co-Authored-By: Claude" } };
    const result = mergeSettings(current, template);
    assert.strictEqual(result.cleanupPeriodDays, 60); // project keeps its value
    assert.deepStrictEqual(result.attribution, { commit: "Co-Authored-By: Claude" }); // new from template
  });

  it('handles empty current settings', () => {
    const current = {};
    const template = { env: { FOO: "1" }, permissions: { allow: ["Read"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] } };
    const result = mergeSettings(current, template);
    assert.strictEqual(result.env.FOO, "1");
    assert.ok(result.permissions.allow.includes("Read"));
    assert.ok(result.hooks.Stop);
  });
});
