// Unit tests for members, web sessions, support tickets, App status overrides and audit queries.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AppEntry } from '../../src/apps/registry';
import { clearAppStatusCache, setAppStatusOverride, withEffectiveStatus } from '../../src/apps/status';
import { listAudit } from '../../src/identity/audit-query';
import { requestDeletion } from '../../src/identity/lifecycle';
import { runDailyMaintenance } from '../../src/identity/maintenance';
import { acceptConsents, consentRequired, findOrCreateMember, updateProfile } from '../../src/identity/members';
import { consumeNonce, issueNonce, NONCE_TTL_MS } from '../../src/identity/nonces';
import { createWebSession, endWebSession, readWebSession, WEB_SESSION_IDLE_MS } from '../../src/identity/web-sessions';
import { createTicket, getTicket, listTickets, setTicketStatus } from '../../src/support/tickets';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;
const google = (subject: string, email: string | null = null) => ({ provider: 'google' as const, subject, email, isPrivateRelay: false });

describe('members (S-ID-01, S-ID-03, S-ID-08, S-ID-09)', () => {
  test('find-or-create matches only provider + subject, never email', async () => {
    const d = asD1(migratedDb());
    const a = await findOrCreateMember(d, google('g-1', 'same@example.com'), { appId: 'echo', requestId: null }, NOW);
    assert.equal(a.isNew, true);
    assert.match(a.member.user_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    assert.deepEqual({ ...a.member, user_id: 'x' }, { user_id: 'x', status: 'active', session_version: 1, deletion_requested_at: null });
    const again = await findOrCreateMember(d, google('g-1'), { appId: 'echo', requestId: null }, NOW);
    assert.deepEqual([again.isNew, again.member.user_id], [false, a.member.user_id]);
    const other = await findOrCreateMember(d, { provider: 'apple', subject: 'a-1', email: 'same@example.com', isPrivateRelay: false }, { appId: 'echo', requestId: null }, NOW);
    assert.notEqual(other.member.user_id, a.member.user_id);
  });

  test('consent is required until the current versions are accepted', async () => {
    const d = asD1(migratedDb());
    const { member } = await findOrCreateMember(d, google('g-c'), { appId: 'echo', requestId: null }, NOW);
    assert.equal(await consentRequired(d, member.user_id, 't1', 'p1'), true);
    await acceptConsents(d, { userId: member.user_id, termsVersion: 't1', privacyVersion: 'p1', appId: 'account', requestId: null }, NOW);
    await acceptConsents(d, { userId: member.user_id, termsVersion: 't1', privacyVersion: 'p1', appId: 'account', requestId: null }, NOW);
    assert.equal(await consentRequired(d, member.user_id, 't1', 'p1'), false);
    assert.equal(await consentRequired(d, member.user_id, 't2', 'p1'), true, 'new terms need a new acceptance');
  });

  test('profile updates are optimistic: stale versions never overwrite', async () => {
    const d = asD1(migratedDb());
    const { member } = await findOrCreateMember(d, google('g-p'), { appId: 'echo', requestId: null }, NOW);
    const first = await updateProfile(d, { userId: member.user_id, expectedVersion: 1, changes: { display_name: '星', birthday: '2000-01-01' }, appId: 'account', requestId: null }, NOW);
    assert.equal(first.written, true);
    assert.deepEqual([first.profile?.display_name, first.profile?.birthday, first.profile?.version], ['星', '2000-01-01', 2]);
    const stale = await updateProfile(d, { userId: member.user_id, expectedVersion: 1, changes: { display_name: '舊' }, appId: 'account', requestId: null }, NOW);
    assert.equal(stale.written, false);
    assert.equal(stale.profile?.display_name, '星');
    const cleared = await updateProfile(d, { userId: member.user_id, expectedVersion: 2, changes: { birthday: null }, appId: 'account', requestId: null }, NOW);
    assert.deepEqual([cleared.written, cleared.profile?.birthday], [true, null]);
  });
});

describe('web sessions', () => {
  async function setup() {
    const db = migratedDb();
    const d = asD1(db);
    const { member } = await findOrCreateMember(d, google('g-web'), { appId: 'account', requestId: null }, NOW);
    const created = await createWebSession(d, { userId: member.user_id, sessionVersion: 1, provider: 'google', deviceLabel: null, requestId: null }, NOW);
    return { db, d, userId: member.user_id, ...created };
  }

  test('a cookie works until logout and is bound to its secret', async () => {
    const { d, userId, cookieValue, sessionId } = await setup();
    assert.deepEqual(await readWebSession(d, cookieValue, NOW + 1000), { sessionId, userId, status: 'active', createdAt: NOW });
    const [sid] = cookieValue.split('.');
    assert.equal(await readWebSession(d, `${sid}.${'A'.repeat(43)}`, NOW), null, 'wrong secret');
    assert.equal(await readWebSession(d, undefined, NOW), null);
    assert.equal(await readWebSession(d, 'garbage', NOW), null);
    await endWebSession(d, { sessionId, userId, requestId: null }, NOW);
    assert.equal(await readWebSession(d, cookieValue, NOW + 2000), null);
  });

  test('idle timeout, logout-all, suspension and deletion end web sessions', async () => {
    const idle = await setup();
    assert.equal(await readWebSession(idle.d, idle.cookieValue, NOW + WEB_SESSION_IDLE_MS + 1), null);

    const all = await setup();
    await all.db.prepare('UPDATE users SET session_version = session_version + 1 WHERE user_id = ?').bind(all.userId).run();
    assert.equal(await readWebSession(all.d, all.cookieValue, NOW), null);

    const suspended = await setup();
    await suspended.db.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?").bind(suspended.userId).run();
    assert.equal(await readWebSession(suspended.d, suspended.cookieValue, NOW), null);

    const deleting = await setup();
    await requestDeletion(deleting.d, { userId: deleting.userId, appId: 'account', requestId: null }, NOW);
    assert.equal(await readWebSession(deleting.d, deleting.cookieValue, NOW), null);
  });

  test('App sessions are never accepted as web cookies', async () => {
    const { db, d, userId } = await setup();
    await db
      .prepare("INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, created_at, last_used_at, expires_at) VALUES ('01900000-0000-7000-8000-000000000001', ?, 'echo', ?, 1, ?, ?, ?)")
      .bind(userId, '7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9', NOW, NOW, NOW + DAY)
      .run();
    assert.equal(await readWebSession(d, `01900000-0000-7000-8000-000000000001.${'A'.repeat(43)}`, NOW), null);
  });
});

describe('support tickets (S-WEB-02)', () => {
  test('anonymous tickets need a valid email and are throttled per IP', async () => {
    const d = asD1(migratedDb());
    const base = { userId: null, category: 'question' as const, appId: 'echo', message: '  無法登入  ', clientIp: '203.0.113.9' };
    assert.deepEqual(await createTicket(d, { ...base, contactEmail: null }, NOW), { ok: false, reason: 'invalid' });
    assert.deepEqual(await createTicket(d, { ...base, contactEmail: 'not-an-email' }, NOW), { ok: false, reason: 'invalid' });
    assert.deepEqual(await createTicket(d, { ...base, contactEmail: 'a@example.com', message: '   ' }, NOW), { ok: false, reason: 'invalid' });
    for (let i = 0; i < 5; i++) assert.equal((await createTicket(d, { ...base, contactEmail: 'A@Example.com' }, NOW + i)).ok, true);
    assert.deepEqual(await createTicket(d, { ...base, contactEmail: 'a@example.com' }, NOW + 10), { ok: false, reason: 'rate_limited' });
    assert.equal((await createTicket(d, { ...base, contactEmail: 'a@example.com', clientIp: '198.51.100.1' }, NOW + 10)).ok, true);
    assert.equal((await createTicket(d, { ...base, contactEmail: 'a@example.com' }, NOW + 61 * 60 * 1000)).ok, true, 'window passed');
    const { tickets } = await listTickets(d, { status: 'open', limit: 1 });
    assert.equal(tickets[0]?.contact_email, 'a@example.com');
    assert.equal(tickets[0]?.message, '無法登入');
  });

  test('staff close and reopen tickets; list pages by cursor; member tickets go with the member', async () => {
    const db = migratedDb();
    const d = asD1(db);
    const { member } = await findOrCreateMember(d, google('g-t'), { appId: 'echo', requestId: null }, NOW);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await createTicket(d, { userId: member.user_id, contactEmail: null, category: 'account', appId: null, message: `#${i}`, clientIp: null }, NOW + i);
      assert.ok(r.ok);
      ids.push(r.ticketId);
    }
    const page1 = await listTickets(d, { status: 'open', limit: 2 });
    assert.deepEqual(page1.tickets.map((t) => t.message), ['#2', '#1']);
    const page2 = await listTickets(d, { status: 'open', limit: 2, cursor: page1.nextCursor ?? undefined });
    assert.deepEqual([page2.tickets.map((t) => t.message), page2.nextCursor], [['#0'], null]);
    assert.equal(await setTicketStatus(d, { userId: 'staff', requestId: null }, ids[0]!, 'closed', '已回信', NOW + 5), true);
    assert.deepEqual([(await getTicket(d, ids[0]!))?.status, (await getTicket(d, ids[0]!))?.staff_note], ['closed', '已回信']);
    assert.equal(await setTicketStatus(d, { userId: 'staff', requestId: null }, 'missing', 'closed', null, NOW), false);
    await requestDeletion(d, { userId: member.user_id, appId: null, requestId: null }, NOW - 8 * DAY);
    await runDailyMaintenance({ db: d, secrets: {}, fetch: async () => new Response(null) }, NOW);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM support_tickets').first())?.n), 0);
  });
});

describe('App status overrides (S-PLT-01)', () => {
  const echo = { app_id: 'echo', name: 'Echo', status: 'active' } as AppEntry;

  test('an override pauses or kills one App and clearing it restores the default', async () => {
    clearAppStatusCache();
    const d = asD1(migratedDb());
    assert.equal((await withEffectiveStatus(d, echo, NOW)).status, 'active');
    await setAppStatusOverride(d, { userId: 'owner', requestId: null }, 'echo', 'killed', '緊急停用', NOW);
    assert.equal((await withEffectiveStatus(d, echo, NOW + 1)).status, 'killed');
    assert.equal((await withEffectiveStatus(d, { ...echo, app_id: 'other' }, NOW + 1)).status, 'active');
    await setAppStatusOverride(d, { userId: 'owner', requestId: null }, 'echo', null, null, NOW + 2);
    assert.equal((await withEffectiveStatus(d, echo, NOW + 3)).status, 'active');
  });
});

describe('audit query', () => {
  test('filters by member and action prefix with cursor pagination', async () => {
    const db = migratedDb();
    const d = asD1(db);
    const insert = (id: string, actor: string | null, target: string | null, action: string) =>
      db.prepare("INSERT INTO audit_log (audit_id, occurred_at, actor_type, actor_user_id, action, target_id, result, retention_class) VALUES (?, ?, 'user', ?, ?, ?, 'success', 'general')").bind(id, NOW, actor, action, target);
    await db.batch([
      insert('01900000-0000-7000-8000-000000000001', 'u1', 'u1', 'auth.login.google'),
      insert('01900000-0000-7000-8000-000000000002', 'admin', 'u1', 'admin.member_suspended'),
      insert('01900000-0000-7000-8000-000000000003', 'u2', 'u2', 'auth.login.apple'),
      insert('01900000-0000-7000-8000-000000000004', 'u1', 'u1', 'profile_update'),
    ]);
    const mine = await listAudit(d, { memberId: 'u1' });
    assert.deepEqual(mine.rows.map((r) => r.audit_id.slice(-1)), ['4', '2', '1']);
    const logins = await listAudit(d, { actionPrefix: 'auth.login' });
    assert.deepEqual(logins.rows.map((r) => r.action), ['auth.login.apple', 'auth.login.google']);
    const literal = await listAudit(d, { actionPrefix: 'profile_' });
    assert.deepEqual(literal.rows.map((r) => r.action), ['profile_update'], 'underscore is not a wildcard');
    const p1 = await listAudit(d, { limit: 3 });
    const p2 = await listAudit(d, { limit: 3, cursor: p1.nextCursor ?? undefined });
    assert.deepEqual([p1.rows.length, p2.rows.length, p2.nextCursor], [3, 1, null]);
  });
});

describe('sign-in nonces', () => {
  test('single use, bound to the app, expire after 10 minutes, old rows trimmed', async () => {
    const db = migratedDb();
    const d = asD1(db);
    const n = await issueNonce(d, 'echo', NOW);
    assert.match(n, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(await consumeNonce(d, n, 'account', NOW), false, 'other app');
    assert.equal(await consumeNonce(d, n, 'echo', NOW), true);
    assert.equal(await consumeNonce(d, n, 'echo', NOW), false, 'second use');
    const late = await issueNonce(d, 'echo', NOW);
    assert.equal(await consumeNonce(d, late, 'echo', NOW + NONCE_TTL_MS), false, 'expired');
    await issueNonce(d, 'echo', NOW + 3 * NONCE_TTL_MS);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM auth_nonces').first())?.n), 1, 'expired rows removed on issue');
  });
});
