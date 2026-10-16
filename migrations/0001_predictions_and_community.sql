CREATE TABLE predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  series TEXT NOT NULL,
  game_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  winner_team TEXT NOT NULL,
  away_score INTEGER NOT NULL CHECK (away_score BETWEEN 0 AND 30),
  home_score INTEGER NOT NULL CHECK (home_score BETWEEN 0 AND 30),
  rbi_player TEXT NOT NULL,
  winning_pitcher TEXT NOT NULL,
  losing_pitcher TEXT NOT NULL,
  mvp_player TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (season, series, game_id, voter_hash)
);

CREATE INDEX predictions_summary_idx
  ON predictions (season, series, game_id, winner_team);

CREATE TABLE community_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  threads_url TEXT NOT NULL UNIQUE,
  team TEXT NOT NULL,
  game_id TEXT,
  author_name TEXT,
  embed_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  moderated_at TEXT
);

CREATE INDEX community_public_idx
  ON community_submissions (status, team, moderated_at, id);

