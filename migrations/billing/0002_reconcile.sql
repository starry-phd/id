-- Daily reconciliation with RevenueCat (spec S-BIL-04): when each member/App pair was last
-- compared with RevenueCat's customer record, and what the comparison found. Pairs checked
-- longest ago go first, so every buyer is covered over successive days.
CREATE TABLE reconcile_state (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('match', 'fixed', 'error')),
  PRIMARY KEY (user_id, app_id)
);
CREATE INDEX idx_reconcile_state_checked ON reconcile_state (checked_at);
