#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

// Read user prompt from stdin
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = data.prompt || data.content || '';
    processPrompt(prompt).catch(() => {});
  } catch (e) {
    // If not JSON, treat as plain text
    processPrompt(input.trim()).catch(() => {});
  }
});

async function processPrompt(prompt) {
  if (!prompt) return;

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projectName = path.basename(projectDir);

  // ==================== CORRECTION DETECTION ====================
  const correctionPatternsDE = [
    /\bnein\b/i, /\bfalsch\b/i, /\bstimmt nicht\b/i, /\bpasst nicht\b/i,
    /\bnicht richtig\b/i, /\bimmer noch nicht\b/i, /\banders machen\b/i,
    /\bnicht so\b/i, /\bmach das nicht\b/i, /\brückgängig\b/i,
    /\bzurück\b/i, /\bstop\b/i, /\bwarte\b/i, /\bfunktioniert nicht\b/i,
    /\bgeht nicht\b/i, /\bklappt nicht\b/i, /\bhat nicht geklappt\b/i
  ];

  const correctionPatternsEN = [
    /\bno[,.]?\s*(that'?s|thats)?\s*(wrong|incorrect|not right)/i,
    /\byou\s*(should|shouldn't|need to|forgot)/i,
    /\bthat'?s not what I (meant|asked|wanted)/i,
    /\bwrong (file|approach|way)/i, /\bundo that\b/i,
    /\brevert\b/i, /\bdon'?t do that\b/i, /\bstop\b/i,
    /\bnot working\b/i, /\bstill (broken|wrong|not)\b/i,
    /\btry again\b/i, /\bthat didn'?t (work|help|fix)/i
  ];

  // ==================== SUCCESS DETECTION ====================
  const successPatternsDE = [
    /\bperfekt\b/i, /\bgenau\b/i, /\bfunktioniert\b/i, /\bsuper\b/i,
    /\bpasst\b/i, /\bendlich\b/i, /\bja genau so\b/i, /\btoll\b/i,
    /\bsieht gut aus\b/i, /\bstimmt jetzt\b/i, /\brichtig so\b/i,
    /\bjetzt geht'?s\b/i, /\bklasse\b/i, /\bwunderbar\b/i, /\bprima\b/i
  ];

  const successPatternsEN = [
    /\bperfect\b/i, /\bexactly\b/i, /\bworks?\b/i, /\bgreat\b/i,
    /\bnice\b/i, /\bthat'?s it\b/i, /\blooks? good\b/i, /\bfinally\b/i,
    /\bcorrect\b/i, /\bawesome\b/i, /\byes[!.]?\b/i, /\bnailed it\b/i
  ];

  const isCorrection = [...correctionPatternsDE, ...correctionPatternsEN].some(p => p.test(prompt));
  const isSuccess = [...successPatternsDE, ...successPatternsEN].some(p => p.test(prompt));

  try {
    const { getDb, incrementCorrections, incrementPrompts, searchLearnings, incrementTimesApplied, saveDb } = require('../db/store');
    const db = await getDb();

    // Read session ID
    const sessionIdFile = path.join(projectDir, '.claude', 'logs', '.session-id');
    const sessionId = fs.existsSync(sessionIdFile) ? fs.readFileSync(sessionIdFile, 'utf-8').trim() : null;

    if (sessionId) {
      incrementPrompts(db, sessionId);
      if (isCorrection) {
        incrementCorrections(db, sessionId);
        console.error('[Learning-DB] 📝 Korrektur erkannt — wird für Learning-Extraktion gemerkt');
      }
    }

    if (isSuccess) {
      console.error('[Learning-DB] ✅ Erfolg erkannt — prüfe ob Learnings extrahiert werden können');
    }

    // ==================== ESCALATION: Correction Streak ====================
    // 3 Korrekturen → Rubber Duck (hilft selbst denken)
    // 5 Korrekturen → Unsticker (Root-Cause-Analyse)
    const streakFile = path.join(projectDir, '.claude', 'logs', '.correction-streak');
    if (isCorrection) {
      const currentStreak = fs.existsSync(streakFile) ? parseInt(fs.readFileSync(streakFile, 'utf-8').trim()) || 0 : 0;
      const newStreak = currentStreak + 1;
      fs.writeFileSync(streakFile, String(newStreak));
      if (newStreak === 3) {
        console.error(`\n[Rubber-Duck] 🦆 ${newStreak} Korrekturen hintereinander — vielleicht hilft es das Problem laut zu formulieren.`);
        console.error('[Rubber-Duck] Empfehlung: Nutze den rubber-duck Agent — er stellt dir gezielte Fragen.\n');
      } else if (newStreak >= 5) {
        console.error(`\n[Unsticker] ⚠️ ${newStreak} Korrekturen hintereinander — Root-Cause-Analyse empfohlen!`);
        console.error('[Unsticker] Empfehlung: Nutze den unsticker Agent oder /unstick für Hilfe.\n');
      }
    } else if (isSuccess || !isCorrection) {
      // Reset streak on success or neutral prompt
      if (fs.existsSync(streakFile)) fs.writeFileSync(streakFile, '0');
    }

    // ==================== TASK-RELEVANT LEARNING SEARCH ====================
    const stopWords = new Set([
      'der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'aber', 'ist', 'sind',
      'hat', 'haben', 'wird', 'werden', 'kann', 'können', 'soll', 'sollen',
      'mach', 'mal', 'bitte', 'ich', 'mir', 'mich', 'du', 'wir', 'sie',
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may',
      'i', 'you', 'we', 'they', 'it', 'my', 'your', 'our', 'me', 'please',
      'make', 'add', 'create', 'build', 'fix', 'change', 'update', 'want', 'need'
    ]);

    const keywords = prompt.toLowerCase()
      .replace(/[^\w\sÄäÖöÜüß]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    if (keywords.length > 0) {
      const searchQuery = keywords.slice(0, 5).join(' ');
      const relevant = searchLearnings(db, searchQuery, projectName, 3);

      if (relevant.length > 0) {
        console.error(`\n[Learning-DB] 🔍 Relevante Learnings für diese Aufgabe:`);
        relevant.forEach(l => {
          console.error(`  - [${l.category}] ${l.rule}`);
          if (l.correction) console.error(`    Fix: ${l.correction}`);
          // Mark learning as applied
          incrementTimesApplied(db, l.id);
        });
        console.error('');
      }
    }

    db.close();
  } catch (e) {
    if (e.message && !e.message.includes('no such table')) {
      console.error(`[Learning-DB] Prompt-Hook Error: ${e.message}`);
    }
  }
}
