-- Session history for work hours tracking and reports
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  project TEXT NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  duration_minutes INTEGER
);

-- Event log for daily/weekly reports
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  target TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_repo_date ON events(repo, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project, started_at);
