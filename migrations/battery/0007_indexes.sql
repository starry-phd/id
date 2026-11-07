CREATE INDEX IF NOT EXISTS idx_battery_ledger_app_created ON battery_ledger (app_id, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_battery_reservations_app_period ON battery_reservations (app_id, period, status);
