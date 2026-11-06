-- Quantum Battery (owner decision 2026-11-07): an in-app purchase top-up that one App sells and only that App can spend.
-- It is a separate balance per (member, App): it never resets, never expires, cannot be moved to another App and does not
-- add to the free monthly Battery. An App "sells" it when the Owner maps at least one store product to a unit count.
CREATE TABLE quantum_products (
  app_id TEXT NOT NULL,
  product_id TEXT NOT NULL CHECK (length(product_id) BETWEEN 1 AND 200),
  units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 1000000),
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (app_id, product_id)
);

-- balance already includes purchases and adjustments; reserved is held by running tasks.
-- The CHECKs make overspending impossible under concurrent requests, like battery_accounts.
CREATE TABLE quantum_accounts (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_id),
  CHECK (reserved <= balance)
);

-- (app_id, ref) is unique: ref is the store transaction of a purchase, "refund:<transaction>" of a refund, or the
-- reservation of a usage row, so a redelivered store event or a replayed commit can never count twice.
CREATE TABLE quantum_ledger (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'usage', 'refund', 'adjustment')),
  amount INTEGER NOT NULL,
  ref TEXT,
  product_id TEXT,
  task_label TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  actor_user_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (app_id, ref)
);
CREATE INDEX idx_quantum_ledger_user ON quantum_ledger (user_id, entry_id);

-- Part of a reservation that comes from Quantum Battery (the free monthly Battery is spent first), and how much of the
-- final charge it took. amount stays the total, so amount - quantum_amount is what the monthly allowance holds.
ALTER TABLE battery_reservations ADD COLUMN quantum_amount INTEGER NOT NULL DEFAULT 0 CHECK (quantum_amount >= 0);
ALTER TABLE battery_reservations ADD COLUMN quantum_charged INTEGER CHECK (quantum_charged IS NULL OR quantum_charged >= 0);
