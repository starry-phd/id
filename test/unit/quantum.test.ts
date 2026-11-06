// Unit tests for Quantum Battery: purchases credit once, refunds take units back, and tasks use the free monthly
// Battery first and an App's Quantum Battery only for the rest.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { finish, getBalance, releaseExpired, reserve } from '../../src/battery/battery';
import { adjustQuantum, creditPurchase, getQuantum, listQuantum, quantumHistory, reversePurchase, saveQuantumProduct } from '../../src/battery/quantum';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 15, 4, 0, 0);
const USER = '01900000-0000-7000-8000-000000000001';
const STAFF = '01900000-0000-7000-8000-0000000000aa';
const key = (n: number) => `idem-key-${n.toString().padStart(4, '0')}`;

async function setup(free = 10, bought = 50) {
  const db = migratedDb('migrations/battery');
  const d = db as unknown as D1Database;
  db.sqlite.exec(`UPDATE battery_policy SET monthly_allowance = ${free}`);
  await saveQuantumProduct(d, { appId: 'recordnote', productId: 'pack50', units: bought, actorUserId: STAFF }, NOW);
  return { db, d };
}
const task = (d: D1Database, n: number, units: number, appId = 'recordnote', at = NOW) => reserve(d, { userId: USER, appId, taskType: `${appId}.task`, units, idempotencyKey: key(n) }, at);

describe('buying Quantum Battery', () => {
  test('a purchase credits once per store transaction and only for mapped products', async () => {
    const { d } = await setup();
    assert.equal(await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'pack50', ref: 'txn-1' }, NOW), 'credited');
    assert.equal(await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'pack50', ref: 'txn-1' }, NOW), 'duplicate');
    assert.equal(await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'other', ref: 'txn-2' }, NOW), 'not_a_quantum_product');
    assert.equal((await getQuantum(d, USER, 'recordnote')).available, 50);
    assert.equal((await getQuantum(d, USER, 'echo')).available, 0, 'usable only in the App it was bought in');
  });

  test('a refund takes the units back once, capped at what is not in running tasks', async () => {
    const { d } = await setup(0);
    await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'pack50', ref: 'txn-1' }, NOW);
    assert.ok((await task(d, 1, 30))?.ok);
    assert.equal(await reversePurchase(d, { appId: 'recordnote', ref: 'txn-1' }, NOW), 'reversed');
    assert.equal(await reversePurchase(d, { appId: 'recordnote', ref: 'txn-1' }, NOW), 'duplicate');
    assert.equal(await reversePurchase(d, { appId: 'recordnote', ref: 'nope' }, NOW), 'unknown_purchase');
    const q = await getQuantum(d, USER, 'recordnote');
    assert.equal(q.balance, 30);
    assert.equal(q.available, 0);
    const history = await quantumHistory(d, USER, 'recordnote');
    assert.ok(history.some((h) => h.kind === 'refund' && h.amount === -20));
  });

  test('staff adjustments need a reason and never push the balance below zero', async () => {
    const { d } = await setup();
    assert.equal((await adjustQuantum(d, { userId: USER, appId: 'recordnote', delta: 5, reason: '', actorUserId: STAFF }, NOW)).ok, false);
    const up = await adjustQuantum(d, { userId: USER, appId: 'recordnote', delta: 5, reason: 'goodwill', actorUserId: STAFF }, NOW);
    assert.ok(up.ok && up.balance.balance === 5);
    const down = await adjustQuantum(d, { userId: USER, appId: 'recordnote', delta: -6, reason: 'mistake', actorUserId: STAFF }, NOW);
    assert.deepEqual(down, { ok: false, reason: 'too_low' });
    assert.equal((await listQuantum(d, USER)).length, 1);
  });
});

describe('spending: free Battery first, then Quantum Battery', () => {
  test('a task inside the free Battery never touches Quantum Battery', async () => {
    const { d } = await setup();
    await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'pack50', ref: 't' }, NOW);
    const r = await task(d, 1, 4);
    assert.ok(r?.ok && r.reservation.quantum_amount === 0);
    await finish(d, { reservationId: r.reservation.reservation_id, appId: 'recordnote', action: 'commit' }, NOW);
    assert.equal((await getBalance(d, USER, NOW)).used, 4);
    assert.equal((await getQuantum(d, USER, 'recordnote')).balance, 50);
  });

  test('a task bigger than the free Battery takes the rest from Quantum Battery on commit', async () => {
    const { d } = await setup();
    await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'pack50', ref: 't' }, NOW);
    const r = await task(d, 1, 25);
    assert.ok(r?.ok && r.reservation.quantum_amount === 15);
    assert.equal((await getBalance(d, USER, NOW)).remaining, 0);
    assert.equal((await getQuantum(d, USER, 'recordnote')).available, 35);
    const done = await finish(d, { reservationId: r.reservation.reservation_id, appId: 'recordnote', action: 'commit' }, NOW);
    assert.ok(done.ok && done.reservation.quantum_charged === 15 && done.reservation.charged === 25);
    const again = await finish(d, { reservationId: r.reservation.reservation_id, appId: 'recordnote', action: 'commit' }, NOW);
    assert.ok(again.ok);
    assert.equal((await getBalance(d, USER, NOW)).used, 10);
    const q = await getQuantum(d, USER, 'recordnote');
    assert.deepEqual([q.balance, q.reserved], [35, 0]);
  });

  test('a partial commit uses free Battery first, so a small real usage costs no Quantum Battery', async () => {
    const { d } = await setup();
    await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'pack50', ref: 't' }, NOW);
    const r = await task(d, 1, 25);
    assert.ok(r?.ok);
    await finish(d, { reservationId: r.reservation.reservation_id, appId: 'recordnote', action: 'commit', units: 8 }, NOW);
    assert.equal((await getBalance(d, USER, NOW)).used, 8);
    assert.equal((await getQuantum(d, USER, 'recordnote')).available, 50);
  });

  test('release and timeout give both parts back; not enough of both is refused', async () => {
    const { d } = await setup();
    await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'pack50', ref: 't' }, NOW);
    const a = await task(d, 1, 30);
    assert.ok(a?.ok);
    await finish(d, { reservationId: a.reservation.reservation_id, appId: 'recordnote', action: 'release' }, NOW);
    assert.equal((await getBalance(d, USER, NOW)).remaining, 10);
    assert.equal((await getQuantum(d, USER, 'recordnote')).available, 50);
    const b = await task(d, 2, 40);
    assert.ok(b?.ok);
    assert.equal(await releaseExpired(d, b.reservation.expires_at + 1), 1);
    assert.equal((await getBalance(d, USER, NOW)).remaining, 10);
    assert.equal((await getQuantum(d, USER, 'recordnote')).available, 50);
    const tooBig = await task(d, 3, 61);
    assert.ok(tooBig && !tooBig.ok && tooBig.reason === 'insufficient');
    assert.ok((await task(d, 4, 60))?.ok, 'exactly everything fits');
  });

  test('another App cannot spend it, and two tasks cannot both spend the same Quantum Battery', async () => {
    const { d } = await setup(0, 20);
    await creditPurchase(d, { userId: USER, appId: 'recordnote', productId: 'pack50', ref: 't' }, NOW);
    const other = await task(d, 1, 1, 'echo');
    assert.ok(other && !other.ok);
    const results = await Promise.all([task(d, 2, 15), task(d, 3, 15)]);
    assert.equal(results.filter((x) => x?.ok).length, 1);
    assert.equal((await getQuantum(d, USER, 'recordnote')).available, 5);
  });
});
