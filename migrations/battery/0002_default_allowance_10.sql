-- Owner decision 2026-11-03: every member gets 10 Battery a month by default. Applies only while
-- the policy still holds the original default (never edited in Admin Lite), and moves this
-- month's accounts the same way an Owner edit would, never below what is used or held.
UPDATE battery_accounts
SET allowance = MAX(used + reserved, allowance - 90)
WHERE EXISTS (SELECT 1 FROM battery_policy WHERE id = 1 AND monthly_allowance = 100 AND updated_by IS NULL);
UPDATE battery_policy SET monthly_allowance = 10 WHERE id = 1 AND monthly_allowance = 100 AND updated_by IS NULL;
