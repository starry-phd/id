-- RevenueCat secrets an Owner enters in Admin Lite, sealed (AES-GCM) with DATA_ENCRYPTION_KEY.
-- They override the older REVENUECAT_* Worker secrets for the same App.
CREATE TABLE app_revenuecat (
  app_id TEXT PRIMARY KEY,
  webhook_secret_sealed TEXT,
  api_key_sealed TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
