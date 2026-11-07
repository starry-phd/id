// Battery bonus multiplier: every public bonus field adds 0.1x to the free Battery a member earns, applied at once everywhere.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { adjustAllowance, bonusOf, forgetBatteryMembers, getBalance, getBalances, reserve, scaled, setBonus, setPolicy, staffLedger } from '../../src/battery/battery';
import { syncBonus } from '../../src/battery/bonus';
import { createBatch, redeemInvite } from '../../src/battery/invites';
import { BONUS_FIELDS, bonusX10, formatBonus, VISIBILITY_FIELDS } from '../../src/identity/profile';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 15, 4, 0, 0);
const A = '01900000-0000-7000-8000-000000000001';
const B = '01900000-0000-7000-8000-000000000002';
const STAFF = '01900000-0000-7000-8000-0000000000aa';
const setup = () => migratedDb('migrations/battery') as unknown as D1Database;
const vis = (fields: string[]) => JSON.stringify(Object.fromEntries(fields.map((f) => [f, 'public'])));

describe('multiplier from the profile', () => {
  test('1.0x by default, +0.1x per public bonus field, 2.0x at ten, name/motto/avatar do not count', () => {
    assert.equal(bonusX10({ visibility: '{}', birthday: null }, NOW), 10, 'default state is 1.0x');
    assert.equal(formatBonus(10), '1.0');
    assert.equal(BONUS_FIELDS.length, 12);
    assert.ok(!BONUS_FIELDS.includes('display_name') && !BONUS_FIELDS.includes('motto') && !BONUS_FIELDS.includes('avatar' as never));
    assert.equal(bonusX10({ visibility: vis(['phone']), birthday: null }, NOW), 11);
    assert.equal(bonusX10({ visibility: vis(BONUS_FIELDS.slice(0, 10) as string[]), birthday: null }, NOW), 20, 'ten fields = +1.0x');
    assert.equal(bonusX10({ visibility: vis([...VISIBILITY_FIELDS]), birthday: null }, NOW), 22, 'everything public');
    assert.equal(bonusX10({ visibility: JSON.stringify({ display_name: 'private', motto: 'private' }), birthday: null }, NOW), 10, 'hiding name or motto never goes below 1.0x');
  });

  test("a minor's birthday and derived information stay private, so they earn nothing", () => {
    const row = { visibility: vis(['birthday', 'derived', 'bio']), birthday: '2015-01-01' };
    assert.equal(bonusX10(row, NOW), 11);
    assert.equal(bonusX10({ ...row, birthday: '1990-01-01' }, NOW), 13);
  });
});

describe('applied at once to what a member earns', () => {
  test('the monthly allowance moves immediately and back, never below what is used or held', async () => {
    const d = setup(); // default 10 a month
    assert.equal((await getBalance(d, A, NOW)).allowance, 10);
    assert.equal((await setBonus(d, A, 15, NOW)).changed, true);
    assert.equal((await getBalance(d, A, NOW)).allowance, 15 - 0, 'no account row yet: the balance already shows 1.5x');
    const r = await reserve(d, { userId: A, appId: 'recordnote', taskType: 'recordnote.transcribe', units: 8, idempotencyKey: 'bonus-key-0001' }, NOW);
    assert.ok(r.ok);
    assert.equal((await getBalance(d, A, NOW)).allowance, 15, 'a new account starts at the scaled amount');
    assert.equal((await setBonus(d, A, 20, NOW + 1)).changed, true);
    assert.equal((await getBalance(d, A, NOW + 1)).allowance, 20, 'raising it applies this month at once');
    assert.equal((await setBonus(d, A, 10, NOW + 2)).changed, true);
    const low = await getBalance(d, A, NOW + 2);
    assert.equal(low.allowance, 10);
    assert.ok(low.allowance >= low.used + low.reserved);
    assert.equal((await setBonus(d, A, 10, NOW + 3)).changed, false, 'same value is a no-op');
    assert.equal(await bonusOf(d, A), 10);
    assert.equal(((await d.prepare('SELECT COUNT(*) AS n FROM battery_bonus').first()) as { n: number }).n, 0, '1.0x stores nothing');
    const ledger = await staffLedger(d, A);
    assert.ok(ledger.some((e) => e.reason?.includes('公開欄位加碼')), 'changes are on the ledger');
  });

  test('a new month starts at the scaled allowance, and the Owner changing the policy keeps bonus members exact', async () => {
    const d = setup();
    await setBonus(d, A, 13, NOW);
    await adjustAllowance(d, { userId: A, delta: 1, reason: 'touch', actorUserId: STAFF }, NOW);
    await adjustAllowance(d, { userId: B, delta: 1, reason: 'touch', actorUserId: STAFF }, NOW);
    assert.equal((await getBalance(d, A, NOW)).allowance, 13 + 1);
    assert.equal((await getBalance(d, B, NOW)).allowance, 10 + 1);
    assert.equal(await setPolicy(d, { monthlyAllowance: 20, defaultTimeoutMs: 180_000, actorUserId: STAFF }, NOW), true);
    assert.equal((await getBalance(d, A, NOW)).allowance, scaled(20, 13) + 1, 'bonus member: 20 x 1.3 + the adjustment');
    assert.equal((await getBalance(d, B, NOW)).allowance, 20 + 1);
    const next = Date.UTC(2026, 11, 3, 4, 0, 0);
    assert.equal((await getBalance(d, A, next)).allowance, scaled(20, 13), 'next month: scaled, adjustment gone');
    assert.equal((await getBalances(d, [A, B], next)).get(B)?.allowance, 20);
  });

  test('a free Battery code gives the multiplied amount; a staff adjustment is exact', async () => {
    const d = setup();
    const batch = await createBatch(d, { kind: 'battery', appId: null, count: 2, units: 10, maxUsesPerCode: 1, expiresAt: null, note: '', actorUserId: STAFF }, NOW);
    assert.ok(batch);
    await setBonus(d, A, 15, NOW);
    const first = await redeemInvite(d, A, batch.codes[0]!, NOW);
    assert.deepEqual(first, { ok: true, kind: 'battery', appId: null, units: 15 }, '10 x 1.5');
    assert.equal((await getBalance(d, A, NOW)).allowance, 15 + 15);
    const plain = await redeemInvite(d, B, batch.codes[1]!, NOW);
    assert.deepEqual(plain, { ok: true, kind: 'battery', appId: null, units: 10 }, 'no bonus: unchanged');
    await adjustAllowance(d, { userId: A, delta: 7, reason: 'goodwill', actorUserId: STAFF }, NOW);
    assert.equal((await getBalance(d, A, NOW)).allowance, 15 + 15 + 7, 'staff adjustments are never multiplied');
  });

  test('syncBonus follows the profile and forgetting a member removes the row', async () => {
    const d = setup();
    assert.equal(await syncBonus(d, A, { visibility: vis(['phone', 'bio', 'website']), birthday: null }, NOW), 13);
    assert.equal(await bonusOf(d, A), 13);
    assert.equal(await syncBonus(d, A, { visibility: '{}', birthday: null }, NOW + 1), 10);
    assert.equal(await bonusOf(d, A), 10);
    await setBonus(d, B, 18, NOW);
    await forgetBatteryMembers(d, [B]);
    assert.equal(await bonusOf(d, B), 10);
  });
});
