#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(require('os').homedir(), '.claude-learnings');
const DB_PATH = path.join(DB_DIR, 'learnings.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const BACKUP_DIR = path.join(DB_DIR, 'backups');

async function initDatabase() {
  // Create directories
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    console.log(`[Learning-DB] Created directory: ${DB_DIR}`);
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Handle --reset flag
  if (process.argv.includes('--reset')) {
    if (fs.existsSync(DB_PATH)) {
      const backupName = `learnings-backup-${Date.now()}.db`;
      fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, backupName));
      fs.unlinkSync(DB_PATH);
      console.log(`[Learning-DB] Backed up and reset database`);
    }
  }

  // Initialize sql.js
  let initSqlJs;
  try {
    initSqlJs = require('sql.js');
  } catch (e) {
    console.error('[Learning-DB] sql.js not installed. Run: npm install');
    process.exit(1);
  }

  const SQL = await initSqlJs();

  // Load existing DB or create new one
  let db;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Read and execute schema (skip FTS5 — not available in sql.js WASM build)
  const schemaRaw = fs.readFileSync(SCHEMA_PATH, 'utf-8');

  // Filter out FTS5 statements (not supported in sql.js)
  const statements = schemaRaw.split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .filter(s => !s.includes('fts5') && !s.includes('learnings_fts') && !s.includes('_fts'));

  for (const stmt of statements) {
    try {
      db.run(stmt + ';');
    } catch (e) {
      // Ignore "already exists" errors
      if (!e.message.includes('already exists')) {
        console.error(`[Learning-DB] Schema warning: ${e.message}`);
      }
    }
  }

  // Get stats
  const learningCount = db.exec('SELECT COUNT(*) as count FROM learnings WHERE archived = 0');
  const sessionCount = db.exec('SELECT COUNT(*) as count FROM sessions');
  const nominationCount = db.exec("SELECT COUNT(*) as count FROM nominations WHERE status = 'pending'");

  const lCount = learningCount.length > 0 ? learningCount[0].values[0][0] : 0;
  const sCount = sessionCount.length > 0 ? sessionCount[0].values[0][0] : 0;
  const nCount = nominationCount.length > 0 ? nominationCount[0].values[0][0] : 0;

  console.log(`[Learning-DB] Database initialized at: ${DB_PATH}`);
  console.log(`[Learning-DB] ${lCount} active learnings, ${sCount} sessions, ${nCount} pending nominations`);

  // Save to disk
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);

  db.close();
  return DB_PATH;
}

if (require.main === module) {
  initDatabase().catch(e => {
    console.error('[Learning-DB] Init failed:', e.message);
    process.exit(1);
  });
}

module.exports = { initDatabase, DB_DIR, DB_PATH, BACKUP_DIR };
