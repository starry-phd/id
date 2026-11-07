-- Entitlements staff grant by hand (support goodwill, lost purchases). Kept apart from `entitlements` so that
-- RevenueCat events and the daily reconciliation never overwrite them. The reason stays here for staff only.
CREATE TABLE entitlement_grants (
  grant_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  entitlement TEXT NOT NULL,
  expires_at INTEGER,
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_entitlement_grants_user ON entitlement_grants (user_id, app_id);
