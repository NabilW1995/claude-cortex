#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const projectName = path.basename(projectDir);

(async () => {
  try {
    const { getDb, endSession, queryOne } = require('../db/store');
    const db = await getDb();

    // Read session ID
    const sessionIdFile = path.join(projectDir, '.claude', 'logs', '.session-id');
    const sessionId = fs.existsSync(sessionIdFile) ? fs.readFileSync(sessionIdFile, 'utf-8').trim() : null;

    if (sessionId) {
      endSession(db, sessionId);

      // Get session stats
      const session = queryOne(db, 'SELECT * FROM sessions WHERE id = ?', [sessionId]);
      if (session && session.corrections_count > 0) {
        console.error(`\n[Learning-DB] 📊 Session-Statistik:`);
        console.error(`  Prompts: ${session.prompts_count}`);
        console.error(`  Korrekturen: ${session.corrections_count}`);
        console.error(`  Tipp: Learnings werden automatisch extrahiert und gespeichert.`);
      }

    }

    db.close();
  } catch (e) {
    if (e.message) console.error(`[Learning-DB] Session-End Error: ${e.message}`);
  }

  // Notify Telegram (outside DB try/catch — always fires even if DB fails)
  try {
    const { notifySessionEnd } = require('../bot/notify');
    // Try to read session stats even if DB block failed
    let stats = {};
    try {
      const sessionIdFile = path.join(projectDir, '.claude', 'logs', '.session-id');
      if (fs.existsSync(sessionIdFile)) {
        const { getDb, queryOne } = require('../db/store');
        const db2 = await getDb();
        const sid = fs.readFileSync(sessionIdFile, 'utf-8').trim();
        stats = queryOne(db2, 'SELECT * FROM sessions WHERE id = ?', [sid]) || {};
        db2.close();
      }
    } catch (e) { /* stats will be empty */ }
    await notifySessionEnd(projectDir, stats);
  } catch (e) {
    // Silent fail — Telegram is optional
  }

  // Auto-push learnings at session end
  try {
    const { execSync } = require('child_process');

    // Check if there are changes to push
    const hasChanges = execSync(
      'git diff --name-only .claude/team-learnings.json .claude/knowledge-base.md 2>/dev/null || echo ""',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const hasUntracked = execSync(
      'git ls-files --others --exclude-standard .claude/team-learnings.json .claude/knowledge-base.md 2>/dev/null || echo ""',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (hasChanges || hasUntracked) {
      execSync('git add .claude/team-learnings.json .claude/knowledge-base.md 2>/dev/null', {
        cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe']
      });
      execSync('git commit -m "chore: sync learnings" --no-verify 2>/dev/null', {
        cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe']
      });
      // Push async (don't block session end)
      const { spawn } = require('child_process');
      const push = spawn('git', ['push'], { cwd: projectDir, detached: true, stdio: 'ignore' });
      push.unref();
      console.error('[Learning-Sync] Learnings committed and push started');
    }
  } catch (e) {
    // Silent fail — don't block session end
  }
})();
