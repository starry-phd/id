-- Starry Battery (spec S-BAT-01..07): free monthly AI usage allowance shared by Starry members.
-- Only the battery module writes here. Nothing can be bought, transferred or redeemed (S-BIL-06).
-- All timestamps are Unix epoch milliseconds, UTC. A period is the calendar month in Taiwan
-- time (UTC+8) written as YYYY-MM; the allowance resets when an account is first touched in a
-- new period, so no month-start batch job is needed.

-- One row: the monthly allowance every member gets, and the default reservation timeout.
-- The Owner edits both in Admin Lite (S-BAT-02).
CREATE TABLE battery_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  monthly_allowance INTEGER NOT NULL CHECK (monthly_allowance BETWEEN 0 AND 1000000),
  default_timeout_ms INTEGER NOT NULL CHECK (default_timeout_ms BETWEEN 10000 AND 3600000),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
INSERT INTO battery_policy (id, monthly_allowance, default_timeout_ms, updated_at, updated_by) VALUES (1, 100, 180000, 0, NULL);

-- AI task types and what they cost, per App (S-BAT-02). A reservation costs unit_cost x units,
-- where units is the App backend's estimate (for example minutes of audio), at most max_units.
CREATE TABLE battery_task_types (
  task_type TEXT PRIMARY KEY CHECK (length(task_type) BETWEEN 3 AND 64),
  app_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  unit_cost INTEGER NOT NULL CHECK (unit_cost BETWEEN 1 AND 100000),
  max_units INTEGER NOT NULL CHECK (max_units BETWEEN 1 AND 100000),
  timeout_ms INTEGER CHECK (timeout_ms IS NULL OR timeout_ms BETWEEN 10000 AND 3600000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- One row per member for the current period. allowance already includes this period's manual
-- adjustments. The CHECK makes overspending impossible even under concurrent requests: a
-- reservation that does not fit fails and its whole batch rolls back.
CREATE TABLE battery_accounts (
  user_id TEXT PRIMARY KEY,
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  allowance INTEGER NOT NULL CHECK (allowance >= 0),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at INTEGER NOT NULL,
  CHECK (used + reserved <= allowance)
);

-- Reserve, then commit on success or release on failure/cancel/timeout (S-BAT-03).
-- (app_id, idempotency_key) is unique, so a retried reserve returns the same reservation.
-- op_id marks the request that closed the reservation, so a replayed commit never charges twice.
CREATE TABLE battery_reservations (
  reservation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  units INTEGER NOT NULL CHECK (units > 0),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'released', 'expired')),
  charged INTEGER CHECK (charged IS NULL OR charged >= 0),
  period TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finished_at INTEGER,
  op_id TEXT,
  UNIQUE (app_id, idempotency_key)
);
CREATE INDEX idx_battery_reservations_open ON battery_reservations (status, expires_at);
CREATE INDEX idx_battery_reservations_user ON battery_reservations (user_id);
CREATE INDEX idx_battery_reservations_finished ON battery_reservations (finished_at);

-- Usage and manual adjustments. Rows are only ever added; they are removed after one year
-- or when the member's account is purged (S-ID-06), never changed.
CREATE TABLE battery_ledger (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('usage', 'adjustment')),
  amount INTEGER NOT NULL,
  app_id TEXT,
  task_type TEXT,
  reservation_id TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  actor_user_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (kind = 'usage' OR (reason IS NOT NULL AND actor_user_id IS NOT NULL))
);
CREATE INDEX idx_battery_ledger_user ON battery_ledger (user_id, entry_id);
CREATE INDEX idx_battery_ledger_created ON battery_ledger (created_at);
CREATE TRIGGER battery_ledger_append_only BEFORE UPDATE ON battery_ledger
BEGIN
  SELECT RAISE(ABORT, 'battery_ledger is append-only');
END;
