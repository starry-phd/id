-- Optional monthly Battery ceiling per App (all members together). No row = no ceiling.
CREATE TABLE battery_app_limits (
  app_id TEXT PRIMARY KEY,
  monthly_cap INTEGER NOT NULL CHECK (monthly_cap >= 1 AND monthly_cap <= 1000000000),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
