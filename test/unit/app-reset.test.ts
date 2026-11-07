// One-click reset of a test App's member data (item 6): what is removed, what is kept, and every refusal.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { previewReset, resetAppData } from '../../src/apps/reset';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const actor = { userId: 'owner', requestId: null };

function dbs() {
  return {
    identity: migratedDb('migrations/identity') as unknown as D1Database,
    billing: migratedDb('migrations/billing') as unknown as D1Database,
    battery: migratedDb('migrations/battery') as unknown as D1Database,
  };
}
type Dbs = ReturnType<typeof dbs>;
const count = async (d: D1Database, table: string, where = '1=1') => ((await d.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first()) as { n: number }).n;

async function seed(d: Dbs, appId: string, env: string | null = 'SANDBOX') {
  const { identity, billing, battery } = d;
  await identity.prepare("INSERT OR IGNORE INTO users (user_id, status, created_at, updated_at, status_changed_at, session_version) VALUES ('u1', 'active', ?, ?, ?, 1)").bind(NOW, NOW, NOW).run();
  await identity.prepare('INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)').bind(`s-${appId}`, 'u1', appId, `h-${appId}`, NOW, NOW, NOW + 1000).run();
  await identity.prepare('INSERT INTO member_apps (user_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)').bind('u1', appId, NOW, NOW).run();
  await identity.prepare('INSERT INTO push_tokens (token, user_id, app_id, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(`ExponentPushToken[tok${appId}12345]`, 'u1', appId, 'ios', NOW, NOW).run();
  await identity.prepare('INSERT INTO push_preferences (user_id, app_id, category, enabled, updated_at) VALUES (?, ?, ?, 1, ?)').bind('u1', appId, 'announcements', NOW).run();
  await billing.prepare('INSERT INTO entitlements (user_id, app_id, entitlement, active, expires_at, last_event_ms, updated_at, environment) VALUES (?, ?, ?, 1, NULL, 1, 1, ?)').bind('u1', appId, 'pro', env).run();
  await billing.prepare('INSERT INTO entitlement_grants (grant_id, user_id, app_id, entitlement, reason, granted_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`g-${appId}`, 'u1', appId, 'pro', 'test', 'o', NOW).run();
  await billing.prepare("INSERT INTO rc_events (event_id, app_id, app_user_id, type, environment, event_timestamp_ms, payload, received_at) VALUES (?, ?, 'u1', 'INITIAL_PURCHASE', ?, 1, '{}', 1)").bind(`e-${appId}`, appId, env).run();
  await battery.prepare('INSERT INTO quantum_accounts (user_id, app_id, balance, reserved, updated_at) VALUES (?, ?, 50, 0, ?)').bind('u1', appId, NOW).run();
  await battery.prepare("INSERT INTO quantum_ledger (entry_id, user_id, app_id, kind, amount, ref, created_at) VALUES (?, 'u1', ?, 'adjustment', 50, ?, ?)").bind(`q-${appId}`, appId, `r-${appId}`, NOW).run();
  await battery.prepare('INSERT INTO invite_codes (code, app_id, units, max_uses, used, created_at) VALUES (?, ?, 5, 10, 1, ?)').bind(`CODE-${appId}`, appId, NOW).run();
  await battery.prepare('INSERT INTO invite_redemptions (code, user_id, redeemed_at) VALUES (?, ?, ?)').bind(`CODE-${appId}`, 'u1', NOW).run();
}

describe('reset a test App', () => {
  test('removes only that App\'s member data and keeps everything else', async () => {
    const d = dbs();
    await seed(d, 'clock');
    await seed(d, 'notes');
    const result = await resetAppData(d, actor, 'clock', NOW);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.counts, { sessions: 1, memberApps: 1, pushTokens: 1, pushPreferences: 1, entitlements: 1, grants: 1, rcEvents: 1, quantumAccounts: 1, quantumLedger: 1, inviteRedemptions: 1 });
    for (const [db, table] of [[d.identity, 'sessions'], [d.identity, 'member_apps'], [d.identity, 'push_tokens'], [d.identity, 'push_preferences'], [d.billing, 'entitlements'], [d.billing, 'entitlement_grants'], [d.billing, 'rc_events'], [d.battery, 'quantum_accounts'], [d.battery, 'quantum_ledger']] as const) {
      assert.equal(await count(db, table, "app_id = 'clock'"), 0, `${table} cleared`);
      assert.equal(await count(db, table, "app_id = 'notes'"), 1, `${table} of another App kept`);
    }
    assert.equal(await count(d.battery, 'invite_redemptions', "code = 'CODE-clock'"), 0);
    assert.equal(await count(d.battery, 'invite_redemptions', "code = 'CODE-notes'"), 1);
    assert.equal(await count(d.battery, 'invite_codes', "code = 'CODE-clock' AND used = 0"), 1, 'the code stays, its counter restarts');
    assert.equal(await count(d.battery, 'invite_codes', "code = 'CODE-notes' AND used = 1"), 1);
    assert.equal(await count(d.identity, 'users'), 1, 'member accounts are never removed');
    assert.equal(await count(d.identity, 'audit_log', "action = 'admin.app_data_reset' AND target_id = 'clock'"), 1);
  });

  test('refuses an App that is live', async () => {
    const d = dbs();
    await seed(d, 'clock');
    await d.identity.prepare("INSERT INTO app_stages (app_id, stage, updated_at, updated_by) VALUES ('clock', 'live', ?, 'o')").bind(NOW).run();
    const result = await resetAppData(d, actor, 'clock', NOW);
    assert.deepEqual(result, { ok: false, blockers: ['live_stage'] });
    assert.equal(await count(d.identity, 'sessions', "app_id = 'clock'"), 1);
  });

  test('a test-stage App is allowed, but an App that ever had a real purchase is not', async () => {
    const d = dbs();
    await seed(d, 'clock', 'PRODUCTION');
    await d.identity.prepare("INSERT INTO app_stages (app_id, stage, updated_at, updated_by) VALUES ('clock', 'test', ?, 'o')").bind(NOW).run();
    assert.deepEqual((await previewReset(d, 'clock', NOW)).blockers, ['real_purchases']);
    await d.billing.prepare("UPDATE entitlements SET environment = 'SANDBOX'").run();
    assert.deepEqual((await previewReset(d, 'clock', NOW)).blockers, ['real_purchases'], 'the event log still shows a real purchase');
    await d.billing.prepare("UPDATE rc_events SET environment = 'SANDBOX'").run();
    assert.deepEqual((await previewReset(d, 'clock', NOW)).blockers, []);
    await d.billing.prepare('UPDATE entitlements SET environment = NULL').run();
    assert.deepEqual((await previewReset(d, 'clock', NOW)).blockers, ['real_purchases'], 'unknown environment counts as real');
    assert.deepEqual(await resetAppData(d, actor, 'clock', NOW), { ok: false, blockers: ['real_purchases'] });
  });

  test('refuses while a Battery task is in flight, and is safe to run again on an empty App', async () => {
    const d = dbs();
    await seed(d, 'clock');
    await d.battery.prepare("INSERT INTO battery_reservations (reservation_id, user_id, app_id, task_type, idempotency_key, units, amount, status, period, created_at, expires_at) VALUES ('r1', 'u1', 'clock', 't', 'key-12345678', 1, 2, 'reserved', '2026-11', ?, ?)").bind(NOW, NOW + 60_000).run();
    assert.deepEqual(await resetAppData(d, actor, 'clock', NOW), { ok: false, blockers: ['tasks_in_flight'] });
    assert.equal((await resetAppData(d, actor, 'clock', NOW + 120_000)).ok, true, 'once the reservation has expired it no longer blocks');
    const again = await resetAppData(d, actor, 'clock', NOW + 120_001);
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(Object.values(again.counts).reduce((a, b) => a + b, 0), 0);
  });
});
