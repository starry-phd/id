-- Where each App is in its life: dev (building), test (internal / TestFlight), live (in the stores).
-- A label for staff only; it changes no behaviour. Apps without a row count as dev.
CREATE TABLE app_stages (
  app_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('dev', 'test', 'live')),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
