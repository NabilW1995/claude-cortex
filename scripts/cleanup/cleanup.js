#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function findCandidates() {
  const candidates = [];

  // Check for empty directories
  function checkEmpty(dir, depth = 0) {
    if (depth > 3) return;
    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        candidates.push({ path: dir, reason: 'Empty directory', type: 'dir' });
      }
      entries.forEach(e => {
        const fullPath = path.join(dir, e);
        if (fs.statSync(fullPath).isDirectory() && !e.startsWith('.') && e !== 'node_modules') {
          checkEmpty(fullPath, depth + 1);
        }
      });
    } catch (e) { /* skip */ }
  }

  checkEmpty(projectDir);

  // Check for template placeholder files
  const templatePatterns = [
    { file: 'image.png', reason: 'Template image — not needed in real project' }
  ];

  templatePatterns.forEach(({ file, reason }) => {
    const fullPath = path.join(projectDir, file);
    if (fs.existsSync(fullPath)) {
      candidates.push({ path: fullPath, reason, type: 'file' });
    }
  });

  return candidates;
}

if (require.main === module) {
  const candidates = findCandidates();
  if (candidates.length === 0) {
    console.log('✅ Nichts zu bereinigen — Projekt ist sauber.');
  } else {
    console.log('🧹 Cleanup-Kandidaten:');
    candidates.forEach(c => {
      console.log(`  ${c.type === 'dir' ? '📁' : '📄'} ${c.path}`);
      console.log(`     Grund: ${c.reason}`);
    });
    console.log('\nFrage den User bevor du etwas löschst!');
  }
}

module.exports = { findCandidates };
