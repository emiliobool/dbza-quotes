-- D1: the entire dynamic state of the site. Everything else is files in git.
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,             -- clip_suggestion | show_request | correction | gif_link
  payload TEXT NOT NULL,          -- JSON
  status TEXT DEFAULT 'pending',  -- pending | approved | rejected
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status, kind);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at);
