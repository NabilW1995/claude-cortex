#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB_PATH = path.join(os.homedir(), '.claude-learnings', 'learnings.db');

let _sqlJs = null;

async function getSqlJs() {
  if (!_sqlJs) {
    const initSqlJs = require('sql.js');
    _sqlJs = await initSqlJs();
  }
  return _sqlJs;
}

async function getDb() {
  const SQL = await getSqlJs();
  if (!fs.existsSync(DB_PATH)) {
    console.error('[Learning-DB] Database not found. Run: npm run db:init');
    process.exit(1);
  }
  const buffer = fs.readFileSync(DB_PATH);
  return new SQL.Database(buffer);
}

function saveDb(db) {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper: run query and get rows as objects
function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(db, sql, params = []) {
  const rows = queryAll(db, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function runSql(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  stmt.step();
  stmt.free();
}

// ==================== LEARNINGS ====================

function addLearning(db, { project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, confidence = 0.5 }) {
  runSql(db, `
    INSERT INTO learnings (project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [project || null, category, rule, rule_en || null, mistake || null, mistake_en || null, correction || null, correction_en || null, confidence]);

  const lastId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  // Auto-create nomination
  runSql(db, 'INSERT INTO nominations (learning_id) VALUES (?)', [lastId]);

  saveDb(db);
  return lastId;
}

function searchLearnings(db, query, project = null, limit = 5) {
  // Simple LIKE-based search (FTS5 not available in sql.js)
  const keywords = query.replace(/[^\w\sÄäÖöÜüß]/g, '').split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return [];

  const conditions = keywords.map(() =>
    '(rule LIKE ? OR rule_en LIKE ? OR mistake LIKE ? OR mistake_en LIKE ? OR correction LIKE ? OR correction_en LIKE ? OR category LIKE ?)'
  ).join(' AND ');

  const params = [];
  keywords.forEach(k => {
    const like = `%${k}%`;
    params.push(like, like, like, like, like, like, like);
  });

  let sql = `SELECT * FROM learnings WHERE archived = 0 AND (${conditions})`;

  if (project) {
    sql += ' AND (project = ? OR project IS NULL)';
    params.push(project);
  }

  sql += ` ORDER BY confidence DESC, times_applied DESC LIMIT ${limit}`;

  return queryAll(db, sql, params);
}

function getRecentLearnings(db, limit = 10, project = null) {
  let sql = 'SELECT * FROM learnings WHERE archived = 0';
  const params = [];

  if (project) {
    sql += ' AND (project = ? OR project IS NULL)';
    params.push(project);
  }

  sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
  return queryAll(db, sql, params);
}

function getHighConfidenceLearnings(db, minConfidence = 0.7) {
  return queryAll(db, `
    SELECT * FROM learnings
    WHERE archived = 0 AND confidence >= ?
    ORDER BY confidence DESC, times_applied DESC
  `, [minConfidence]);
}

function incrementTimesApplied(db, id) {
  runSql(db, `
    UPDATE learnings SET times_applied = times_applied + 1, last_applied_at = datetime('now')
    WHERE id = ?
  `, [id]);
  saveDb(db);
}

function updateConfidence(db, id, delta) {
  runSql(db, `
    UPDATE learnings SET confidence = MIN(1.0, MAX(0.0, confidence + ?))
    WHERE id = ?
  `, [delta, id]);

  runSql(db, 'UPDATE learnings SET archived = 1 WHERE id = ? AND confidence < 0.1', [id]);
  saveDb(db);
}

function decayOldLearnings(db, monthsThreshold = 6) {
  runSql(db, `
    UPDATE learnings SET confidence = MAX(0.0, confidence - 0.1)
    WHERE archived = 0
    AND last_applied_at < datetime('now', ?)
    AND last_applied_at IS NOT NULL
  `, [`-${monthsThreshold} months`]);

  runSql(db, 'UPDATE learnings SET archived = 1 WHERE confidence < 0.1 AND archived = 0');
  saveDb(db);
}

// ==================== SESSIONS ====================

function startSession(db, sessionId, project) {
  runSql(db, `INSERT OR REPLACE INTO sessions (id, project) VALUES (?, ?)`, [sessionId, project || null]);
  saveDb(db);
}

function endSession(db, sessionId) {
  runSql(db, `UPDATE sessions SET ended_at = datetime('now') WHERE id = ?`, [sessionId]);
  saveDb(db);
}

function incrementCorrections(db, sessionId) {
  runSql(db, `UPDATE sessions SET corrections_count = corrections_count + 1 WHERE id = ?`, [sessionId]);
  saveDb(db);
}

function incrementPrompts(db, sessionId) {
  runSql(db, `UPDATE sessions SET prompts_count = prompts_count + 1 WHERE id = ?`, [sessionId]);
  saveDb(db);
}

// ==================== NOMINATIONS ====================

function getPendingNominations(db) {
  return queryAll(db, `
    SELECT n.*, l.rule, l.mistake, l.correction, l.category, l.project, l.confidence
    FROM nominations n
    JOIN learnings l ON n.learning_id = l.id
    WHERE n.status = 'pending'
    ORDER BY l.confidence DESC
  `);
}

function approveNomination(db, nominationId, notes = '') {
  runSql(db, `
    UPDATE nominations SET status = 'approved', reviewed_at = datetime('now'),
    promoted_at = datetime('now'), reviewer_notes = ?
    WHERE id = ?
  `, [notes, nominationId]);

  const nom = queryOne(db, 'SELECT learning_id FROM nominations WHERE id = ?', [nominationId]);
  if (nom) {
    updateConfidence(db, nom.learning_id, 0.2);
  }
  saveDb(db);
}

function rejectNomination(db, nominationId, notes = '') {
  runSql(db, `
    UPDATE nominations SET status = 'rejected', reviewed_at = datetime('now'),
    reviewer_notes = ?
    WHERE id = ?
  `, [notes, nominationId]);

  const nom = queryOne(db, 'SELECT learning_id FROM nominations WHERE id = ?', [nominationId]);
  if (nom) {
    updateConfidence(db, nom.learning_id, -0.1);
  }
  saveDb(db);
}

// ==================== STATS ====================

function getStats(db) {
  const total = queryOne(db, 'SELECT COUNT(*) as count FROM learnings WHERE archived = 0');
  const byProject = queryAll(db, `
    SELECT project, COUNT(*) as count FROM learnings
    WHERE archived = 0 GROUP BY project ORDER BY count DESC LIMIT 10
  `);
  const byCategory = queryAll(db, `
    SELECT category, COUNT(*) as count FROM learnings
    WHERE archived = 0 GROUP BY category ORDER BY count DESC LIMIT 10
  `);
  const pendingNoms = queryOne(db, "SELECT COUNT(*) as count FROM nominations WHERE status = 'pending'");
  const sessionCount = queryOne(db, 'SELECT COUNT(*) as count FROM sessions');
  const totalCorrections = queryOne(db, 'SELECT COALESCE(SUM(corrections_count), 0) as total FROM sessions');

  return {
    totalLearnings: total ? total.count : 0,
    byProject,
    byCategory,
    pendingNominations: pendingNoms ? pendingNoms.count : 0,
    totalSessions: sessionCount ? sessionCount.count : 0,
    totalCorrections: totalCorrections ? totalCorrections.total : 0
  };
}

// ==================== CLI ====================

if (require.main === module) {
  (async () => {
    const db = await getDb();
    const args = process.argv.slice(2);

    if (args.includes('--search')) {
      const query = args.filter(a => !a.startsWith('--')).join(' ');
      const results = searchLearnings(db, query);
      console.log(JSON.stringify(results, null, 2));
    } else if (args.includes('--stats')) {
      const stats = getStats(db);
      console.log('\nLearning Database Stats:');
      console.log(`   Total Learnings: ${stats.totalLearnings}`);
      console.log(`   Total Sessions: ${stats.totalSessions}`);
      console.log(`   Total Corrections: ${stats.totalCorrections}`);
      console.log(`   Pending Nominations: ${stats.pendingNominations}`);
      console.log('\n   By Category:');
      stats.byCategory.forEach(c => console.log(`     ${c.category}: ${c.count}`));
      console.log('\n   By Project:');
      stats.byProject.forEach(p => console.log(`     ${p.project || '(global)'}: ${p.count}`));
    } else {
      console.log('Usage:');
      console.log('  node store.js --search <query>  Search learnings');
      console.log('  node store.js --stats            Show statistics');
    }

    db.close();
  })().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

module.exports = {
  getDb, saveDb, queryAll, queryOne, runSql,
  addLearning, searchLearnings, getRecentLearnings,
  getHighConfidenceLearnings, incrementTimesApplied, updateConfidence,
  decayOldLearnings, startSession, endSession, incrementCorrections,
  incrementPrompts, getPendingNominations, approveNomination,
  rejectNomination, getStats
};
