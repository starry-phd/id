// Unit tests for Starry Battery (S-BAT-01..07): monthly periods, reserve/commit/release, timeouts,
// idempotency, manual adjustments, policy changes, retention and account purge.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  adjustAllowance, appForServiceKey, batteryRetention, finish, forgetBatteryMembers, getBalance, getPolicy, LEDGER_RETENTION_MS,
  nextResetAt, periodOf, recentActivity, releaseExpired, reserve, setPolicy, staffLedger, upsertTaskType,
} from '../../src/battery/battery';
import { migratedDb } from '../support/sqlite-d1.mjs';

// 2026-11-15 12:00 Taiwan time.
const NOW = Date.UTC(2026, 10, 15, 4, 0, 0);
const USER = '01900000-0000-7000-8000-000000000001';
const OTHER = '01900000-0000-7000-8000-000000000002';
type Db = ReturnType<typeof migratedDb>;
const asD1 = (db: Db) => db as unknown as D1Database;

async function setup() {
  const db = migratedDb('migrations/battery');
  const d = asD1(db);
  assert.ok(await upsertTaskType(d, { taskType: 'echo.transcribe', appId: 'echo', label: '語音轉文字', unitCost: 2, maxUnits: 30, timeoutMs: null, enabled: true }, 'owner', NOW));
  return { db, d };
}

const key = (n: number) => `idem-key-${n.toString().padStart(4, '0')}`;
const count = async (db: Db, sql: string, ...args: unknown[]) => Number(((await db.prepare(sql).bind(...args).first()) as { n: number } | null)?.n ?? 0);

describe('periods', () => {
  test('months follow Taiwan time and reset on the 1st at 00:00 Taiwan time', () => {
    assert.equal(periodOf(NOW), '2026-11');
    assert.equal(periodOf(Date.UTC(2026, 10, 30, 15, 59, 59)), '2026-11', '23:59:59 on Nov 30 in Taiwan');
    assert.equal(periodOf(Date.UTC(2026, 10, 30, 16, 0, 0)), '2026-12', '00:00 on Dec 1 in Taiwan');
    assert.equal(nextResetAt(NOW), Date.UTC(2026, 10, 30, 16, 0, 0));
    assert.equal(nextResetAt(Date.UTC(2026, 11, 20)), Date.UTC(2026, 11, 31, 16, 0, 0), 'December rolls into next year');
  });
});

describe('reserve, commit and release (S-BAT-03)', () => {
  test('a new member starts with the monthly allowance; reading never creates rows', async () => {
    const { db, d } = await setup();
    assert.deepEqual(await getBalance(d, USER, NOW), { period: '2026-11', allowance: 100, used: 0, reserved: 0, remaining: 100, resets_at: nextResetAt(NOW) });
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM battery_accounts'), 0);
  });

  test('reserve holds unit_cost x units; commit charges and writes the ledger; replays change nothing', async () => {
    const { db, d } = await setup();
    const r = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 10, idempotencyKey: key(1) }, NOW);
    assert.ok(r.ok);
    assert.equal(r.reservation.amount, 20);
    assert.equal(r.reservation.expires_at, NOW + 180_000, 'default timeout is 3 minutes');
    assert.deepEqual(await getBalance(d, USER, NOW), { period: '2026-11', allowance: 100, used: 0, reserved: 20, remaining: 80, resets_at: nextResetAt(NOW) });

    const again = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 10, idempotencyKey: key(1) }, NOW + 1);
    assert.ok(again.ok && again.replayed && again.reservation.reservation_id === r.reservation.reservation_id);
    assert.equal((await getBalance(d, USER, NOW)).reserved, 20, 'a retried reserve holds nothing more');
    assert.deepEqual(await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 3, idempotencyKey: key(1) }, NOW), { ok: false, reason: 'idempotency_conflict' });

    const done = await finish(d, { reservationId: r.reservation.reservation_id, appId: 'echo', action: 'commit', units: 7 }, NOW + 1000);
    assert.ok(done.ok);
    assert.equal(done.reservation.charged, 14, 'actual usage below the estimate is charged, the rest returns');
    assert.deepEqual(await getBalance(d, USER, NOW + 1000), { period: '2026-11', allowance: 100, used: 14, reserved: 0, remaining: 86, resets_at: nextResetAt(NOW) });
    const replay = await finish(d, { reservationId: r.reservation.reservation_id, appId: 'echo', action: 'commit' }, NOW + 2000);
    assert.ok(replay.ok);
    assert.equal((await getBalance(d, USER, NOW)).used, 14, 'a replayed commit never charges twice');
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM battery_ledger WHERE kind = 'usage'"), 1);
    assert.deepEqual(
      (await finish(d, { reservationId: r.reservation.reservation_id, appId: 'echo', action: 'release' }, NOW + 3000)).ok,
      false,
      'a committed reservation cannot be released',
    );
  });

  test('release returns everything and is idempotent; other Apps cannot touch the reservation', async () => {
    const { d } = await setup();
    const r = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 5, idempotencyKey: key(2) }, NOW);
    assert.ok(r.ok);
    assert.deepEqual(await finish(d, { reservationId: r.reservation.reservation_id, appId: 'other', action: 'release' }, NOW), { ok: false, reason: 'not_found' });
    const released = await finish(d, { reservationId: r.reservation.reservation_id, appId: 'echo', action: 'release' }, NOW + 10);
    assert.ok(released.ok && released.reservation.status === 'released');
    assert.ok((await finish(d, { reservationId: r.reservation.reservation_id, appId: 'echo', action: 'release' }, NOW + 20)).ok);
    const commit = await finish(d, { reservationId: r.reservation.reservation_id, appId: 'echo', action: 'commit' }, NOW + 30);
    assert.equal(commit.ok ? 'ok' : commit.reason, 'closed');
    assert.deepEqual(await getBalance(d, USER, NOW), { period: '2026-11', allowance: 100, used: 0, reserved: 0, remaining: 100, resets_at: nextResetAt(NOW) });
  });

  test('reservations never exceed the allowance', async () => {
    const { d } = await setup();
    const first = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 20, idempotencyKey: key(3) }, NOW);
    const second = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 20, idempotencyKey: key(4) }, NOW);
    assert.ok(first.ok && second.ok);
    const third = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 15, idempotencyKey: key(5) }, NOW);
    assert.equal(third.ok ? 'ok' : third.reason, 'insufficient');
    assert.equal(!third.ok && third.reason === 'insufficient' ? third.balance.remaining : -1, 20);
    assert.ok((await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 10, idempotencyKey: key(6) }, NOW)).ok, 'exactly the remainder fits');
    assert.equal((await getBalance(d, USER, NOW)).remaining, 0);
    assert.equal((await getBalance(d, OTHER, NOW)).remaining, 100, 'members have separate allowances');
  });

  test('unknown, disabled or foreign task types and too many units are refused', async () => {
    const { d } = await setup();
    const base = { userId: USER, appId: 'echo', idempotencyKey: key(7) };
    assert.deepEqual(await reserve(d, { ...base, taskType: 'echo.nope', units: 1 }, NOW), { ok: false, reason: 'unknown_task' });
    assert.deepEqual(await reserve(d, { ...base, appId: 'other', taskType: 'echo.transcribe', units: 1 }, NOW), { ok: false, reason: 'unknown_task' });
    assert.deepEqual(await reserve(d, { ...base, taskType: 'echo.transcribe', units: 31 }, NOW), { ok: false, reason: 'invalid_units' });
    await upsertTaskType(d, { taskType: 'echo.transcribe', appId: 'echo', label: '語音轉文字', unitCost: 2, maxUnits: 30, timeoutMs: null, enabled: false }, 'owner', NOW);
    assert.deepEqual(await reserve(d, { ...base, taskType: 'echo.transcribe', units: 1 }, NOW), { ok: false, reason: 'unknown_task' });
    assert.equal(await upsertTaskType(d, { taskType: 'other.transcribe', appId: 'echo', label: 'x', unitCost: 1, maxUnits: 1, timeoutMs: null, enabled: true }, 'owner', NOW), false, 'task codes start with their App');
  });

  test('timed-out reservations are released every minute and late commits charge nothing', async () => {
    const { d } = await setup();
    const late = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 10, idempotencyKey: key(8) }, NOW);
    const swept = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 5, idempotencyKey: key(9) }, NOW);
    assert.ok(late.ok && swept.ok);
    const after = NOW + 180_000;
    const commit = await finish(d, { reservationId: late.reservation.reservation_id, appId: 'echo', action: 'commit' }, after);
    assert.equal(commit.ok ? 'ok' : commit.reason, 'expired');
    assert.equal(await releaseExpired(d, after), 1);
    assert.equal(await releaseExpired(d, after + 60_000), 0);
    assert.deepEqual(await getBalance(d, USER, after), { period: '2026-11', allowance: 100, used: 0, reserved: 0, remaining: 100, resets_at: nextResetAt(NOW) });
    const release = await finish(d, { reservationId: swept.reservation.reservation_id, appId: 'echo', action: 'release' }, after);
    assert.ok(release.ok && release.reservation.status === 'expired');
  });

  test('a new month resets usage; reservations in flight stay held', async () => {
    const { d } = await setup();
    const used = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 30, idempotencyKey: key(10) }, NOW);
    assert.ok(used.ok);
    await finish(d, { reservationId: used.reservation.reservation_id, appId: 'echo', action: 'commit' }, NOW);
    const december = Date.UTC(2026, 10, 30, 15, 59, 0);
    const held = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 5, idempotencyKey: key(11) }, december);
    assert.ok(held.ok);
    const nextMonth = Date.UTC(2026, 10, 30, 16, 0, 30);
    assert.deepEqual(await getBalance(d, USER, nextMonth), { period: '2026-12', allowance: 100, used: 0, reserved: 10, remaining: 90, resets_at: nextResetAt(nextMonth) });
    assert.ok((await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 1, idempotencyKey: key(12) }, nextMonth)).ok);
    const done = await finish(d, { reservationId: held.reservation.reservation_id, appId: 'echo', action: 'commit' }, nextMonth + 1000);
    assert.ok(done.ok);
    assert.deepEqual(await getBalance(d, USER, nextMonth + 1000), { period: '2026-12', allowance: 100, used: 10, reserved: 2, remaining: 88, resets_at: nextResetAt(nextMonth) });
  });
});

describe('adjustments and policy (S-BAT-02, S-BAT-05)', () => {
  test('staff adjust this month with a reason; never below what is used or held', async () => {
    const { db, d } = await setup();
    const r = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 30, idempotencyKey: key(20) }, NOW);
    assert.ok(r.ok);
    assert.deepEqual(await adjustAllowance(d, { userId: USER, delta: 50, reason: '', actorUserId: 'admin' }, NOW), { ok: false, reason: 'invalid' });
    assert.deepEqual(await adjustAllowance(d, { userId: USER, delta: 0, reason: 'x', actorUserId: 'admin' }, NOW), { ok: false, reason: 'invalid' });
    const up = await adjustAllowance(d, { userId: USER, delta: 50, reason: '補償服務中斷', actorUserId: 'admin' }, NOW);
    assert.ok(up.ok && up.balance.allowance === 150 && up.balance.remaining === 90);
    const down = await adjustAllowance(d, { userId: USER, delta: -100, reason: '誤植', actorUserId: 'admin' }, NOW);
    assert.equal(down.ok ? 'ok' : down.reason, 'too_low');
    assert.equal((await getBalance(d, USER, NOW)).allowance, 150, 'a refused adjustment changes nothing');
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM battery_ledger WHERE kind = 'adjustment'"), 1);
    const ledger = await staffLedger(d, USER);
    assert.equal(ledger[0]?.reason, '補償服務中斷');
    const member = await recentActivity(d, USER, NOW);
    assert.deepEqual(Object.keys(member.entries[0] ?? {}).includes('reason'), false, 'members never see staff reasons');
    const next = Date.UTC(2026, 11, 2);
    assert.equal((await getBalance(d, USER, next)).allowance, 100, 'adjustments last for the month they were made');
  });

  test('a new monthly allowance applies to this month too, clamped to what is used', async () => {
    const { d } = await setup();
    const r = await reserve(d, { userId: USER, appId: 'echo', taskType: 'echo.transcribe', units: 30, idempotencyKey: key(30) }, NOW);
    assert.ok(r.ok);
    await reserve(d, { userId: OTHER, appId: 'echo', taskType: 'echo.transcribe', units: 1, idempotencyKey: key(31) }, NOW);
    assert.equal(await setPolicy(d, { monthlyAllowance: -1, defaultTimeoutMs: 180_000, actorUserId: 'owner' }, NOW), false);
    assert.ok(await setPolicy(d, { monthlyAllowance: 40, defaultTimeoutMs: 60_000, actorUserId: 'owner' }, NOW));
    assert.equal((await getPolicy(d)).monthly_allowance, 40);
    assert.equal((await getBalance(d, USER, NOW)).allowance, 60, 'cut by 60 but never below the 60 already held');
    assert.equal((await getBalance(d, OTHER, NOW)).allowance, 40);
    assert.equal((await getBalance(d, '01900000-0000-7000-8000-000000000003', NOW)).allowance, 40, 'new members get the new allowance');
    const quick = await reserve(d, { userId: OTHER, appId: 'echo', taskType: 'echo.transcribe', units: 1, idempotencyKey: key(32) }, NOW);
    assert.ok(quick.ok && quick.reservation.expires_at === NOW + 60_000, 'the new default timeout applies');
  });
});

describe('ledger, retention and purge', () => {
  test('ledger rows cannot be changed', async () => {
    const { db, d } = await setup();
    await adjustAllowance(d, { userId: USER, delta: 5, reason: '測試', actorUserId: 'admin' }, NOW);
    assert.throws(() => db.sqlite.exec('UPDATE battery_ledger SET amount = 500'), /append-only/);
  });

  test('retention keeps one year of ledger; purge removes every row of the member', async () => {
    const { db, d } = await setup();
    await adjustAllowance(d, { userId: USER, delta: 5, reason: '舊', actorUserId: 'admin' }, NOW - LEDGER_RETENTION_MS - 1);
    await adjustAllowance(d, { userId: USER, delta: 5, reason: '新', actorUserId: 'admin' }, NOW);
    const r = await reserve(d, { userId: OTHER, appId: 'echo', taskType: 'echo.transcribe', units: 1, idempotencyKey: key(40) }, NOW - 40 * 86_400_000);
    assert.ok(r.ok);
    await finish(d, { reservationId: r.reservation.reservation_id, appId: 'echo', action: 'release' }, NOW - 40 * 86_400_000);
    assert.deepEqual(await batteryRetention(d, NOW), { ledger: 1, reservations: 1 });
    await forgetBatteryMembers(d, [USER, OTHER]);
    for (const table of ['battery_ledger', 'battery_reservations', 'battery_accounts']) {
      assert.equal(await count(db, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
    }
  });
});

describe('service keys (S-BAT-06)', () => {
  test('only a full-length key of a configured App matches', () => {
    const keys = { echo: 'e'.repeat(40), other: 'o'.repeat(40), weak: 'short' };
    assert.equal(appForServiceKey(keys, 'e'.repeat(40)), 'echo');
    assert.equal(appForServiceKey(keys, 'o'.repeat(40)), 'other');
    assert.equal(appForServiceKey(keys, 'short'), null);
    assert.equal(appForServiceKey(keys, undefined), null);
    assert.equal(appForServiceKey(keys, 'x'.repeat(40)), null);
  });
});
