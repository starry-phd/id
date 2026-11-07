-- Product catalog per App (Owner decision 2026-11-07): the store product IDs and the entitlement each one unlocks.
-- It is documentation that feeds the handoff text, so every App's AI gets the same product list. It changes no billing
-- behaviour: purchases are still read from RevenueCat, and Quantum Battery packs are still set on the quantum page.
CREATE TABLE app_products (
  app_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'one_time', 'quantum')),
  ios_product_id TEXT,
  android_product_id TEXT,
  entitlement TEXT,
  note TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (app_id, sku)
);
