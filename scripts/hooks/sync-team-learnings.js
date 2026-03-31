#!/usr/bin/env node
/**
 * Team Learnings Sync
 *
 * EXPORT (pre-commit): Exportiert neue high-confidence Learnings in team-learnings.json
 * IMPORT (session-start): Importiert Learnings der Teammates in die lokale DB
 *
 * Jedes Learning bekommt einen Fingerprint (Hash) um Duplikate zu vermeiden.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TEAM_FILE = path.join(projectDir, '.claude', 'team-learnings.json');
const MIN_CONFIDENCE_TO_SHARE = 0.7;

// Create a unique fingerprint for a learning
function fingerprint(learning) {
  const content = `${learning.category}:${learning.rule}:${learning.correction || ''}`;
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

// Get current git user
function getGitUser() {
  try {
    const { execSync } = require('child_process');
    const name = execSync('git config user.name', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const email = execSync('git config user.email', { cwd: projectDir, encoding: 'utf-8' }).trim();
    return { name, email };
  } catch {
    return { name: 'unknown', email: 'unknown' };
  }
}

// Load team learnings file
function loadTeamFile() {
  if (!fs.existsSync(TEAM_FILE)) {
    return { version: 1, description: 'Shared team learnings', learnings: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(TEAM_FILE, 'utf-8'));
  } catch {
    return { version: 1, description: 'Shared team learnings', learnings: [] };
  }
}

// Save team learnings file
function saveTeamFile(data) {
  const dir = path.dirname(TEAM_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TEAM_FILE, JSON.stringify(data, null, 2) + '\n');
}

// ==================== EXPORT (pre-commit) ====================
async function exportLearnings() {
  try {
    const { getDb, getHighConfidenceLearnings } = require('../db/store');
    const db = await getDb();
    const user = getGitUser();

    // Get all high-confidence learnings
    const learnings = getHighConfidenceLearnings(db, MIN_CONFIDENCE_TO_SHARE);

    if (learnings.length === 0) {
      db.close();
      return;
    }

    // Load existing team file
    const teamData = loadTeamFile();
    const existingFingerprints = new Set(teamData.learnings.map(l => l.fingerprint));

    // Add new learnings
    let added = 0;
    for (const learning of learnings) {
      const fp = fingerprint(learning);
      if (!existingFingerprints.has(fp)) {
        teamData.learnings.push({
          fingerprint: fp,
          category: learning.category,
          rule: learning.rule,
          rule_en: learning.rule_en || null,
          mistake: learning.mistake,
          mistake_en: learning.mistake_en || null,
          correction: learning.correction,
          correction_en: learning.correction_en || null,
          confidence: learning.confidence,
          project: learning.project,
          shared_by: user.name,
          shared_at: new Date().toISOString(),
          times_applied: learning.times_applied
        });
        existingFingerprints.add(fp);
        added++;
      }
    }

    if (added > 0) {
      // Sort by confidence (highest first)
      teamData.learnings.sort((a, b) => b.confidence - a.confidence);
      saveTeamFile(teamData);

      // Auto-stage the file
      try {
        const { execSync } = require('child_process');
        execSync(`git add "${TEAM_FILE}"`, { cwd: projectDir });
      } catch { /* ignore if not in git */ }

      console.error(`[Team-Sync] ${added} neue Learnings exportiert (von ${user.name})`);
    }

    db.close();
  } catch (e) {
    // Silent fail — don't block commits
  }
}

// ==================== IMPORT (session-start) ====================
async function importLearnings() {
  try {
    if (!fs.existsSync(TEAM_FILE)) return;

    const { getDb, addLearning, searchLearnings } = require('../db/store');
    const db = await getDb();
    const user = getGitUser();

    const teamData = loadTeamFile();

    if (teamData.learnings.length === 0) {
      db.close();
      return;
    }

    let imported = 0;
    for (const learning of teamData.learnings) {
      // Skip own learnings (already in local DB)
      if (learning.shared_by === user.name) continue;

      // Check if already exists in local DB (search by rule text)
      const existing = searchLearnings(db, learning.rule, null, 1);
      const isDuplicate = existing.some(e =>
        fingerprint({ category: e.category, rule: e.rule, correction: e.correction }) === learning.fingerprint
      );

      if (!isDuplicate) {
        // Use English version for English-speaking teammates, fallback to original
        addLearning(db, {
          project: learning.project,
          category: learning.category,
          rule: `[Team: ${learning.shared_by}] ${learning.rule}`,
          rule_en: learning.rule_en ? `[Team: ${learning.shared_by}] ${learning.rule_en}` : null,
          mistake: learning.mistake,
          mistake_en: learning.mistake_en || null,
          correction: learning.correction,
          correction_en: learning.correction_en || null,
          confidence: Math.min(learning.confidence, 0.6)
        });
        imported++;
      }
    }

    if (imported > 0) {
      console.error(`[Team-Sync] ${imported} Learnings von Teammates importiert`);
    } else if (teamData.learnings.length > 0) {
      console.error(`[Team-Sync] ${teamData.learnings.length} Team-Learnings vorhanden (alle bereits importiert)`);
    }

    db.close();
  } catch (e) {
    // Silent fail
  }
}

// ==================== CLI ====================
const mode = process.argv[2] || 'export';

if (mode === 'export') {
  exportLearnings();
} else if (mode === 'import') {
  importLearnings();
} else if (mode === 'stats') {
  const teamData = loadTeamFile();
  const byUser = {};
  teamData.learnings.forEach(l => {
    byUser[l.shared_by] = (byUser[l.shared_by] || 0) + 1;
  });
  console.log(`\nTeam Learnings: ${teamData.learnings.length} total`);
  console.log('\nBy Team Member:');
  Object.entries(byUser).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    console.log(`  ${name}: ${count} learnings`);
  });
}
