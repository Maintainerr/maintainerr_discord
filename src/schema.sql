CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'question')),
  state TEXT NOT NULL DEFAULT 'collecting',
  title TEXT NOT NULL,
  fields TEXT NOT NULL,
  thread_id TEXT UNIQUE,
  control_message_id TEXT,
  issue_number INTEGER UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  discord_id TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  url TEXT,
  content TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_token TEXT,
  lease_until INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status, available_at, lease_until);
CREATE TABLE IF NOT EXISTS sync (
  direction TEXT NOT NULL,
  source_id TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES reports(id),
  remote_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (direction, source_id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES reports(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_rate ON submissions(reporter_id, created_at);
CREATE TABLE IF NOT EXISTS poll_cursor (
  key TEXT PRIMARY KEY,
  cursor TEXT,
  etag TEXT,
  updated_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks USING fts5(
  page, heading, content, url UNINDEXED, source_path UNINDEXED,
  tokenize = 'unicode61'
);
