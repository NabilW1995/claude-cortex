const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Claude Cortex Integration Test', () => {
  let testDir;

  before(() => {
    // Create a temp directory simulating an existing project
    testDir = path.join(os.tmpdir(), `cortex-integration-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Simulate an existing project with:
    // - A CLAUDE.md with project-specific content
    // - A settings.json with custom permissions
    // - A package.json
    // - An existing agent
    fs.writeFileSync(path.join(testDir, 'CLAUDE.md'),
      '# My Awesome App\nA cool project I am building.\n\n## Commands\n`npm start`\n\n## Projekt-Struktur\nsrc/ - source code\n\n## Gotchas\nWatch out for timezone issues\n');

    fs.mkdirSync(path.join(testDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.claude/settings.json'),
      JSON.stringify({
        permissions: { allow: ["Bash(my-custom-tool *)"], deny: [] },
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo my-project-hook" }] }] }
      }, null, 2));

    fs.writeFileSync(path.join(testDir, 'package.json'),
      JSON.stringify({
        name: "my-awesome-app",
        version: "2.0.0",
        scripts: { start: "node index.js", test: "vitest" },
        dependencies: { express: "^4.18.0" }
      }, null, 2));

    // Existing agent
    fs.mkdirSync(path.join(testDir, '.claude/agents'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.claude/agents/my-custom-agent.md'),
      '# My Custom Agent\nDoes custom stuff\n');
  });

  after(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Install', () => {
    it('installs successfully into existing project', () => {
      // Clear module cache so install.js runs fresh
      delete require.cache[require.resolve('../install')];
      delete require.cache[require.resolve('../merge-claude-md')];
      delete require.cache[require.resolve('../merge-settings')];
      const { install } = require('../install');
      // Should not throw
      install(testDir);
    });

    it('creates .claude-template.json manifest', () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(testDir, '.claude-template.json'), 'utf-8'));
      assert.strictEqual(manifest.name, 'claude-cortex');
      assert.strictEqual(manifest.version, '1.0.0');
      assert.strictEqual(manifest.repo, 'NabilW1995/claude-cortex');
      assert.ok(manifest.installedAt);
    });

    it('copies all template rules', () => {
      const rules = fs.readdirSync(path.join(testDir, '.claude/rules'));
      assert.ok(rules.includes('security.md'));
      assert.ok(rules.includes('design-flow.md'));
      assert.ok(rules.includes('browser-use.md'));
      assert.ok(rules.includes('learning-system.md'));
      assert.ok(rules.includes('testing.md'));
    });

    it('copies template agents WITHOUT overwriting existing ones', () => {
      const agents = fs.readdirSync(path.join(testDir, '.claude/agents'));
      // Template agents added
      assert.ok(agents.includes('core--coder.md'));
      assert.ok(agents.includes('fix--error-translator.md'));
      // Custom agent preserved
      assert.ok(agents.includes('my-custom-agent.md'));
      const customContent = fs.readFileSync(path.join(testDir, '.claude/agents/my-custom-agent.md'), 'utf-8');
      assert.ok(customContent.includes('My Custom Agent'));
    });

    it('copies commands and hooks', () => {
      const commands = fs.readdirSync(path.join(testDir, '.claude/commands'));
      assert.ok(commands.includes('audit.md'));
      assert.ok(commands.includes('template-update.md'));

      const hooks = fs.readdirSync(path.join(testDir, 'scripts/hooks'));
      assert.ok(hooks.includes('guard-bash.sh'));
      assert.ok(hooks.includes('session-start.js'));
    });

    it('merges CLAUDE.md preserving project content', () => {
      const content = fs.readFileSync(path.join(testDir, 'CLAUDE.md'), 'utf-8');
      // Project content preserved
      assert.ok(content.includes('# My Awesome App'), 'project header preserved');
      assert.ok(content.includes('timezone issues'), 'gotchas preserved');
      assert.ok(content.includes('npm start'), 'project commands preserved');
      // Template sections added with markers
      assert.ok(content.includes('CORTEX:REFERENCES:START'), 'reference docs marker added');
      assert.ok(content.includes('CORTEX:TOP_RULES:START'), 'top rules marker added');
    });

    it('merges settings.json preserving project hooks and permissions', () => {
      const settings = JSON.parse(fs.readFileSync(path.join(testDir, '.claude/settings.json'), 'utf-8'));
      // Project permission preserved
      assert.ok(settings.permissions.allow.includes('Bash(my-custom-tool *)'));
      // Template permissions added
      assert.ok(settings.permissions.allow.includes('Bash(browser-use *)'));
      // Project hook preserved
      const sessionStartCmds = JSON.stringify(settings.hooks.SessionStart);
      assert.ok(sessionStartCmds.includes('my-project-hook'));
      // Template hooks added
      assert.ok(sessionStartCmds.includes('session-start.js'));
      // Template deny rules added
      assert.ok(settings.permissions.deny.includes('Bash(rm -rf *)'));
    });

    it('merges package.json preserving existing deps and scripts', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(testDir, 'package.json'), 'utf-8'));
      // Existing preserved
      assert.strictEqual(pkg.name, 'my-awesome-app');
      assert.strictEqual(pkg.dependencies.express, '^4.18.0');
      assert.strictEqual(pkg.scripts.start, 'node index.js');
      // Cortex added
      assert.ok(pkg.dependencies['sql.js']);
      assert.ok(pkg.scripts['db:init']);
      assert.ok(pkg.scripts['cortex:update']);
    });

    it('creates knowledge files', () => {
      assert.ok(fs.existsSync(path.join(testDir, '.claude/knowledge-base.md')));
      assert.ok(fs.existsSync(path.join(testDir, '.claude/knowledge-nominations.md')));
      assert.ok(fs.existsSync(path.join(testDir, '.claude/team-learnings.json')));
    });

    it('updates .gitignore with cortex entries', () => {
      const gitignore = fs.readFileSync(path.join(testDir, '.gitignore'), 'utf-8');
      assert.ok(gitignore.includes('# Claude Cortex'));
      assert.ok(gitignore.includes('CLAUDE.local.md'));
      assert.ok(gitignore.includes('.mcp.json'));
    });
  });

  describe('Modules', () => {
    it('merge-claude-md exports work correctly', () => {
      const { parseSections, mergeCLAUDEmd } = require('../merge-claude-md');
      assert.strictEqual(typeof parseSections, 'function');
      assert.strictEqual(typeof mergeCLAUDEmd, 'function');
    });

    it('merge-settings exports work correctly', () => {
      const { mergeSettings } = require('../merge-settings');
      assert.strictEqual(typeof mergeSettings, 'function');
    });

    it('sync-check exports work correctly', () => {
      const { syncCheck } = require('../sync-check');
      assert.strictEqual(typeof syncCheck, 'function');
    });

    it('update exports work correctly', () => {
      const { update } = require('../update');
      assert.strictEqual(typeof update, 'function');
    });
  });
});
