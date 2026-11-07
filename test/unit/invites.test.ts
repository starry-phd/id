// Unit tests for invite codes: a code gifts free Quantum Battery once per member, within its limits.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getBalance } from '../../src/battery/battery';
import { batchCodes, codeInfo, createBatch, createInvite, moveInvites, normalizeCode, recentBatches, redeemInvite, setBatchActive, setInviteActive } from '../../src/battery/invites';
import { getQuantum } from '../../src/battery/quantum';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 15, 4, 0, 0);
const A = '01900000-0000-7000-8000-000000000001';
const B = '01900000-0000-7000-8000-000000000002';
const STAFF = '01900000-0000-7000-8000-0000000000aa';
const d = () => migratedDb('migrations/battery') as unknown as D1Database;
const make = (db: D1Database, over: Partial<{ code: string; units: number; maxUses: number; expiresAt: number | null }> = {}) =>
  createInvite(db, { appId: 'recordnote', code: 'WELCOME1', units: 5, maxUses: 2, expiresAt: null, note: '', actorUserId: STAFF, ...over }, NOW);

describe('invite codes', () => {
  test('redeeming gifts quantum battery in that App once per member', async () => {
    const db = d();
    assert.equal(await make(db), 'WELCOME1');
    assert.deepEqual(await redeemInvite(db, A, ' welcome-1 ', NOW), { ok: true, kind: 'quantum', appId: 'recordnote', units: 5 });
    assert.equal((await getQuantum(db, A, 'recordnote')).available, 5);
    assert.equal((await getQuantum(db, A, 'echo')).available, 0);
    assert.deepEqual(await redeemInvite(db, A, 'WELCOME1', NOW), { ok: false, reason: 'already' });
    assert.equal((await getQuantum(db, A, 'recordnote')).available, 5);
  });

  test('limits: max uses, expiry, disabled and unknown codes', async () => {
    const db = d();
    await make(db, { maxUses: 1 });
    assert.equal((await redeemInvite(db, A, 'WELCOME1', NOW)).ok, true);
    assert.deepEqual(await redeemInvite(db, B, 'WELCOME1', NOW), { ok: false, reason: 'used_up' });
    assert.equal((await getQuantum(db, B, 'recordnote')).available, 0);
    await make(db, { code: 'EXPIRING', expiresAt: NOW + 1000 });
    assert.deepEqual(await redeemInvite(db, B, 'EXPIRING', NOW + 2000), { ok: false, reason: 'invalid' });
    await make(db, { code: 'PAUSED01' });
    await setInviteActive(db, 'recordnote', 'PAUSED01', false);
    assert.deepEqual(await redeemInvite(db, B, 'PAUSED01', NOW), { ok: false, reason: 'invalid' });
    assert.deepEqual(await redeemInvite(db, B, 'NOPE1234', NOW), { ok: false, reason: 'invalid' });
    assert.deepEqual(await redeemInvite(db, B, '!!', NOW), { ok: false, reason: 'invalid' });
  });

  test('creation validates input, generates codes and rejects duplicates', async () => {
    const db = d();
    assert.equal(await make(db, { code: 'abc' }), null);
    assert.equal(await make(db, { units: 0 }), null);
    assert.equal(await make(db, { expiresAt: NOW - 1 }), null);
    const generated = await make(db, { code: '' });
    assert.match(generated ?? '', /^[A-Z0-9]{10}$/);
    assert.equal(await make(db), 'WELCOME1');
    assert.equal(await make(db), null, 'duplicate code');
    assert.equal(normalizeCode(' ab-cd ef '), 'ABCDEF');
  });

  test('a merged account keeps its redemptions', async () => {
    const db = d();
    await make(db);
    await redeemInvite(db, A, 'WELCOME1', NOW);
    await moveInvites(db, A, B);
    assert.deepEqual(await redeemInvite(db, B, 'WELCOME1', NOW), { ok: false, reason: 'already' });
  });

  test('a battery code adds free Starry Battery to this month only; a quantum code needs an App', async () => {
    const db = d();
    assert.equal(await createBatch(db, { kind: 'quantum', appId: null, units: 1, count: 1, maxUsesPerCode: 1, expiresAt: null, note: '', actorUserId: STAFF }, NOW), null);
    assert.equal(await createBatch(db, { kind: 'battery', appId: 'echo', units: 1, count: 1, maxUsesPerCode: 1, expiresAt: null, note: '', actorUserId: STAFF }, NOW), null, 'battery codes are not tied to an App');
    assert.equal(await createBatch(db, { kind: 'battery', appId: null, units: 1, count: 101, maxUsesPerCode: 1, expiresAt: null, note: '', actorUserId: STAFF }, NOW), null);
    const made = await createBatch(db, { kind: 'battery', appId: null, units: 3, count: 3, maxUsesPerCode: 1, expiresAt: null, note: '活動', actorUserId: STAFF }, NOW);
    assert.ok(made);
    assert.equal(new Set(made.codes).size, 3);
    assert.deepEqual(await codeInfo(db, made.codes[0] ?? '', NOW), { kind: 'battery', appId: null, units: 3 });
    const before = await getBalance(db, A, NOW);
    assert.deepEqual(await redeemInvite(db, A, made.codes[0] ?? '', NOW), { ok: true, kind: 'battery', appId: null, units: 3 });
    const after = await getBalance(db, A, NOW);
    assert.equal(after.allowance, before.allowance + 3);
    assert.equal(after.remaining, before.remaining + 3);
    assert.equal((await getBalance(db, A, NOW + 40 * 86400_000)).allowance, before.allowance, 'next month it is the standard allowance again');
    assert.equal((await redeemInvite(db, B, made.codes[0] ?? '', NOW)).ok, false, 'a one-use code cannot be used by a second member');
    const summary = await recentBatches(db);
    assert.equal(summary[0]?.codes, 3);
    assert.equal(summary[0]?.used, 1);
    await setBatchActive(db, made.batchId, false);
    assert.equal(await codeInfo(db, made.codes[1] ?? '', NOW), null);
    assert.equal((await batchCodes(db, made.batchId)).length, 3);
    const q = await createBatch(db, { kind: 'quantum', appId: 'recordnote', units: 2, count: 1, maxUsesPerCode: 5, expiresAt: null, note: '', actorUserId: STAFF }, NOW);
    assert.deepEqual(await redeemInvite(db, B, q?.codes[0] ?? '', NOW), { ok: true, kind: 'quantum', appId: 'recordnote', units: 2 });
  });
});
