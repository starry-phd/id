-- Owner decision 2026-11-07: each App decides what its AI tasks cost; Starry only keeps the monthly allowance,
-- the timeout and a single per-reservation cap (100). The per-task price table is gone and old rows are dropped.
-- The label members see in their history now comes from the App's reserve call.
ALTER TABLE battery_reservations ADD COLUMN task_label TEXT;
ALTER TABLE battery_ledger ADD COLUMN task_label TEXT;
DROP TABLE battery_task_types;
