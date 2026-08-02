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

-- Public saved-clip permalinks (/s/{id}) — content-addressed and immutable:
-- id is a hash of (show, item, query), so rows are never updated, only added.
CREATE TABLE IF NOT EXISTS saved_clips (
  id TEXT PRIMARY KEY,
  show TEXT NOT NULL,
  item TEXT NOT NULL,
  query TEXT NOT NULL,            -- canonical /c/ query string (t,d,qs,qe[,f][,cols][,txt])
  ip_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saved_created ON saved_clips (created_at);
CREATE INDEX IF NOT EXISTS idx_saved_ip ON saved_clips (ip_hash, created_at);
