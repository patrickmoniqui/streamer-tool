CREATE TABLE IF NOT EXISTS globe_geocode_cache (
  query_key TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  display_location TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  country TEXT,
  region TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS globe_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  viewer_key TEXT NOT NULL,
  viewer_name TEXT NOT NULL,
  location_query TEXT NOT NULL,
  display_location TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  country TEXT,
  region TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_globe_checkins_session_updated
  ON globe_checkins(session_id, updated_at DESC);
