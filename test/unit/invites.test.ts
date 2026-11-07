// Unit tests for invite codes: a code gifts free Quantum Battery once per member, within its limits.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createInvite, moveInvites, normalizeCode, redeemInvite, setInviteActive } from '../../src/battery/invites';
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
    assert.deepEqual(await redeemInvite(db, A, ' welcome-1 ', NOW), { ok: true, appId: 'recordnote', units: 5 });
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
});
