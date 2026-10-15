CREATE TABLE IF NOT EXISTS game_score_profiles (
  twitch_user_id TEXT PRIMARY KEY NOT NULL,
  public_profile_id TEXT NOT NULL UNIQUE,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_score_profiles_public_profile_id
  ON game_score_profiles(public_profile_id);
