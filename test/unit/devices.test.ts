// Unit tests for the member's own session list, single-session logout and logout everywhere (S-ID-05),
// and the web Apple code exchange (S-ID-06).
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';
import { rememberAppleToken, type FetchLike } from '../../src/identity/apple';
import { listActiveSessions, logoutEverywhere, revokeOwnSession } from '../../src/identity/devices';
import { findOrCreateMember } from '../../src/identity/members';
import { createWebSession, readWebSession, WEB_SESSION_IDLE_MS } from '../../src/identity/web-sessions';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
type Db = ReturnType<typeof migratedDb>;
const asD1 = (db: Db) => db as unknown as D1Database;
let counter = 0;

async function appSession(db: Db, userId: string, opts: { appId?: string; label?: string | null; lastUsed?: number; expires?: number; version?: number } = {}) {
  counter += 1;
  const id = `01900000-0000-7000-8000-${String(counter).padStart(12, '0')}`;
  await db
    .prepare('INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, device_label, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, opts.appId ?? 'echo', `hash-${id}`, opts.version ?? 1, opts.label ?? null, NOW - DAY, opts.lastUsed ?? NOW - HOUR, opts.expires ?? NOW + 10 * DAY)
    .run();
  return id;
}

async function setup() {
  const db = migratedDb();
  const d = asD1(db);
  const { member } = await findOrCreateMember(d, { provider: 'google', subject: `g-${++counter}`, email: null, isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW - DAY);
  return { db, d, userId: member.user_id };
}

const count = async (db: Db, sql: string, ...args: unknown[]) => Number(((await db.prepare(sql).bind(...args).first()) as { n: number } | null)?.n ?? 0);

describe('active sessions (S-ID-05)', () => {
  test('lists only sessions that would still be accepted, most recent first', async () => {
    const { db, d, userId } = await setup();
    const phone = await appSession(db, userId, { label: 'iPhone 16', lastUsed: NOW - HOUR });
    const tablet = await appSession(db, userId, { label: 'Pixel', lastUsed: NOW - 2 * HOUR });
    await appSession(db, userId, { expires: NOW - 1 });
    await appSession(db, userId, { version: 0 });
    const revoked = await appSession(db, userId);
    await db.prepare('UPDATE sessions SET revoked_at = ? WHERE session_id = ?').bind(NOW, revoked).run();
    await appSession(db, userId, { appId: 'account', lastUsed: NOW - WEB_SESSION_IDLE_MS - 1 });
    const web = await createWebSession(d, { userId, sessionVersion: 1, provider: 'google', deviceLabel: '網頁：iOS Safari', requestId: null }, NOW);

    const other = await setup();
    await appSession(other.db, other.userId);

    const list = await listActiveSessions(d, userId, NOW);
    assert.deepEqual(
      list.map((s) => [s.sessionId, s.appId, s.deviceLabel]),
      [
        [web.sessionId, 'account', '網頁：iOS Safari'],
        [phone, 'echo', 'iPhone 16'],
        [tablet, 'echo', 'Pixel'],
      ],
    );
  });

  test('a member can end only their own sessions', async () => {
    const { db, d, userId } = await setup();
    const mine = await appSession(db, userId);
    assert.equal(await revokeOwnSession(d, { userId, sessionId: '01900000-0000-7000-8000-ffffffffffff', appId: 'account', requestId: null }, NOW), false, 'unknown session');
    assert.equal(await revokeOwnSession(d, { userId, sessionId: mine, appId: 'account', requestId: 'r1' }, NOW), true);
    assert.equal(await revokeOwnSession(d, { userId, sessionId: mine, appId: 'account', requestId: 'r2' }, NOW), false, 'already ended');
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM sessions WHERE session_id = ? AND revoke_reason = 'revoked_by_member'", mine), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account.session_revoked'"), 1, 'audited once');
    assert.deepEqual(await listActiveSessions(d, userId, NOW), []);
  });

  test('another member in the same database cannot end my session', async () => {
    const { db, d, userId } = await setup();
    const { member: intruder } = await findOrCreateMember(d, { provider: 'apple', subject: 'a-intruder', email: null, isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW);
    const mine = await appSession(db, userId);
    assert.equal(await revokeOwnSession(d, { userId: intruder.user_id, sessionId: mine, appId: 'account', requestId: null }, NOW), false);
    assert.equal((await listActiveSessions(d, userId, NOW)).length, 1);
  });

  test('logout everywhere ends App and web sessions at once', async () => {
    const { db, d, userId } = await setup();
    await appSession(db, userId);
    const web = await createWebSession(d, { userId, sessionVersion: 1, provider: 'google', deviceLabel: null, requestId: null }, NOW);
    await logoutEverywhere(d, { userId, appId: 'account', requestId: null }, NOW);
    assert.deepEqual(await listActiveSessions(d, userId, NOW), []);
    assert.equal(await readWebSession(d, web.cookieValue, NOW), null);
    assert.equal(await count(db, 'SELECT session_version AS n FROM users WHERE user_id = ?', userId), 2);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.logout_all' AND app_id = 'account'"), 1);
  });
});

describe('web Apple sign-in keeps a revocable token (S-ID-06)', () => {
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const secrets = { APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: pem, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url') };

  test('the web code exchange repeats the Services ID redirect URI; native exchanges do not send one', async () => {
    const { db, d, userId } = await setup();
    const bodies: URLSearchParams[] = [];
    const fetchOk: FetchLike = async (_url, init) => {
      bodies.push(new URLSearchParams(String(init?.body)));
      return Response.json({ refresh_token: `rt-${bodies.length}` });
    };
    assert.equal(await rememberAppleToken(d, secrets, fetchOk, { userId, subject: 'apple-web', clientId: 'phd.starry.id.web', code: 'web-code', redirectUri: 'https://id.starry.phd/account', appId: 'account', requestId: null }, NOW), true);
    assert.equal(await rememberAppleToken(d, secrets, fetchOk, { userId, subject: 'apple-web', clientId: 'phd.starry.app', code: 'app-code', appId: 'echo', requestId: null }, NOW), true);
    assert.equal(bodies[0]?.get('redirect_uri'), 'https://id.starry.phd/account');
    assert.equal(bodies[0]?.get('client_id'), 'phd.starry.id.web');
    assert.equal(bodies[1]?.has('redirect_uri'), false);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM apple_tokens WHERE user_id = ?', userId), 2, 'one token per client ID');
  });
});
