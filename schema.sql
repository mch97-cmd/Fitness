CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT,
  sex TEXT,
  age INTEGER,
  height_cm REAL,
  weight_kg REAL,
  body_type TEXT,
  activity_level TEXT,
  goal TEXT,
  experience_level TEXT,
  days_per_week INTEGER,
  equipment TEXT,
  conditions TEXT,
  dietary_prefs TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  gym_program TEXT NOT NULL,
  diet_program TEXT NOT NULL,
  notes TEXT,
  raw_model_output TEXT
);

CREATE INDEX IF NOT EXISTS idx_plans_profile_id ON plans(profile_id);
