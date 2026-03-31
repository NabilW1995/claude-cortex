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
})();
