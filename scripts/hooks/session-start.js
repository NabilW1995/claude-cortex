#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const projectName = path.basename(projectDir);
const sessionId = `session-${Date.now()}`;

(async () => {
  try {
    const { getDb, getRecentLearnings, getHighConfidenceLearnings, startSession, decayOldLearnings } = require('../db/store');
    const db = await getDb();

    // Start session
    startSession(db, sessionId, projectName);

    // Decay old learnings periodically
    decayOldLearnings(db);

    // Load recent project learnings
    const recentLearnings = getRecentLearnings(db, 5, projectName);
    const globalLearnings = getHighConfidenceLearnings(db, 0.7);

    if (recentLearnings.length > 0) {
      console.error(`\n[Learning-DB] 📚 ${recentLearnings.length} Learnings für "${projectName}":`);
      recentLearnings.slice(0, 3).forEach(l => {
        console.error(`  - [${l.category}] ${l.rule}`);
      });
      if (recentLearnings.length > 3) {
        console.error(`  ... und ${recentLearnings.length - 3} weitere`);
      }
    }

    if (globalLearnings.length > 0) {
      console.error(`[Learning-DB] 🌍 ${globalLearnings.length} globale High-Confidence Learnings geladen`);
    }

    // Check .env against .env.example
    const envExample = path.join(projectDir, '.env.example');
    const envFile = path.join(projectDir, '.env');
    if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
      console.error(`\n[⚠️ ENV] .env Datei fehlt! Kopiere .env.example zu .env und fülle die Werte aus.`);
    } else if (fs.existsSync(envExample) && fs.existsSync(envFile)) {
      const exampleVars = fs.readFileSync(envExample, 'utf-8').match(/^[A-Z_]+=.*/gm) || [];
      const envVars = fs.readFileSync(envFile, 'utf-8').match(/^[A-Z_]+=.*/gm) || [];
      const exampleKeys = exampleVars.map(v => v.split('=')[0]);
      const envKeys = envVars.map(v => v.split('=')[0]);
      const missing = exampleKeys.filter(k => !envKeys.includes(k));
      if (missing.length > 0) {
        console.error(`\n[⚠️ ENV] Fehlende Variablen in .env: ${missing.join(', ')}`);
      }
    }

    // Store session ID for other hooks
    const stateDir = path.join(projectDir, '.claude', 'logs');
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, '.session-id'), sessionId);

    // Notify Telegram
    try {
      const { notifySessionStart } = require('../bot/notify');
      await notifySessionStart(projectDir);
    } catch (e) {
      // Silent fail — Telegram is optional
    }

    db.close();
  } catch (e) {
    if (e.message && e.message.includes('no such table')) {
      console.error(`[Learning-DB] Not initialized yet. Run: npm run db:init`);
    } else {
      console.error(`[Learning-DB] Session-Start Error: ${e.message}`);
    }
  }
})();
