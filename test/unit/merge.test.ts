// Unit tests for merging a duplicate account found while linking (S-ID-02 amendment, 2026-11-03).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { adjustAllowance, getBalance } from '../../src/battery/battery';
import { findOrCreateMember } from '../../src/identity/members';
import { completeMerge, findMergeCandidate, mergeInto } from '../../src/identity/merge';
import { createTicket } from '../../src/support/tickets';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 5, 0, 0);
type Db = ReturnType<typeof migratedDb>;
const asD1 = (db: Db) => db as unknown as D1Database;
const ctx = { appId: 'account', requestId: null };
const count = async (db: Db, sql: string, ...args: unknown[]) => Number(((await db.prepare(sql).bind(...args).first()) as { n: number } | null)?.n ?? 0);
const APPLE = { provider: 'apple' as const, subject: 'apple-dup', email: 'dup@privaterelay.appleid.com', isPrivateRelay: true };

async function setup() {
  const idDb = migratedDb();
  const billingDb = migratedDb('migrations/billing');
  const batteryDb = migratedDb('migrations/battery');
  const id = asD1(idDb);
  const { member: main } = await findOrCreateMember(id, { provider: 'google', subject: 'google-main', email: 'me@example.com', isPrivateRelay: false }, ctx, NOW - 10_000);
  const { member: dup } = await findOrCreateMember(id, { provider: 'apple', subject: APPLE.subject, email: APPLE.email, isPrivateRelay: true }, ctx, NOW - 5_000);
  return { idDb, billingDb, batteryDb, id, billing: asD1(billingDb), battery: asD1(batteryDb), main: main.user_id, dup: dup.user_id };
}

describe('finding a duplicate account', () => {
  test('a separate Apple account with nothing at stake can merge', async () => {
    const s = await setup();
    const found = await findMergeCandidate(s.id, s.billing, undefined, s.main, APPLE);
    assert.equal(found?.candidate.userId, s.dup);
    assert.equal(found?.blocker, null);
    assert.equal(await findMergeCandidate(s.id, s.billing, undefined, s.dup, APPLE), null, 'nothing to merge into itself');
    assert.equal(await findMergeCandidate(s.id, s.billing, undefined, s.main, { provider: 'apple', subject: 'nobody' }), null);
  });

  test('staff, suspended, other sign-ins, purchases and a second identity of the provider block merging', async () => {
    const s = await setup();
    const blocker = async () => (await findMergeCandidate(s.id, s.billing, undefined, s.main, APPLE))?.blocker;
    await s.billingDb.prepare("INSERT INTO rc_events (event_id, app_id, app_user_id, type, event_timestamp_ms, payload, received_at) VALUES ('e', 'echo', ?, 'INITIAL_PURCHASE', ?, '{}', ?)").bind(s.dup, NOW, NOW).run();
    assert.equal(await blocker(), 'purchases');
    await s.idDb.prepare("INSERT INTO auth_identities (provider, subject, user_id, created_at, last_login_at) VALUES ('google', 'google-dup', ?, ?, ?)").bind(s.dup, NOW, NOW).run();
    assert.equal(await blocker(), 'other_sign_in');
    await s.idDb.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?").bind(s.dup).run();
    assert.equal(await blocker(), 'suspended');
    await s.idDb.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'support', ?)").bind(s.dup, NOW).run();
    assert.equal(await blocker(), 'staff');
    assert.equal((await findMergeCandidate(s.id, s.billing, s.dup, s.main, APPLE))?.blocker, 'staff', 'owners from the secret count as staff');
    await s.idDb.prepare("INSERT INTO auth_identities (provider, subject, user_id, created_at, last_login_at) VALUES ('apple', 'apple-main', ?, ?, ?)").bind(s.main, NOW, NOW).run();
    assert.equal(await blocker(), 'already_has_provider');
  });
});

describe('merging', () => {
  test('the sign-in, Apple token and tickets move; the duplicate and its Battery go', async () => {
    const s = await setup();
    await s.idDb
      .prepare("INSERT INTO apple_tokens (subject, client_id, user_id, refresh_token_enc, created_at, updated_at) VALUES (?, 'phd.starry.id.web', ?, 'sealed', ?, ?)")
      .bind(APPLE.subject, s.dup, NOW, NOW)
      .run();
    const ticket = await createTicket(s.id, { userId: s.dup, contactEmail: null, category: 'account', appId: null, message: '分開登入了', clientIp: null }, NOW);
    assert.ok(ticket.ok);
    await adjustAllowance(s.battery, { userId: s.dup, delta: 5, reason: '測試', actorUserId: 'admin' }, NOW);
    await s.idDb.prepare("UPDATE profiles SET avatar_key = 'avatars/dup/a.webp' WHERE user_id = ?").bind(s.dup).run();
    const deletedObjects: string[] = [];
    const ok = await completeMerge(
      { db: s.id, battery: s.battery, avatars: { delete: async (key: string) => void deletedObjects.push(key) } },
      { userId: s.main, appId: 'account', requestId: 'req-merge' },
      APPLE,
      s.dup,
      NOW,
    );
    assert.equal(ok, true);
    assert.deepEqual(
      ((await s.idDb.prepare('SELECT provider FROM auth_identities WHERE user_id = ? ORDER BY provider').bind(s.main).all()) as { results: { provider: string }[] }).results.map((r) => r.provider),
      ['apple', 'google'],
    );
    assert.equal(await count(s.idDb, 'SELECT COUNT(*) AS n FROM users WHERE user_id = ?', s.dup), 0);
    assert.equal(await count(s.idDb, 'SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', s.dup), 0);
    assert.equal(await count(s.idDb, 'SELECT COUNT(*) AS n FROM apple_tokens WHERE user_id = ?', s.main), 1, 'the Apple token can still be revoked at deletion');
    assert.equal(await count(s.idDb, 'SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ?', s.main), 1);
    assert.equal(await count(s.idDb, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account.merged.apple' AND result = 'success' AND target_id = ?", s.dup), 1);
    assert.equal(await count(s.batteryDb, 'SELECT COUNT(*) AS n FROM battery_ledger WHERE user_id = ?', s.dup), 0);
    assert.equal((await getBalance(s.battery, s.dup, NOW)).allowance, 10, 'the duplicate has no Battery rows left');
    assert.deepEqual(deletedObjects, ['avatars/dup/a.webp']);
  });

  test('nothing happens when the identity moved meanwhile', async () => {
    const s = await setup();
    await s.idDb.prepare('UPDATE auth_identities SET user_id = ? WHERE subject = ?').bind(s.main, APPLE.subject).run();
    assert.deepEqual(await mergeInto(s.id, { userId: s.main, appId: null, requestId: null }, APPLE, s.dup, NOW), { ok: false });
    assert.equal(await count(s.idDb, 'SELECT COUNT(*) AS n FROM users WHERE user_id = ?', s.dup), 1, 'the other member is kept');
  });

  test('a member who meanwhile linked another identity of the provider is not changed', async () => {
    const s = await setup();
    await s.idDb.prepare("INSERT INTO auth_identities (provider, subject, user_id, created_at, last_login_at) VALUES ('apple', 'apple-main', ?, ?, ?)").bind(s.main, NOW, NOW).run();
    assert.deepEqual(await mergeInto(s.id, { userId: s.main, appId: null, requestId: null }, APPLE, s.dup, NOW), { ok: false });
    assert.equal(await count(s.idDb, 'SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = ?', s.dup), 1);
  });
});
