-- Claude Starter Template — Learning Database Schema
-- Global DB location: ~/.claude-learnings/learnings.db

-- Main learnings table
CREATE TABLE IF NOT EXISTS learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  project TEXT,
  category TEXT NOT NULL,
  rule TEXT NOT NULL,
  rule_en TEXT,
  mistake TEXT,
  mistake_en TEXT,
  correction TEXT,
  correction_en TEXT,
  confidence REAL DEFAULT 0.5,
  times_applied INTEGER DEFAULT 0,
  last_applied_at TEXT,
  archived INTEGER DEFAULT 0
);

-- Full-text search index using FTS5 with BM25
CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
  category,
  rule,
  mistake,
  correction,
  content=learnings,
  content_rowid=id
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
  INSERT INTO learnings_fts(rowid, category, rule, mistake, correction)
  VALUES (new.id, new.category, new.rule, new.mistake, new.correction);
END;

CREATE TRIGGER IF NOT EXISTS learnings_ad AFTER DELETE ON learnings BEGIN
  INSERT INTO learnings_fts(learnings_fts, rowid, category, rule, mistake, correction)
  VALUES ('delete', old.id, old.category, old.rule, old.mistake, old.correction);
END;

CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
  INSERT INTO learnings_fts(learnings_fts, rowid, category, rule, mistake, correction)
  VALUES ('delete', old.id, old.category, old.rule, old.mistake, old.correction);
  INSERT INTO learnings_fts(rowid, category, rule, mistake, correction)
  VALUES (new.id, new.category, new.rule, new.mistake, new.correction);
END;

-- Sessions table for analytics
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  corrections_count INTEGER DEFAULT 0,
  prompts_count INTEGER DEFAULT 0,
  learnings_extracted INTEGER DEFAULT 0
);

-- Knowledge nominations pipeline
CREATE TABLE IF NOT EXISTS nominations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learning_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT,
  promoted_at TEXT,
  reviewer_notes TEXT,
  FOREIGN KEY (learning_id) REFERENCES learnings(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project);
CREATE INDEX IF NOT EXISTS idx_learnings_confidence ON learnings(confidence);
CREATE INDEX IF NOT EXISTS idx_learnings_archived ON learnings(archived);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_nominations_status ON nominations(status);
