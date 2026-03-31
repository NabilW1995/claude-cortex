#!/usr/bin/env node
/**
 * Auto-push learnings to remote after changes.
 * Called async — does not block other operations.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

try {
  // Check if in a git repo
  execSync('git rev-parse --git-dir', { cwd: projectDir, stdio: 'pipe' });

  // Check if there are learning changes to push
  const status = execSync(
    'git status --porcelain .claude/team-learnings.json .claude/knowledge-base.md 2>/dev/null',
    { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();

  if (status) {
    execSync('git add .claude/team-learnings.json .claude/knowledge-base.md', {
      cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe']
    });

    // Only commit if there are staged changes
    const staged = execSync('git diff --cached --name-only', {
      cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (staged) {
      execSync('git commit -m "chore: sync learnings" --no-verify', {
        cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe']
      });

      // Async push
      const push = spawn('git', ['push'], {
        cwd: projectDir,
        detached: true,
        stdio: 'ignore'
      });
      push.unref();

      console.error('[Learning-Sync] Learnings pushed to remote');
    }
  }
} catch {
  // Silent fail
}
