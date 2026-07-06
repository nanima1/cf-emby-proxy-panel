CREATE TABLE IF NOT EXISTS routes (
  prefix TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  mode TEXT DEFAULT 'clean',
  remark TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  last_play TEXT DEFAULT '',
  cacheImages INTEGER DEFAULT 1,
  order_idx INTEGER DEFAULT 0,
  access_policy TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS request_stats (
  prefix TEXT,
  date TEXT,
  count INTEGER DEFAULT 0,
  PRIMARY KEY(prefix, date)
);
