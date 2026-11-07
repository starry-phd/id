import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startWorker } from './helpers.mjs';

const NOW = 1_762_000_000_000;

describe('identity migrations', () => {
  let worker;
  before(async () => {
    worker = await startWorker();
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  test('create every core table', async () => {
    const { results } = await worker.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
      .all();
    const names = results.map((r) => r.name).sort();
    assert.deepEqual(names, ['app_config_overrides', 'app_products', 'app_staff', 'app_stages', 'app_status_overrides', 'app_surge_limits', 'apple_revocations', 'apple_tokens', 'audit_log', 'auth_identities', 'auth_nonces', 'builtin_app_overrides', 'cleanup_jobs', 'consents', 'job_heartbeats', 'member_apps', 'notify_broadcast_chunks', 'notify_broadcasts', 'passkeys', 'profile_field_updates', 'profiles', 'push_preferences', 'push_tokens', 'r2_deletions', 'registered_apps', 'retired_member_numbers', 'scoped_notices', 'sessions', 'staff_stepups', 'support_attachments', 'support_ticket_replies', 'support_tickets', 'system_notices', 'user_roles', 'users']);
  });

  test('an identity cannot point at a missing member', async () => {
    await assert.rejects(
      worker.db
        .prepare('INSERT INTO auth_identities (provider, subject, user_id, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)')
        .bind('google', 'sub-1', 'missing-user', NOW, NOW)
        .run(),
      /FOREIGN KEY/,
    );
  });

  test('one member holds at most one identity per provider', async () => {
    await worker.db
      .prepare('INSERT INTO users (user_id, created_at, updated_at) VALUES (?, ?, ?)')
      .bind('u-1', NOW, NOW)
      .run();
    const insert = (subject) =>
      worker.db
        .prepare('INSERT INTO auth_identities (provider, subject, user_id, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)')
        .bind('apple', subject, 'u-1', NOW, NOW)
        .run();
    await insert('apple-sub-1');
    await assert.rejects(insert('apple-sub-2'), /UNIQUE/);
  });

  test('profile and status constraints reject bad values', async () => {
    await assert.rejects(
      worker.db.prepare("UPDATE users SET status = 'deleted' WHERE user_id = 'u-1'").run(),
      /CHECK/,
    );
    await assert.rejects(
      worker.db
        .prepare('INSERT INTO profiles (user_id, birthday, updated_at) VALUES (?, ?, ?)')
        .bind('u-1', '1990/01/01', NOW)
        .run(),
      /CHECK/,
    );
  });

  test('deleting a member removes identities but keeps audit rows', async () => {
    await worker.db
      .prepare(
        "INSERT INTO audit_log (audit_id, occurred_at, actor_type, actor_user_id, action, result, retention_class) VALUES ('a-1', ?, 'user', 'u-1', 'login', 'success', 'security')",
      )
      .bind(NOW)
      .run();
    await worker.db.prepare("DELETE FROM users WHERE user_id = 'u-1'").run();
    const identities = await worker.db.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = 'u-1'").first();
    const audits = await worker.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_user_id = 'u-1'").first();
    assert.equal(identities.n, 0);
    assert.equal(audits.n, 1);
  });
});

describe('billing and battery migrations', () => {
  let worker;
  before(async () => {
    worker = await startWorker();
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  const tables = async (db) =>
    (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results.map((r) => r.name).sort();

  test('create every billing and battery table', async () => {
    assert.deepEqual(await tables(worker.billing), ['app_revenuecat', 'entitlement_grants', 'entitlements', 'rc_events', 'reconcile_state', 'revenuecat_deletions']);
    assert.deepEqual(await tables(worker.battery), ['battery_accounts', 'battery_app_keys', 'battery_app_limits', 'battery_ledger', 'battery_policy', 'battery_reservations', 'invite_codes', 'invite_redemptions', 'quantum_accounts', 'quantum_ledger', 'quantum_products']);
  });

  test('the battery policy starts with 10 a month and a 3-minute timeout', async () => {
    const policy = await worker.battery.prepare('SELECT monthly_allowance, default_timeout_ms FROM battery_policy WHERE id = 1').first();
    assert.deepEqual({ ...policy }, { monthly_allowance: 10, default_timeout_ms: 180000 });
  });

  test('an account can never hold more than its allowance', async () => {
    await assert.rejects(
      worker.battery.prepare("INSERT INTO battery_accounts (user_id, period, allowance, used, reserved, updated_at) VALUES ('u', '2026-11', 10, 6, 5, 0)").run(),
      /CHECK/,
    );
  });
});
