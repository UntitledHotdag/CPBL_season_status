CREATE TABLE series_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  series TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  brothers_wins INTEGER NOT NULL CHECK (brothers_wins BETWEEN 0 AND 4),
  dragons_wins INTEGER NOT NULL CHECK (dragons_wins BETWEEN 0 AND 4),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (season, series, voter_hash),
  CHECK (
    (brothers_wins = 4 AND dragons_wins BETWEEN 0 AND 3)
    OR (dragons_wins = 4 AND brothers_wins BETWEEN 0 AND 3)
  )
);

CREATE INDEX series_predictions_summary_idx
  ON series_predictions (season, series, brothers_wins, dragons_wins);
