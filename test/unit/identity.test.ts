// Unit tests for the identity domain modules against SQLite-backed D1 (test/support/sqlite-d1.mjs).
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';
import { clientSecret, processAppleRevocations, rememberAppleToken, type FetchLike } from '../../src/identity/apple';
import { cancelDeletion, DELETION_GRACE_MS, purgeExpiredDeletions, requestDeletion } from '../../src/identity/lifecycle';
import { linkIdentity } from '../../src/identity/link';
import { runDailyMaintenance } from '../../src/identity/maintenance';
import { claimOwner, isRecentLogin, maskEmail, maskName, restoreMember, roleOf, searchMembers, setStaffRole, suspendMember } from '../../src/identity/roles';
import { uuidv7 } from '../../src/lib/crypto';
import { open, seal } from '../../src/lib/sealed';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
type Db = ReturnType<typeof migratedDb>;

async function member(db: Db, opts: { status?: string; email?: string; name?: string; provider?: string; subject?: string; createdAt?: number } = {}) {
  const userId = uuidv7(opts.createdAt ?? NOW);
  const t = opts.createdAt ?? NOW;
  await db.batch([
    db.prepare('INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(userId, opts.status ?? 'active', t, t),
    db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?, ?, ?)').bind(userId, opts.name ?? null, t),
    db
      .prepare('INSERT INTO auth_identities (provider, subject, user_id, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(opts.provider ?? 'google', opts.subject ?? `sub-${userId}`, userId, opts.email ?? null, t, t),
  ]);
  return userId;
}

async function session(db: Db, userId: string) {
  const id = uuidv7(NOW);
  await db
    .prepare('INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
    .bind(id, userId, 'echo', `hash-${id}`, NOW, NOW, NOW + 30 * DAY)
    .run();
  return id;
}

const one = async (db: Db, sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).first()) as Record<string, unknown> | null;
const count = async (db: Db, sql: string, ...args: unknown[]) => Number((await one(db, sql, ...args))?.n ?? 0);

describe('account deletion (S-ID-06)', () => {
  test('request disables the account at once and ends every session', async () => {
    const db = migratedDb();
    const id = await member(db);
    const sid = await session(db, id);
    const result = await requestDeletion(db as unknown as D1Database, { userId: id, appId: 'echo', requestId: 'r1' }, NOW);
    assert.deepEqual(result, { ok: true, purgeAt: NOW + DELETION_GRACE_MS });
    const user = await one(db, 'SELECT status, deletion_requested_at, session_version FROM users WHERE user_id = ?', id);
    assert.deepEqual(user, { status: 'pending_deletion', deletion_requested_at: NOW, session_version: 2 });
    assert.equal((await one(db, 'SELECT revoke_reason FROM sessions WHERE session_id = ?', sid))?.revoke_reason, 'deletion_requested');
    assert.deepEqual(await requestDeletion(db as unknown as D1Database, { userId: id, appId: 'echo', requestId: 'r2' }, NOW), { ok: false, reason: 'not_active' });
    assert.deepEqual(await requestDeletion(db as unknown as D1Database, { userId: 'nobody', appId: null, requestId: null }, NOW), { ok: false, reason: 'not_found' });
  });

  test('cancel within the grace period restores the account', async () => {
    const db = migratedDb();
    const id = await member(db);
    await requestDeletion(db as unknown as D1Database, { userId: id, appId: 'echo', requestId: null }, NOW);
    assert.equal(await cancelDeletion(db as unknown as D1Database, { userId: id, appId: 'echo', requestId: null }, NOW + DAY), true);
    assert.deepEqual(await one(db, 'SELECT status, deletion_requested_at FROM users WHERE user_id = ?', id), { status: 'active', deletion_requested_at: null });
    assert.equal(await cancelDeletion(db as unknown as D1Database, { userId: id, appId: 'echo', requestId: null }, NOW + DAY), false);
  });

  test('purge removes personal data after 7 days, keeps audit rows and queues Apple revocation', async () => {
    const db = migratedDb();
    const due = await member(db, { provider: 'apple', subject: 'apple-due', email: 'x@privaterelay.appleid.com' });
    const early = await member(db);
    const other = await member(db);
    await db.prepare("UPDATE profiles SET avatar_key = 'avatars/due.webp' WHERE user_id = ?").bind(due).run();
    await db
      .prepare('INSERT INTO apple_tokens (subject, client_id, user_id, refresh_token_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('apple-due', 'phd.starry.echo', due, 'v1.sealed', NOW, NOW)
      .run();
    await requestDeletion(db as unknown as D1Database, { userId: due, appId: 'echo', requestId: null }, NOW - DELETION_GRACE_MS);
    await requestDeletion(db as unknown as D1Database, { userId: early, appId: 'echo', requestId: null }, NOW - DAY);
    const result = await purgeExpiredDeletions(db as unknown as D1Database, NOW);
    assert.deepEqual(result, { purgedUserIds: [due], avatarKeys: ['avatars/due.webp'] });
    for (const table of ['users', 'profiles', 'auth_identities', 'sessions', 'consents', 'apple_tokens']) {
      assert.equal(await count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, due), 0, table);
    }
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM users WHERE user_id IN (?, ?)', early, other), 2);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM apple_revocations WHERE client_id = 'phd.starry.echo'"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account.purged' AND target_id = ?", due), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account.deletion_requested' AND target_id = ?", due), 1);
  });

  test('a member who cancelled is never purged', async () => {
    const db = migratedDb();
    const id = await member(db);
    await requestDeletion(db as unknown as D1Database, { userId: id, appId: null, requestId: null }, NOW - DELETION_GRACE_MS - DAY);
    await cancelDeletion(db as unknown as D1Database, { userId: id, appId: null, requestId: null }, NOW - DAY);
    assert.deepEqual((await purgeExpiredDeletions(db as unknown as D1Database, NOW)).purgedUserIds, []);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM users WHERE user_id = ?', id), 1);
  });
});

describe('staff roles, suspension and search (S-ID-07, S-ID-10, S-ADM-01)', () => {
  test('owners come from configuration; admin and support from user_roles', async () => {
    const db = migratedDb();
    const owner = await member(db);
    const admin = await member(db);
    await db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'admin', ?)").bind(admin, NOW).run();
    const d = db as unknown as D1Database;
    assert.equal(await roleOf(d, ` ${owner} , other`, owner), 'owner');
    assert.equal(await roleOf(d, owner, admin), 'admin');
    assert.equal(await roleOf(d, undefined, owner), null);
    assert.equal(isRecentLogin(NOW - 9 * 60 * 1000, NOW), true);
    assert.equal(isRecentLogin(NOW - 11 * 60 * 1000, NOW), false);
  });

  test('suspend bumps session_version and revokes sessions; restore reactivates', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const owner = await member(db);
    const target = await member(db);
    const sid = await session(db, target);
    const actor = { userId: owner, role: 'owner' as const, requestId: 'r' };
    assert.equal(await suspendMember(d, owner, actor, target, '違反使用條款', NOW), 'ok');
    assert.deepEqual(await one(db, 'SELECT status, status_reason, session_version FROM users WHERE user_id = ?', target), { status: 'suspended', status_reason: '違反使用條款', session_version: 2 });
    assert.equal((await one(db, 'SELECT revoke_reason FROM sessions WHERE session_id = ?', sid))?.revoke_reason, 'suspended');
    assert.equal(await suspendMember(d, owner, actor, target, 'again', NOW), 'wrong_status');
    assert.equal(await restoreMember(d, actor, target, NOW), 'ok');
    assert.deepEqual(await one(db, 'SELECT status, status_reason, session_version FROM users WHERE user_id = ?', target), { status: 'active', status_reason: null, session_version: 2 });
    assert.equal(await restoreMember(d, actor, target, NOW), 'wrong_status');
    assert.equal(await restoreMember(d, actor, 'missing', NOW), 'not_found');
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('admin.member_suspended', 'admin.member_restored')"), 2);
  });

  test('owners cannot be suspended, staff only by owners, nobody suspends themselves', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const owner = await member(db);
    const admin = await member(db);
    const admin2 = await member(db);
    const support = await member(db);
    await db.batch([
      db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'admin', ?)").bind(admin, NOW),
      db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'admin', ?)").bind(admin2, NOW),
      db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'support', ?)").bind(support, NOW),
    ]);
    const asAdmin = { userId: admin, role: 'admin' as const, requestId: null };
    const asSupport = { userId: support, role: 'support' as const, requestId: null };
    assert.equal(await suspendMember(d, owner, asAdmin, owner, 'x', NOW), 'not_allowed');
    assert.equal(await suspendMember(d, owner, asAdmin, admin2, 'x', NOW), 'not_allowed');
    assert.equal(await suspendMember(d, owner, asAdmin, admin, 'x', NOW), 'not_allowed');
    const plain = await member(db);
    assert.equal(await suspendMember(d, owner, asSupport, plain, 'x', NOW), 'not_allowed');
    assert.equal(await suspendMember(d, owner, asAdmin, plain, 'x', NOW), 'ok');
    assert.equal(await suspendMember(d, owner, { userId: owner, role: 'owner', requestId: null }, admin2, 'x', NOW), 'ok');
  });

  test('only owners grant or revoke staff roles', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const owner = await member(db);
    const target = await member(db);
    const asOwner = { userId: owner, role: 'owner' as const, requestId: null };
    assert.equal(await setStaffRole(d, owner, asOwner, target, 'support', NOW), 'ok');
    assert.equal(await roleOf(d, owner, target), 'support');
    assert.equal(await setStaffRole(d, owner, asOwner, target, 'admin', NOW), 'ok');
    assert.equal(await roleOf(d, owner, target), 'admin');
    assert.equal(await setStaffRole(d, owner, { userId: target, role: 'admin', requestId: null }, owner, null, NOW), 'not_allowed');
    assert.equal(await setStaffRole(d, owner, asOwner, owner, 'admin', NOW), 'not_allowed');
    assert.equal(await setStaffRole(d, owner, asOwner, target, null, NOW), 'ok');
    assert.equal(await roleOf(d, owner, target), null);
    assert.equal(await setStaffRole(d, owner, asOwner, 'missing', 'admin', NOW), 'not_found');
  });

  test('search finds by member ID or email and masks personal data; listing pages by cursor', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await member(db, { email: `user${i}@example.com`, name: `星星${i}號`, createdAt: NOW + i }));
    const byEmail = await searchMembers(d, undefined, { query: 'USER2@example.com' });
    assert.equal(byEmail.members.length, 1);
    assert.deepEqual(byEmail.members[0], {
      user_id: ids[2], status: 'active', status_reason: null, created_at: NOW + 2,
      display_name: '星＊＊＊', emails: ['u***@example.com'], providers: ['google'], role: null,
    });
    assert.equal((await searchMembers(d, undefined, { query: ids[4] })).members[0]?.user_id, ids[4]);
    const page1 = await searchMembers(d, undefined, { limit: 2 });
    assert.deepEqual(page1.members.map((m) => m.user_id), [ids[4], ids[3]]);
    const page2 = await searchMembers(d, undefined, { limit: 2, cursor: page1.nextCursor ?? undefined });
    assert.deepEqual(page2.members.map((m) => m.user_id), [ids[2], ids[1]]);
    const page3 = await searchMembers(d, undefined, { limit: 2, cursor: page2.nextCursor ?? undefined });
    assert.deepEqual(page3.members.map((m) => m.user_id), [ids[0]]);
    assert.equal(page3.nextCursor, null);
    assert.equal(maskEmail('a@b.co'), 'a***@b.co');
    assert.equal(maskName('星'), '＊');
    assert.equal(maskName(null), null);
  });
});

describe('owner claim', () => {
  test('works once with the right code while the secret is set', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const me = await member(db);
    const other = await member(db);
    const code = 'starry-owner-2026';
    assert.equal(await claimOwner(d, undefined, me, code, null, NOW), 'disabled');
    assert.equal(await claimOwner(d, 'short', me, 'short', null, NOW), 'disabled');
    assert.equal(await claimOwner(d, code, me, 'wrong-code-000', null, NOW), 'wrong_code');
    assert.equal(await claimOwner(d, code, me, code, null, NOW), 'claimed');
    assert.equal(await roleOf(d, undefined, me), 'owner');
    assert.equal(await claimOwner(d, code, other, code, null, NOW), 'already_claimed');
    const asOwner = { userId: me, role: 'owner' as const, requestId: null };
    assert.equal(await setStaffRole(d, undefined, asOwner, other, 'admin', NOW), 'ok');
    assert.equal(await setStaffRole(d, undefined, { userId: other, role: 'admin', requestId: null }, me, null, NOW), 'not_allowed');
    assert.equal(await suspendMember(d, undefined, { userId: other, role: 'admin', requestId: null }, me, 'x', NOW), 'not_allowed', 'a claimed owner cannot be suspended');
  });
});

describe('linking a second sign-in method (S-ID-02)', () => {
  test('links a new provider once, refuses identities owned by others', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const me = await member(db, { provider: 'google', subject: 'g-me' });
    const other = await member(db, { provider: 'apple', subject: 'a-other' });
    const actor = { userId: me, appId: 'echo', requestId: null };
    const apple = { provider: 'apple' as const, subject: 'a-me', email: null, isPrivateRelay: false };
    assert.equal(await linkIdentity(d, actor, apple, NOW), 'linked');
    assert.equal(await linkIdentity(d, actor, apple, NOW), 'already_linked');
    assert.equal(await linkIdentity(d, actor, { ...apple, subject: 'a-second' }, NOW), 'provider_in_use');
    assert.equal(await linkIdentity(d, actor, { ...apple, subject: 'a-other' }, NOW), 'identity_in_use');
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = ?', me), 2);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = ?', other), 1);
  });
});

describe('sealed secrets and Apple token revocation', () => {
  const key = Buffer.alloc(32, 7).toString('base64url');
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const secrets = { APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: pem, DATA_ENCRYPTION_KEY: key };

  test('seal round-trips and refuses the wrong context or key', async () => {
    const sealed = await seal(key, 'ctx', 'refresh-token-value');
    assert.ok(sealed?.startsWith('v1.'));
    assert.equal(await open(key, 'ctx', sealed!), 'refresh-token-value');
    assert.equal(await open(key, 'other', sealed!), null);
    assert.equal(await open(Buffer.alloc(32, 8).toString('base64url'), 'ctx', sealed!), null);
    assert.equal(await seal('short', 'ctx', 'x'), null);
  });

  test('client secret is an ES256 JWT for appleid.apple.com', async () => {
    const jwt = await clientSecret({ teamId: 'TEAM123456', keyId: 'KEY1234567', privateKeyPem: pem, encryptionKey: key }, 'phd.starry.echo', NOW);
    const [h, p, s] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h!, 'base64url').toString()), { alg: 'ES256', kid: 'KEY1234567' });
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    assert.deepEqual(claims, { iss: 'TEAM123456', iat: NOW / 1000, exp: NOW / 1000 + 300, aud: 'https://appleid.apple.com', sub: 'phd.starry.echo' });
    assert.equal(Buffer.from(s!, 'base64url').length, 64);
  });

  test('stores the exchanged refresh token sealed, then revokes it after purge', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const calls: { url: string; body: URLSearchParams }[] = [];
    const fetchOk: FetchLike = async (url, init) => {
      calls.push({ url, body: new URLSearchParams(String(init?.body)) });
      return url.endsWith('/auth/token') ? Response.json({ refresh_token: 'apple-refresh-1' }) : new Response(null, { status: 200 });
    };
    const id = await member(db, { provider: 'apple', subject: 'apple-sub' });
    const stored = await rememberAppleToken(d, secrets, fetchOk, { userId: id, subject: 'apple-sub', clientId: 'phd.starry.echo', code: 'code-1', appId: 'echo', requestId: null }, NOW);
    assert.equal(stored, true);
    assert.equal(calls[0]?.body.get('grant_type'), 'authorization_code');
    assert.equal(calls[0]?.body.get('code'), 'code-1');
    const row = await one(db, 'SELECT refresh_token_enc FROM apple_tokens WHERE user_id = ?', id);
    assert.doesNotMatch(String(row?.refresh_token_enc), /apple-refresh-1/);

    await requestDeletion(d, { userId: id, appId: 'echo', requestId: null }, NOW - DELETION_GRACE_MS);
    const report = await runDailyMaintenance({ db: d, secrets, fetch: fetchOk }, NOW);
    assert.equal(report.purgedMembers, 1);
    assert.equal(report.appleRevoked, 1);
    const revoke = calls.find((c) => c.url.endsWith('/auth/revoke'));
    assert.equal(revoke?.body.get('token'), 'apple-refresh-1');
    assert.equal(revoke?.body.get('token_type_hint'), 'refresh_token');
    assert.equal(revoke?.body.get('client_id'), 'phd.starry.echo');
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM apple_revocations'), 0);
  });

  test('without Apple secrets the exchange is skipped and audited', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const id = await member(db, { provider: 'apple', subject: 'apple-x' });
    const never: FetchLike = async () => assert.fail('must not call Apple');
    assert.equal(await rememberAppleToken(d, {}, never, { userId: id, subject: 'apple-x', clientId: 'c', code: 'k', appId: null, requestId: null }, NOW), false);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'apple.token_exchange' AND result = 'error'"), 1);
  });

  test('failed revocations back off and are abandoned after 10 attempts', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const sealed = await seal(key, 'apple_refresh_token', 'rt');
    await db.prepare("INSERT INTO apple_revocations (revocation_id, client_id, refresh_token_enc, next_attempt_at, created_at) VALUES ('r1', 'c', ?, ?, ?)").bind(sealed, NOW, NOW).run();
    const failing: FetchLike = async () => new Response('err', { status: 500 });
    assert.deepEqual(await processAppleRevocations(d, secrets, failing, NOW), { revoked: 0, failed: 1, abandoned: 0 });
    assert.deepEqual(await one(db, "SELECT attempts, next_attempt_at FROM apple_revocations WHERE revocation_id = 'r1'"), { attempts: 1, next_attempt_at: NOW + 60 * 60 * 1000 });
    assert.deepEqual(await processAppleRevocations(d, secrets, failing, NOW), { revoked: 0, failed: 0, abandoned: 0 });
    await db.prepare("UPDATE apple_revocations SET attempts = 9, next_attempt_at = ? WHERE revocation_id = 'r1'").bind(NOW).run();
    assert.deepEqual(await processAppleRevocations(d, secrets, failing, NOW), { revoked: 0, failed: 0, abandoned: 1 });
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'apple.token_revoke_abandoned'"), 1);
  });
});

describe('daily maintenance (S-PLT-06)', () => {
  test('tells other domains which members were purged', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const id = await member(db);
    await requestDeletion(d, { userId: id, appId: null, requestId: null }, NOW - DELETION_GRACE_MS);
    const seen: string[][] = [];
    await runDailyMaintenance({ db: d, secrets: {}, fetch: async () => new Response(null), onPurged: async (ids) => void seen.push(ids) }, NOW);
    assert.deepEqual(seen, [[id]]);
    await runDailyMaintenance({ db: d, secrets: {}, fetch: async () => new Response(null), onPurged: async (ids) => void seen.push(ids) }, NOW);
    assert.equal(seen.length, 1, 'not called when nobody was purged');
  });

  test('removes expired nonces, old sessions and audit rows past retention', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const id = await member(db);
    await db.batch([
      db.prepare("INSERT INTO auth_nonces (nonce, app_id, created_at, expires_at) VALUES ('old', 'echo', ?, ?)").bind(NOW - 3 * DAY, NOW - 2 * DAY),
      db.prepare("INSERT INTO auth_nonces (nonce, app_id, created_at, expires_at) VALUES ('new', 'echo', ?, ?)").bind(NOW, NOW + 600000),
      db.prepare("INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, created_at, last_used_at, expires_at, revoked_at) VALUES ('s-old', ?, 'echo', 'h1', 1, ?, ?, ?, ?)").bind(id, NOW - 90 * DAY, NOW - 90 * DAY, NOW + DAY, NOW - 31 * DAY),
      db.prepare("INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, created_at, last_used_at, expires_at, revoked_at) VALUES ('s-recent', ?, 'echo', 'h2', 1, ?, ?, ?, ?)").bind(id, NOW - 9 * DAY, NOW - 9 * DAY, NOW + DAY, NOW - 2 * DAY),
      db.prepare("INSERT INTO audit_log (audit_id, occurred_at, actor_type, action, result, retention_class) VALUES ('g-old', ?, 'system', 'x', 'success', 'general')").bind(NOW - 91 * DAY),
      db.prepare("INSERT INTO audit_log (audit_id, occurred_at, actor_type, action, result, retention_class) VALUES ('s-keep', ?, 'system', 'x', 'success', 'security')").bind(NOW - 91 * DAY),
      db.prepare("INSERT INTO audit_log (audit_id, occurred_at, actor_type, action, result, retention_class) VALUES ('s-old', ?, 'system', 'x', 'success', 'security')").bind(NOW - 366 * DAY),
    ]);
    const report = await runDailyMaintenance({ db: d, secrets: {}, fetch: async () => new Response(null) }, NOW);
    assert.deepEqual([report.nonces, report.sessions, report.audit], [1, 1, 2]);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM auth_nonces WHERE nonce = 'new'"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM sessions WHERE session_id = 's-recent'"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE audit_id = 's-keep'"), 1);
  });
});
