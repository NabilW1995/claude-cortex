# Claude Cortex Install/Update System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an install/update system that lets Claude Cortex be added to any project, receive updates from the template repo, and sync learnings bidirectionally.

**Architecture:** A `.claude-template.json` manifest tracks the installed version and template repo URL. Three scripts handle install (first-time setup into existing project), update (pull latest template changes), and sync (bidirectional learning exchange). CLAUDE.md uses section markers for safe merging. A periodic cache check enables StatusLine notifications.

**Tech Stack:** Node.js (scripts), GitHub CLI (`gh`), SQLite (learnings), Git (sync transport)

---

### Task 1: Create `.claude-template.json` manifest

**Files:**
- Create: `.claude-template.json`

**Step 1: Write the manifest file**

```json
{
  "name": "claude-cortex",
  "version": "1.0.0",
  "repo": "NabilW1995/claude-cortex",
  "installedAt": "2026-04-01T00:00:00Z",
  "lastUpdated": "2026-04-01T00:00:00Z",
  "lastSyncCheck": null,
  "templateOwned": [
    ".claude/rules/",
    ".claude/agents/",
    ".claude/commands/",
    ".claude/skills/",
    "scripts/hooks/",
    "scripts/db/"
  ],
  "projectOwned": [
    "CLAUDE.local.md",
    ".claude/knowledge-base.md",
    ".claude/knowledge-nominations.md",
    ".claude/settings.local.json",
    ".mcp.json"
  ],
  "mergeFiles": [
    "CLAUDE.md",
    ".claude/settings.json",
    ".claude/team-learnings.json"
  ]
}
```

**Step 2: Commit**

```bash
git add .claude-template.json
git commit -m "feat: add template manifest for version tracking"
```

---

### Task 2: Add section markers to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Write test to verify markers exist**

Create `scripts/template/__tests__/merge-claude-md.test.js`:

```javascript
const { parseSections } = require('../merge-claude-md');
const fs = require('fs');

test('CLAUDE.md has template markers', () => {
  const content = fs.readFileSync('CLAUDE.md', 'utf-8');
  expect(content).toContain('<!-- CORTEX:WICHTIG:START -->');
  expect(content).toContain('<!-- CORTEX:WICHTIG:END -->');
  expect(content).toContain('<!-- CORTEX:REFS:START -->');
  expect(content).toContain('<!-- CORTEX:REFS:END -->');
});

test('parseSections splits template vs project sections', () => {
  const content = `# Project
<!-- CORTEX:WICHTIG:START -->
template content
<!-- CORTEX:WICHTIG:END -->
project content
<!-- CORTEX:REFS:START -->
refs
<!-- CORTEX:REFS:END -->`;

  const sections = parseSections(content);
  expect(sections.template).toHaveLength(2);
  expect(sections.project).toContain('project content');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test scripts/template/__tests__/merge-claude-md.test.js`
Expected: FAIL

**Step 3: Add markers to CLAUDE.md**

Wrap template-owned sections with `<!-- CORTEX:SECTIONNAME:START/END -->` comments:
- WICHTIG section
- Skill-Routing section
- Kommunikation section
- Workflow section
- Git-Workflow section
- Reference Documents section
- Setup section
- WICHTIG (Wiederholung) section

Project-owned sections stay unmarked:
- Projektname + Beschreibung (top)
- Commands
- Projekt-Struktur
- Gotchas

**Step 4: Implement parseSections**

Create `scripts/template/merge-claude-md.js`:

```javascript
function parseSections(content) {
  const markerRegex = /<!-- CORTEX:(\w+):START -->\n([\s\S]*?)<!-- CORTEX:\1:END -->/g;
  const template = [];
  let projectContent = content;

  let match;
  while ((match = markerRegex.exec(content)) !== null) {
    template.push({ name: match[1], content: match[2].trim() });
    // What's outside markers = project content
  }

  // Project content = everything not inside markers
  const project = content.replace(markerRegex, '').trim();

  return { template, project };
}

function mergeCLAUDEmd(currentContent, templateContent) {
  // Parse template sections from the NEW template
  const templateSections = parseSections(templateContent);

  // For each template section, replace in current content
  let result = currentContent;
  for (const section of templateSections.template) {
    const regex = new RegExp(
      `<!-- CORTEX:${section.name}:START -->\\n[\\s\\S]*?<!-- CORTEX:${section.name}:END -->`,
      'g'
    );
    if (regex.test(result)) {
      // Section exists — replace it
      result = result.replace(regex,
        `<!-- CORTEX:${section.name}:START -->\n${section.content}\n<!-- CORTEX:${section.name}:END -->`
      );
    } else {
      // Section doesn't exist — append before WICHTIG (Wiederholung)
      const insertPoint = result.lastIndexOf('<!-- CORTEX:WICHTIG_REPEAT:START -->');
      if (insertPoint > -1) {
        result = result.slice(0, insertPoint) +
          `<!-- CORTEX:${section.name}:START -->\n${section.content}\n<!-- CORTEX:${section.name}:END -->\n\n` +
          result.slice(insertPoint);
      }
    }
  }

  return result;
}

module.exports = { parseSections, mergeCLAUDEmd };
```

**Step 5: Run test to verify it passes**

Run: `node --test scripts/template/__tests__/merge-claude-md.test.js`
Expected: PASS

**Step 6: Commit**

```bash
git add CLAUDE.md scripts/template/
git commit -m "feat: add section markers to CLAUDE.md for safe merging"
```

---

### Task 3: Build settings.json deep-merge

**Files:**
- Create: `scripts/template/merge-settings.js`
- Create: `scripts/template/__tests__/merge-settings.test.js`

**Step 1: Write failing test**

```javascript
const { mergeSettings } = require('../merge-settings');

test('merges env vars without losing project additions', () => {
  const current = { env: { MY_VAR: "1", CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "70" } };
  const template = { env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "75", NEW_VAR: "2" } };
  const result = mergeSettings(current, template);

  expect(result.env.MY_VAR).toBe("1");           // project addition preserved
  expect(result.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE).toBe("75"); // template wins
  expect(result.env.NEW_VAR).toBe("2");           // new from template added
});

test('merges hook arrays without duplicates', () => {
  const current = { hooks: { SessionStart: [{ hooks: [{ command: "my-hook.sh" }] }] } };
  const template = { hooks: { SessionStart: [{ hooks: [{ command: "session-start.js" }] }] } };
  const result = mergeSettings(current, template);

  // Both hooks should be present
  const commands = JSON.stringify(result.hooks.SessionStart);
  expect(commands).toContain("my-hook.sh");
  expect(commands).toContain("session-start.js");
});

test('preserves project permissions, adds template permissions', () => {
  const current = { permissions: { allow: ["Bash(my-tool *)"], deny: [] } };
  const template = { permissions: { allow: ["Bash(browser-use *)"], deny: ["Bash(rm -rf *)"] } };
  const result = mergeSettings(current, template);

  expect(result.permissions.allow).toContain("Bash(my-tool *)");
  expect(result.permissions.allow).toContain("Bash(browser-use *)");
  expect(result.permissions.deny).toContain("Bash(rm -rf *)");
});
```

**Step 2: Run test → FAIL**

**Step 3: Implement mergeSettings**

```javascript
function mergeSettings(current, template) {
  const result = JSON.parse(JSON.stringify(current));

  // Deep merge env (template values win, project additions preserved)
  if (template.env) {
    result.env = { ...(result.env || {}), ...template.env };
  }

  // Merge permissions (union of arrays, no duplicates)
  if (template.permissions) {
    for (const key of ['allow', 'deny', 'ask']) {
      if (template.permissions[key]) {
        const existing = new Set(result.permissions?.[key] || []);
        template.permissions[key].forEach(p => existing.add(p));
        result.permissions = result.permissions || {};
        result.permissions[key] = [...existing];
      }
    }
  }

  // Merge hooks (add template hooks, skip if same command already exists)
  if (template.hooks) {
    result.hooks = result.hooks || {};
    for (const [event, entries] of Object.entries(template.hooks)) {
      if (!result.hooks[event]) {
        result.hooks[event] = entries;
      } else {
        // Collect existing commands
        const existingCmds = new Set();
        for (const entry of result.hooks[event]) {
          for (const h of (entry.hooks || [])) {
            existingCmds.add(h.command);
          }
        }
        // Add new hooks from template
        for (const entry of entries) {
          const newHooks = (entry.hooks || []).filter(h => !existingCmds.has(h.command));
          if (newHooks.length > 0) {
            result.hooks[event].push({ ...entry, hooks: newHooks });
          }
        }
      }
    }
  }

  // Simple overwrite for scalar values (template wins)
  for (const key of ['cleanupPeriodDays', 'attribution', 'worktree']) {
    if (template[key] !== undefined && result[key] === undefined) {
      result[key] = template[key];
    }
  }

  return result;
}

module.exports = { mergeSettings };
```

**Step 4: Run test → PASS**

**Step 5: Commit**

```bash
git add scripts/template/merge-settings.js scripts/template/__tests__/
git commit -m "feat: settings.json deep-merge with hook dedup"
```

---

### Task 4: Build the install script

**Files:**
- Create: `scripts/template/install.js`

**Step 1: Write the install script**

The install script handles first-time setup of Cortex into an existing project:

```javascript
#!/usr/bin/env node
/**
 * Claude Cortex Install Script
 *
 * Usage: node scripts/template/install.js <target-project-path>
 *
 * 1. Scans target project for existing agents/commands/hooks
 * 2. Reports what's interesting (for potential template adoption)
 * 3. Copies template-owned files
 * 4. Merges CLAUDE.md (adds Cortex sections)
 * 5. Merges settings.json (preserves project additions)
 * 6. Creates .claude-template.json manifest
 * 7. Prompts for MCP API keys
 */
```

Key behaviors:
- Scan target for existing `.claude/agents/`, `.claude/commands/` → log interesting finds
- Copy template-owned directories (rules, agents, commands, skills, hooks, db)
- Run `mergeCLAUDEmd()` on existing CLAUDE.md (or create if missing)
- Run `mergeSettings()` on existing settings.json (or create if missing)
- Copy `.mcp.json.example` → prompt user to fill in API keys
- Create `.claude-template.json` with current version
- Run `npm install` for sql.js dependency
- Run `npm run db:init` for SQLite setup
- Append Cortex entries to `.gitignore`

**Step 2: Write test for install**

Test that install creates the manifest, copies files, and preserves existing content.

**Step 3: Run test → FAIL, implement, run → PASS**

**Step 4: Commit**

```bash
git add scripts/template/install.js scripts/template/__tests__/
git commit -m "feat: install script for adding Cortex to existing projects"
```

---

### Task 5: Build the update script

**Files:**
- Create: `scripts/template/update.js`

**Step 1: Write the update script**

```javascript
#!/usr/bin/env node
/**
 * Claude Cortex Update Script
 *
 * Usage: node scripts/template/update.js
 * Or via command: /template-update
 *
 * 1. Reads .claude-template.json for repo URL + current version
 * 2. Fetches latest release from GitHub
 * 3. Downloads changed template-owned files
 * 4. Merges CLAUDE.md sections
 * 5. Merges settings.json
 * 6. Syncs team-learnings.json (bidirectional)
 * 7. Syncs knowledge-base.md
 * 8. Updates .claude-template.json version
 * 9. Shows changelog
 */
```

Key behaviors:
- Use `gh api repos/{repo}/releases/latest` for version check
- Use `gh api repos/{repo}/contents/{path}` to fetch individual files
- Only update template-owned files (from manifest)
- Merge CLAUDE.md and settings.json using merge scripts
- Bidirectional learning sync:
  - Push: Export local learnings → commit to team-learnings.json → push
  - Pull: Fetch remote team-learnings.json → import new learnings
- Show diff summary: "3 rules updated, 1 new agent, 5 learnings synced"

**Step 2: Write test**

Test with mock GitHub responses. Verify template-owned files get updated, project-owned files don't.

**Step 3: Implement, test, commit**

```bash
git add scripts/template/update.js scripts/template/__tests__/
git commit -m "feat: update script with smart merge and learning sync"
```

---

### Task 6: Build the `/template-update` command

**Files:**
- Create: `.claude/commands/template-update.md`

**Step 1: Write the command**

```markdown
# Template Update

Update Claude Cortex to the latest version from GitHub.

## Anweisungen
1. Prüfe ob .claude-template.json existiert
2. Wenn nicht: "Dieses Projekt nutzt noch kein Claude Cortex.
   Installiere mit: node scripts/template/install.js"
3. Führe aus: node scripts/template/update.js
4. Zeige dem User was sich geändert hat
5. Bei neuen Learnings: Frage ob /audit laufen soll
```

**Step 2: Commit**

```bash
git add .claude/commands/template-update.md
git commit -m "feat: /template-update command"
```

---

### Task 7: Build the sync-check cache for StatusLine

**Files:**
- Create: `scripts/template/sync-check.js`

**Step 1: Write the sync-check script**

```javascript
#!/usr/bin/env node
/**
 * Lightweight check for template updates + new learnings
 * Writes result to .claude/logs/.cortex-status.json
 * Called by PreToolUse hook (max every 30 min)
 * Read by StatusLine for notification display
 */
```

Key behaviors:
- Check timestamp of `.claude/logs/.cortex-status.json`
- If <30 min old → exit (use cached result)
- If >30 min or missing → check GitHub:
  - `gh api repos/{repo}/commits?per_page=1` → compare SHA with last known
  - Count new learnings in remote team-learnings.json
- Write cache: `{ hasUpdate: true, newLearnings: 3, latestVersion: "1.1.0", checkedAt: "..." }`

**Step 2: Add to SessionStart hook in settings.json**

Add `node scripts/template/sync-check.js` to SessionStart hooks.

**Step 3: Add to PreToolUse as periodic check**

Add with `"async": true` so it doesn't block.

**Step 4: Test, commit**

```bash
git add scripts/template/sync-check.js .claude/settings.json
git commit -m "feat: periodic sync-check for StatusLine notifications"
```

---

### Task 8: Add auto-push after learning save

**Files:**
- Modify: `scripts/hooks/session-end.js`
- Modify: `scripts/db/store.js`

**Step 1: Add post-save hook to addLearning**

After `addLearning()` saves to DB and exports to team-learnings.json:
- `git add .claude/team-learnings.json .claude/knowledge-base.md`
- `git commit -m "chore: sync learnings"`
- `git push` (async, non-blocking)

**Step 2: Add to session-end.js**

At session end: Export learnings → commit → push (ensures nothing is lost).

**Step 3: Test the push doesn't fail when no changes**

`git diff --quiet .claude/team-learnings.json || git add ... && git commit && git push`

**Step 4: Commit**

```bash
git add scripts/hooks/session-end.js scripts/db/store.js
git commit -m "feat: auto-push learnings after save and session-end"
```

---

### Task 9: Update package.json with new scripts

**Files:**
- Modify: `package.json`

**Step 1: Add template scripts**

```json
{
  "scripts": {
    "cortex:install": "node scripts/template/install.js",
    "cortex:update": "node scripts/template/update.js",
    "cortex:sync-check": "node scripts/template/sync-check.js",
    "cortex:version": "node -e \"console.log(require('./.claude-template.json').version)\""
  }
}
```

**Step 2: Update package name and description**

```json
{
  "name": "claude-cortex",
  "description": "The collective brain for Claude Code — shared learnings, rules, hooks, and skills across all your projects"
}
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add cortex scripts to package.json"
```

---

### Task 10: Integration test — full install + update cycle

**Files:**
- Create: `scripts/template/__tests__/integration.test.js`

**Step 1: Write integration test**

```javascript
// Test the full cycle:
// 1. Create a mock "existing project" in /tmp
// 2. Run install.js against it
// 3. Verify all template files are copied
// 4. Verify CLAUDE.md has markers
// 5. Verify settings.json is merged
// 6. Verify .claude-template.json exists
// 7. Simulate template update (change a rule file)
// 8. Run update.js
// 9. Verify rule file is updated
// 10. Verify project-owned files are untouched
```

**Step 2: Run full test suite**

```bash
node --test scripts/template/__tests__/*.test.js
```

Expected: ALL PASS

**Step 3: Final commit + push**

```bash
git add -A
git commit -m "test: integration tests for install/update cycle"
git push origin master
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Template manifest | `.claude-template.json` |
| 2 | CLAUDE.md section markers + merge | `CLAUDE.md`, `merge-claude-md.js` |
| 3 | Settings.json deep-merge | `merge-settings.js` |
| 4 | Install script | `install.js` |
| 5 | Update script | `update.js` |
| 6 | `/template-update` command | `template-update.md` |
| 7 | StatusLine sync-check cache | `sync-check.js` |
| 8 | Auto-push learnings | `session-end.js`, `store.js` |
| 9 | Package.json updates | `package.json` |
| 10 | Integration tests | `integration.test.js` |
