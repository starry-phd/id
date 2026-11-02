-- Starry billing database (spec S-BIL-04/05): projection of RevenueCat entitlements.
-- RevenueCat stays the only purchase authority; this is a read model for backends.
-- All timestamps are Unix epoch milliseconds, UTC.

-- Every webhook event once (event_id is RevenueCat's id). subscriber_attributes are
-- stripped before storing. After account deletion the member reference is replaced
-- with 'deleted' and the payload emptied; type, time and app stay for accounting.
CREATE TABLE rc_events (
  event_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  app_user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  environment TEXT,
  event_timestamp_ms INTEGER NOT NULL,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_rc_events_pending ON rc_events (processed_at, received_at);
CREATE INDEX idx_rc_events_user ON rc_events (app_user_id);

-- One row per member, App and RevenueCat entitlement identifier.
-- lifetime_product_id: a non-renewing (permanent) purchase that subscription expiry never revokes.
CREATE TABLE entitlements (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  entitlement TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  expires_at INTEGER,
  product_id TEXT,
  lifetime_product_id TEXT,
  store TEXT,
  environment TEXT,
  last_event_ms INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_id, entitlement)
);

-- RevenueCat customers to delete after the Starry account was purged (spec S-ID-06).
CREATE TABLE revenuecat_deletions (
  job_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  app_user_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_revenuecat_deletions_due ON revenuecat_deletions (next_attempt_at);
