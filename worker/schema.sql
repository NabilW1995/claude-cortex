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

-- Time tracking per category session (Issue #60)
CREATE TABLE IF NOT EXISTS time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  project TEXT NOT NULL,
  category TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_time_logs_user_date ON time_logs(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_time_logs_project ON time_logs(project, started_at);

-- Weekly velocity snapshots (Issue #61)
CREATE TABLE IF NOT EXISTS velocity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  week_start TEXT NOT NULL,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_opened INTEGER NOT NULL DEFAULT 0,
  team_hours INTEGER NOT NULL DEFAULT 0,
  per_member TEXT,
  fastest_task TEXT,
  longest_task TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project, week_start)
);

CREATE INDEX IF NOT EXISTS idx_velocity_project_week ON velocity(project, week_start);
