// Account center: log out of one App only (item 10), and the member's cross-App subscription list.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { memberSubscriptions } from '../../src/billing/revenuecat';
import { revokeAppSessions } from '../../src/identity/devices';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

async function addUser(d: D1Database, id: string): Promise<void> {
  await d.prepare("INSERT INTO users (user_id, status, created_at, updated_at, status_changed_at, session_version) VALUES (?, 'active', ?, ?, ?, 1)").bind(id, NOW, NOW, NOW).run();
}
let n = 0;
async function session(d: D1Database, userId: string, appId: string): Promise<string> {
  n += 1;
  const id = `s-${n}`;
  await d
    .prepare('INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
    .bind(id, userId, appId, `h-${id}`, NOW - DAY, NOW - 1000, NOW + DAY)
    .run();
  return id;
}
const revoked = async (d: D1Database, id: string) => ((await d.prepare('SELECT revoked_at FROM sessions WHERE session_id = ?').bind(id).first()) as { revoked_at: number | null }).revoked_at;

describe('log out of one App', () => {
  test('ends only that App for that member, and leaves the web session and other members alone', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    await addUser(d, 'u1');
    await addUser(d, 'u2');
    const a1 = await session(d, 'u1', 'clock');
    const a2 = await session(d, 'u1', 'clock');
    const other = await session(d, 'u1', 'notes');
    const web = await session(d, 'u1', 'account');
    const stranger = await session(d, 'u2', 'clock');
    const ended = await revokeAppSessions(d, { userId: 'u1', requestId: null }, 'clock', NOW);
    assert.equal(ended, 2);
    assert.equal(await revoked(d, a1), NOW);
    assert.equal(await revoked(d, a2), NOW);
    assert.equal(await revoked(d, other), null);
    assert.equal(await revoked(d, web), null);
    assert.equal(await revoked(d, stranger), null);
    const audit = (await d.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'account.app_sessions_revoked'").first()) as { n: number };
    assert.equal(audit.n, 1);
  });

  test('refuses to touch the web account center and reports zero when nothing is signed in', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    await addUser(d, 'u1');
    const web = await session(d, 'u1', 'account');
    assert.equal(await revokeAppSessions(d, { userId: 'u1', requestId: null }, 'account', NOW), 0);
    assert.equal(await revoked(d, web), null);
    assert.equal(await revokeAppSessions(d, { userId: 'u1', requestId: null }, 'clock', NOW), 0);
  });
});

describe('member subscriptions across Apps', () => {
  test('lists live purchases and manual grants, hides expired, sandbox and revoked ones', async () => {
    const d = migratedDb('migrations/billing') as unknown as D1Database;
    const ent = (app: string, name: string, active: number, exp: number | null, env: string | null, user = 'u1') =>
      d.prepare('INSERT INTO entitlements (user_id, app_id, entitlement, active, expires_at, product_id, store, environment, last_event_ms, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)').bind(user, app, name, active, exp, 'p', 'APP_STORE', env).run();
    await ent('clock', 'pro', 1, NOW + DAY, 'PRODUCTION');
    await ent('notes', 'plus', 1, null, null);
    await ent('clock', 'old', 1, NOW - 1, 'PRODUCTION');
    await ent('clock', 'off', 0, NOW + DAY, 'PRODUCTION');
    await ent('clock', 'test', 1, NOW + DAY, 'SANDBOX');
    await ent('clock', 'pro', 1, NOW + DAY, 'PRODUCTION', 'u2');
    const grant = (id: string, app: string, ent: string, exp: number | null, revokedAt: number | null) =>
      d.prepare("INSERT INTO entitlement_grants (grant_id, user_id, app_id, entitlement, expires_at, reason, granted_by, created_at, revoked_at) VALUES (?, 'u1', ?, ?, ?, 'r', 'admin', 1, ?)").bind(id, app, ent, exp, revokedAt).run();
    await grant('g1', 'notes', 'gift', NOW + DAY, null);
    await grant('g2', 'notes', 'gone', NOW + DAY, 5);
    const list = await memberSubscriptions(d, 'u1', NOW);
    assert.deepEqual(list.map((x) => `${x.app_id}/${x.entitlement}/${x.granted}`), ['clock/pro/false', 'notes/gift/true', 'notes/plus/false']);
  });
});
