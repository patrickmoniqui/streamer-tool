CREATE TABLE IF NOT EXISTS dancefloor_profiles (
  user_id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL,
  credentials TEXT,
  connected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Disconnected',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dancefloor_avatars (
  user_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
