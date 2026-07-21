-- SQLite reference schema for HappyMeter / Feliciometro
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'it',
  points INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  current_streak INTEGER NOT NULL DEFAULT 0,
  happy_gesture_streak INTEGER NOT NULL DEFAULT 0,
  premium_status TEXT NOT NULL DEFAULT 'coming-soon',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  happiness INTEGER NOT NULL,
  energy INTEGER NOT NULL,
  sleep INTEGER NOT NULL,
  stress INTEGER NOT NULL,
  physical_activity INTEGER NOT NULL,
  social_relations INTEGER NOT NULL,
  gratitude INTEGER NOT NULL,
  mood INTEGER NOT NULL,
  happy_score INTEGER NOT NULL,
  note TEXT,
  people_text TEXT,
  good_things_text TEXT,
  hard_things_text TEXT,
  activities_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, entry_date)
);
