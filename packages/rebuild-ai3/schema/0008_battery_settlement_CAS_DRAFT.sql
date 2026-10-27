-- R10 AI-3: D1-shaped settlement scratch assertion, SQLite :memory: ONLY.
-- Depends on previously drafted 0005_free_battery_DRAFT.sql; not applied to
-- Cloudflare D1. SQLite changes() must refer to immediately preceding DML.
-- INSERT CHECK(ok=1) aborts the *entire atomic batch* when any CAS/hold
-- UPDATE affects zero/more-than-one rows. Cleanup DELETE is last in batch.
CREATE TABLE ai3_battery_atomic_assert (
 ok INTEGER NOT NULL CHECK(ok=1)
);
-- DO NOT expose this table or its D1 binding in any public Worker API.
-- Cross-D1 Task, Auth, policy and Q119 claim atomicity NOT satisfied by this.
