import { constantTimeEqual, randomToken, sha256Hex, uuidv7 } from '../lib/crypto';
import { forgetInviteMembers } from './invites';
import { forgetQuantumMembers, getQuantum } from './quantum';

/**
 * Starry Battery (spec S-BAT-01..07): a free monthly AI usage allowance shared by every
 * Starry App. Nothing can buy, transfer or redeem it (S-BIL-06); only App backends spend it,
 * through reserve → commit / release (S-BAT-03); members can only read their own (S-BAT-04).
 *
 * Periods are calendar months in Taiwan time. An account resets the first time it is touched
 * in a new month, so there is no month-start batch job. Overspending is impossible because
 * battery_accounts has CHECK (used + reserved <= allowance): a reservation that does not fit
 * fails inside its D1 batch and nothing of that batch is applied.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
/** Ledger rows are kept one year (spec database notes); closed reservations 35 days. */
export const LEDGER_RETENTION_MS = 365 * DAY_MS;
export const RESERVATION_RETENTION_MS = 35 * DAY_MS;
/** Members see the last 30 days of activity (S-BAT-04). */
export const ACTIVITY_WINDOW_MS = 30 * DAY_MS;
export const MAX_ADJUSTMENT = 1_000_000;

/** Calendar month in Taiwan time, e.g. "2026-11". */
export function periodOf(now: number): string {
  const d = new Date(now + TAIPEI_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** When the allowance next resets: the 1st of next month, 00:00 Taiwan time. */
export function nextResetAt(now: number): number {
  const d = new Date(now + TAIPEI_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - TAIPEI_OFFSET_MS;
}

export interface BatteryPolicy {
  monthly_allowance: number;
  default_timeout_ms: number;
  updated_at: number;
  updated_by: string | null;
}

const FALLBACK_POLICY: BatteryPolicy = { monthly_allowance: 10, default_timeout_ms: 180_000, updated_at: 0, updated_by: null };

export async function getPolicy(db: D1Database): Promise<BatteryPolicy> {
  const row = await db.prepare('SELECT monthly_allowance, default_timeout_ms, updated_at, updated_by FROM battery_policy WHERE id = 1').first<BatteryPolicy>();
  return row ?? FALLBACK_POLICY;
}

/** Largest single reservation (Battery units); one number for every App (owner decision 2026-11-07). */
export const MAX_RESERVATION_UNITS = 100;
export const TASK_TYPE_ID = /^[a-z][a-z0-9-]{1,31}\.[a-z][a-z0-9_-]{1,31}$/;

export interface Balance {
  period: string;
  allowance: number;
  used: number;
  reserved: number;
  remaining: number;
  resets_at: number;
}

interface AccountRow {
  period: string;
  allowance: number;
  used: number;
  reserved: number;
}

function toBalance(row: AccountRow | null, policy: BatteryPolicy, now: number): Balance {
  const period = periodOf(now);
  // An account last touched in an earlier month has already reset, even if the row says otherwise.
  const current = row && row.period >= period ? row : { period, allowance: Math.max(policy.monthly_allowance, row?.reserved ?? 0), used: 0, reserved: row?.reserved ?? 0 };
  return {
    period,
    allowance: current.allowance,
    used: current.used,
    reserved: current.reserved,
    remaining: Math.max(0, current.allowance - current.used - current.reserved),
    resets_at: nextResetAt(now),
  };
}

/** The member's balance for the current month; reading never writes. */
export async function getBalance(db: D1Database, userId: string, now: number): Promise<Balance> {
  const [policy, row] = await Promise.all([
    getPolicy(db),
    db.prepare('SELECT period, allowance, used, reserved FROM battery_accounts WHERE user_id = ?').bind(userId).first<AccountRow>(),
  ]);
  return toBalance(row, policy, now);
}

/** Balances of several members at once (admin member list); ids are read in chunks to stay under D1's bound-parameter limit. */
export async function getBalances(db: D1Database, userIds: string[], now: number): Promise<Map<string, Balance>> {
  const policy = await getPolicy(db);
  const rows = new Map<string, AccountRow>();
  for (let i = 0; i < userIds.length; i += 50) {
    const chunk = userIds.slice(i, i + 50);
    const found = await db
      .prepare(`SELECT user_id, period, allowance, used, reserved FROM battery_accounts WHERE user_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<AccountRow & { user_id: string }>();
    for (const row of found.results) rows.set(row.user_id, row);
  }
  return new Map(userIds.map((id) => [id, toBalance(rows.get(id) ?? null, policy, now)]));
}

/** Creates the account, or resets it when its period is over: used back to 0, reservations in flight stay held. */
function ensureAccount(db: D1Database, userId: string, policy: BatteryPolicy, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO battery_accounts (user_id, period, allowance, used, reserved, updated_at) VALUES (?, ?, ?, 0, 0, ?)
       ON CONFLICT (user_id) DO UPDATE SET period = excluded.period, allowance = MAX(excluded.allowance, reserved), used = 0, updated_at = excluded.updated_at
       WHERE battery_accounts.period < excluded.period`,
    )
    .bind(userId, periodOf(now), policy.monthly_allowance, now);
}

export interface Reservation {
  reservation_id: string;
  user_id: string;
  app_id: string;
  task_type: string;
  units: number;
  amount: number;
  status: 'reserved' | 'committed' | 'released' | 'expired';
  charged: number | null;
  period: string;
  created_at: number;
  expires_at: number;
  finished_at: number | null;
  op_id: string | null;
  /** Part of `amount` held in the App's Quantum Battery; the rest (amount - quantum_amount) is the free monthly Battery. */
  quantum_amount: number;
  /** Part of `charged` taken from Quantum Battery; set when the reservation is committed. */
  quantum_charged: number | null;
}

const RESERVATION_COLUMNS = 'reservation_id, user_id, app_id, task_type, units, amount, status, charged, period, created_at, expires_at, finished_at, op_id, quantum_amount, quantum_charged';

async function reservationById(db: D1Database, id: string): Promise<Reservation | null> {
  return db.prepare(`SELECT ${RESERVATION_COLUMNS} FROM battery_reservations WHERE reservation_id = ?`).bind(id).first<Reservation>();
}

async function reservationByKey(db: D1Database, appId: string, key: string): Promise<Reservation | null> {
  return db.prepare(`SELECT ${RESERVATION_COLUMNS} FROM battery_reservations WHERE app_id = ? AND idempotency_key = ?`).bind(appId, key).first<Reservation>();
}

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export type ReserveResult =
  | { ok: true; reservation: Reservation; replayed: boolean }
  | { ok: false; reason: 'invalid_task' | 'invalid_units' | 'idempotency_conflict' }
  | { ok: false; reason: 'insufficient'; balance: Balance }
  | { ok: false; reason: 'app_cap' };

/** This month's Battery held or spent by one App (all members); the base of its optional monthly ceiling. */
export async function appMonthUsage(db: D1Database, appId: string, now: number): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(COALESCE(charged, amount)), 0) AS n FROM battery_reservations WHERE app_id = ? AND period = ? AND status IN ('reserved', 'committed')")
    .bind(appId, periodOf(now))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getAppCap(db: D1Database, appId: string): Promise<number | null> {
  const row = await db.prepare('SELECT monthly_cap FROM battery_app_limits WHERE app_id = ?').bind(appId).first<{ monthly_cap: number }>();
  return row?.monthly_cap ?? null;
}

/** Owner sets (or clears with null) the monthly ceiling of one App. */
export async function setAppCap(db: D1Database, appId: string, cap: number | null, actorUserId: string, now: number): Promise<boolean> {
  if (cap === null) {
    await db.prepare('DELETE FROM battery_app_limits WHERE app_id = ?').bind(appId).run();
    return true;
  }
  if (!Number.isInteger(cap) || cap < 1 || cap > 1_000_000_000) return false;
  await db
    .prepare('INSERT INTO battery_app_limits (app_id, monthly_cap, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (app_id) DO UPDATE SET monthly_cap = excluded.monthly_cap, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .bind(appId, cap, now, actorUserId)
    .run();
  return true;
}

/**
 * S-BAT-03 reserve. A retry with the same idempotency key returns the original reservation;
 * the same key with different content is a conflict.
 */
export async function reserve(
  db: D1Database,
  input: { userId: string; appId: string; taskType: string; taskLabel?: string | null; units: number; idempotencyKey: string },
  now: number,
): Promise<ReserveResult> {
  const replay = async (): Promise<ReserveResult | null> => {
    const existing = await reservationByKey(db, input.appId, input.idempotencyKey);
    if (!existing) return null;
    const same = existing.user_id === input.userId && existing.task_type === input.taskType && existing.units === input.units;
    return same ? { ok: true, reservation: existing, replayed: true } : { ok: false, reason: 'idempotency_conflict' };
  };
  const earlier = await replay();
  if (earlier) return earlier;
  if (!TASK_TYPE_ID.test(input.taskType) || !input.taskType.startsWith(`${input.appId}.`)) return { ok: false, reason: 'invalid_task' };
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > MAX_RESERVATION_UNITS) return { ok: false, reason: 'invalid_units' };
  // Soft ceiling: protects against a runaway App; concurrent requests may overshoot it by a few tasks.
  const cap = await getAppCap(db, input.appId);
  if (cap !== null && (await appMonthUsage(db, input.appId, now)) + input.units > cap) return { ok: false, reason: 'app_cap' };
  const policy = await getPolicy(db);
  const amount = input.units;
  const label = input.taskLabel?.trim() ? input.taskLabel.trim().slice(0, 40) : null;
  let lastError: unknown = null;
  // The balances are read first and the batch is guarded by the accounts' CHECK constraints; when a concurrent
  // request used the same Battery in between, the batch fails whole and the split is worked out again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [balance, quantum] = await Promise.all([getBalance(db, input.userId, now), getQuantum(db, input.userId, input.appId)]);
    // Free monthly Battery is spent first; only the rest comes from this App's Quantum Battery.
    const fromFree = Math.min(amount, balance.remaining);
    const fromQuantum = amount - fromFree;
    if (fromQuantum > quantum.available) return { ok: false, reason: 'insufficient', balance };
    const reservation: Reservation = {
      reservation_id: uuidv7(now),
      user_id: input.userId,
      app_id: input.appId,
      task_type: input.taskType,
      units: input.units,
      amount,
      status: 'reserved',
      charged: null,
      period: periodOf(now),
      created_at: now,
      expires_at: now + policy.default_timeout_ms,
      finished_at: null,
      op_id: null,
      quantum_amount: fromQuantum,
      quantum_charged: null,
    };
    const statements = [
      ensureAccount(db, input.userId, policy, now),
      db
        .prepare(
          `INSERT INTO battery_reservations (reservation_id, user_id, app_id, task_type, task_label, idempotency_key, units, amount, quantum_amount, status, period, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`,
        )
        .bind(reservation.reservation_id, input.userId, input.appId, input.taskType, label, input.idempotencyKey, input.units, amount, fromQuantum, reservation.period, now, reservation.expires_at),
      db.prepare('UPDATE battery_accounts SET reserved = reserved + ?, updated_at = ? WHERE user_id = ?').bind(fromFree, now, input.userId),
    ];
    if (fromQuantum > 0) {
      statements.push(db.prepare('UPDATE quantum_accounts SET reserved = reserved + ?, updated_at = ? WHERE user_id = ? AND app_id = ?').bind(fromQuantum, now, input.userId, input.appId));
    }
    try {
      await db.batch(statements);
      return { ok: true, reservation, replayed: false };
    } catch (error) {
      // A concurrent retry with the same key won the race, or the reservation no longer fits.
      const raced = await replay();
      if (raced) return raced;
      lastError = error;
    }
  }
  throw lastError;
}

/** Closes one open reservation; op_id makes sure only the request that closed it moves the balance. */
function closeStatements(db: D1Database, r: Reservation, status: 'committed' | 'released' | 'expired', charge: { total: number; quantum: number }, opId: string, now: number): D1PreparedStatement[] {
  const guard = status === 'committed' ? 'AND expires_at > ?' : status === 'expired' ? 'AND expires_at <= ?' : 'AND ? = ?';
  const guardArgs = status === 'released' ? [0, 0] : [now];
  const committed = status === 'committed';
  const freeHeld = r.amount - r.quantum_amount;
  const freeCharged = charge.total - charge.quantum;
  const statements = [
    db
      .prepare(`UPDATE battery_reservations SET status = ?, charged = ?, quantum_charged = ?, finished_at = ?, op_id = ? WHERE reservation_id = ? AND status = 'reserved' ${guard}`)
      .bind(status, committed ? charge.total : null, committed ? charge.quantum : null, now, opId, r.reservation_id, ...guardArgs),
    db
      .prepare(
        `UPDATE battery_accounts SET reserved = reserved - ?, used = used + ?, updated_at = ?
         WHERE user_id = ? AND EXISTS (SELECT 1 FROM battery_reservations WHERE reservation_id = ? AND op_id = ?)`,
      )
      .bind(freeHeld, committed ? freeCharged : 0, now, r.user_id, r.reservation_id, opId),
  ];
  if (r.quantum_amount > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE quantum_accounts SET reserved = reserved - ?, balance = balance - ?, updated_at = ?
           WHERE user_id = ? AND app_id = ? AND EXISTS (SELECT 1 FROM battery_reservations WHERE reservation_id = ? AND op_id = ?)`,
        )
        .bind(r.quantum_amount, committed ? charge.quantum : 0, now, r.user_id, r.app_id, r.reservation_id, opId),
    );
  }
  if (committed && freeCharged > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO battery_ledger (entry_id, user_id, period, kind, amount, app_id, task_type, task_label, reservation_id, created_at)
           SELECT ?, user_id, period, 'usage', ?, app_id, task_type, task_label, reservation_id, ? FROM battery_reservations WHERE reservation_id = ? AND op_id = ?`,
        )
        .bind(uuidv7(now), freeCharged, now, r.reservation_id, opId),
    );
  }
  if (committed && charge.quantum > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO quantum_ledger (entry_id, user_id, app_id, kind, amount, ref, task_label, created_at)
           SELECT ?, user_id, app_id, 'usage', ?, reservation_id, task_label, ? FROM battery_reservations WHERE reservation_id = ? AND op_id = ?`,
        )
        .bind(uuidv7(now + 1), -charge.quantum, now, r.reservation_id, opId),
    );
  }
  return statements;
}

export type FinishResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: 'not_found' | 'invalid_units' | 'expired' | 'closed'; reservation?: Reservation };

/**
 * S-BAT-03 commit (success) or release (failure or cancel). Both are idempotent. A commit that
 * arrives after the timeout charges nothing: the reservation is released as expired.
 * `units` on commit is the actual usage (0..reserved units); the default is everything reserved.
 */
export async function finish(
  db: D1Database,
  input: { reservationId: string; appId: string; action: 'commit' | 'release'; units?: number },
  now: number,
): Promise<FinishResult> {
  let r = await reservationById(db, input.reservationId);
  if (!r || r.app_id !== input.appId) return { ok: false, reason: 'not_found' };
  if (input.action === 'commit' && input.units !== undefined && (!Number.isInteger(input.units) || input.units < 0 || input.units > r.units)) {
    return { ok: false, reason: 'invalid_units' };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (r.status === 'reserved' && r.expires_at <= now) {
      await db.batch(closeStatements(db, r, 'expired', { total: 0, quantum: 0 }, randomToken(12), now));
      r = (await reservationById(db, r.reservation_id)) ?? r;
    }
    if (r.status !== 'reserved') {
      if (input.action === 'commit') return r.status === 'committed' ? { ok: true, reservation: r } : { ok: false, reason: r.status === 'expired' ? 'expired' : 'closed', reservation: r };
      return r.status === 'committed' ? { ok: false, reason: 'closed', reservation: r } : { ok: true, reservation: r };
    }
    const opId = randomToken(12);
    // One unit costs one Battery. The free monthly part is charged first, Quantum Battery only for the rest.
    const total = input.action === 'commit' ? (input.units ?? r.units) : 0;
    const quantum = Math.max(0, total - (r.amount - r.quantum_amount));
    await db.batch(closeStatements(db, r, input.action === 'commit' ? 'committed' : 'released', { total, quantum }, opId, now));
    const after = await reservationById(db, r.reservation_id);
    if (!after) return { ok: false, reason: 'not_found' };
    if (after.op_id === opId) return { ok: true, reservation: after };
    r = after; // another request closed it first; answer from its outcome
  }
  return { ok: false, reason: 'closed', reservation: r };
}

/** Every minute (S-BAT-03): releases reservations whose timeout passed. Results arriving later charge nothing. */
export async function releaseExpired(db: D1Database, now: number): Promise<number> {
  const [, , expired] = await db.batch([
    db
      .prepare(
        `UPDATE quantum_accounts SET updated_at = ?, reserved = reserved - (
           SELECT COALESCE(SUM(r.quantum_amount), 0) FROM battery_reservations r
           WHERE r.user_id = quantum_accounts.user_id AND r.app_id = quantum_accounts.app_id AND r.status = 'reserved' AND r.expires_at <= ?)
         WHERE EXISTS (SELECT 1 FROM battery_reservations r WHERE r.user_id = quantum_accounts.user_id AND r.app_id = quantum_accounts.app_id AND r.status = 'reserved' AND r.expires_at <= ? AND r.quantum_amount > 0)`,
      )
      .bind(now, now, now),
    db
      .prepare(
        `UPDATE battery_accounts SET updated_at = ?, reserved = reserved - (
           SELECT COALESCE(SUM(r.amount - r.quantum_amount), 0) FROM battery_reservations r WHERE r.user_id = battery_accounts.user_id AND r.status = 'reserved' AND r.expires_at <= ?)
         WHERE user_id IN (SELECT user_id FROM battery_reservations WHERE status = 'reserved' AND expires_at <= ?)`,
      )
      .bind(now, now, now),
    db.prepare("UPDATE battery_reservations SET status = 'expired', finished_at = ? WHERE status = 'reserved' AND expires_at <= ?").bind(now, now),
  ]);
  return expired?.meta.changes ?? 0;
}

export type AdjustResult = { ok: true; balance: Balance } | { ok: false; reason: 'invalid' | 'too_low'; balance?: Balance };

/** S-BAT-05: Owner/Admin change one member's allowance for the current month; a reason is required. */
export async function adjustAllowance(
  db: D1Database,
  input: { userId: string; delta: number; reason: string; actorUserId: string },
  now: number,
): Promise<AdjustResult> {
  const reason = input.reason.trim();
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > MAX_ADJUSTMENT || reason.length < 1 || reason.length > 200) {
    return { ok: false, reason: 'invalid' };
  }
  const policy = await getPolicy(db);
  try {
    await db.batch([
      ensureAccount(db, input.userId, policy, now),
      db.prepare('UPDATE battery_accounts SET allowance = allowance + ?, updated_at = ? WHERE user_id = ?').bind(input.delta, now, input.userId),
      db
        .prepare(
          `INSERT INTO battery_ledger (entry_id, user_id, period, kind, amount, reason, actor_user_id, created_at)
           VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?)`,
        )
        .bind(uuidv7(now), input.userId, periodOf(now), input.delta, reason, input.actorUserId, now),
    ]);
  } catch (error) {
    const balance = await getBalance(db, input.userId, now);
    if (balance.allowance + input.delta < balance.used + balance.reserved) return { ok: false, reason: 'too_low', balance };
    throw error;
  }
  return { ok: true, balance: await getBalance(db, input.userId, now) };
}

/**
 * S-BAT-02: the Owner changes the monthly allowance. The change also applies to this month
 * for every member (never below what they already used or hold), not only from next month.
 */
export async function setPolicy(
  db: D1Database,
  input: { monthlyAllowance: number; defaultTimeoutMs: number; actorUserId: string },
  now: number,
): Promise<boolean> {
  const { monthlyAllowance: allowance, defaultTimeoutMs: timeout } = input;
  if (!Number.isInteger(allowance) || allowance < 0 || allowance > 1_000_000) return false;
  if (!Number.isInteger(timeout) || timeout < 10_000 || timeout > 3_600_000) return false;
  const current = await getPolicy(db);
  const delta = allowance - current.monthly_allowance;
  await db.batch([
    db
      .prepare(
        `INSERT INTO battery_policy (id, monthly_allowance, default_timeout_ms, updated_at, updated_by) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET monthly_allowance = excluded.monthly_allowance, default_timeout_ms = excluded.default_timeout_ms,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(allowance, timeout, now, input.actorUserId),
    db
      .prepare('UPDATE battery_accounts SET allowance = MAX(used + reserved, allowance + ?), updated_at = ? WHERE period = ? AND ? <> 0')
      .bind(delta, now, periodOf(now), delta),
  ]);
  return true;
}

export interface ActivityEntry {
  entry_id: string;
  kind: 'usage' | 'adjustment';
  amount: number;
  app_id: string | null;
  task_type: string | null;
  task_label: string | null;
  created_at: number;
}

/** S-BAT-04: the member's own usage and adjustments in the last 30 days, newest first, cursor-paged. Reasons stay internal. */
export async function recentActivity(
  db: D1Database,
  userId: string,
  now: number,
  options: { cursor?: string; limit?: number } = {},
): Promise<{ entries: ActivityEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = await db
    .prepare(
      `SELECT l.entry_id, l.kind, l.amount, l.app_id, l.task_type, l.task_label, l.created_at
       FROM battery_ledger l
       WHERE l.user_id = ? AND l.created_at >= ? AND (? IS NULL OR l.entry_id < ?)
       ORDER BY l.entry_id DESC LIMIT ?`,
    )
    .bind(userId, now - ACTIVITY_WINDOW_MS, options.cursor ?? null, options.cursor ?? null, limit + 1)
    .all<ActivityEntry>();
  const entries = rows.results.slice(0, limit);
  return { entries, nextCursor: rows.results.length > limit ? (entries[entries.length - 1]?.entry_id ?? null) : null };
}

export interface StaffLedgerEntry extends ActivityEntry {
  reason: string | null;
  actor_user_id: string | null;
}

/** Admin Lite: the member's latest ledger rows with adjustment reasons (staff only). */
export async function staffLedger(db: D1Database, userId: string, limit = 20): Promise<StaffLedgerEntry[]> {
  const rows = await db
    .prepare(
      `SELECT l.entry_id, l.kind, l.amount, l.app_id, l.task_type, l.task_label, l.created_at, l.reason, l.actor_user_id
       FROM battery_ledger l
       WHERE l.user_id = ? ORDER BY l.entry_id DESC LIMIT ?`,
    )
    .bind(userId, Math.min(Math.max(limit, 1), 100))
    .all<StaffLedgerEntry>();
  return rows.results;
}

/** Account purge (S-ID-06): every Battery row of the member goes. */
export async function forgetBatteryMembers(db: D1Database, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await db.batch([
      db.prepare('DELETE FROM battery_ledger WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM battery_reservations WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM battery_accounts WHERE user_id = ?').bind(userId),
    ]);
  }
  await forgetQuantumMembers(db, userIds);
  await forgetInviteMembers(db, userIds);
}

/** Daily: ledger kept one year, closed reservations 35 days. */
export async function batteryRetention(db: D1Database, now: number): Promise<{ ledger: number; reservations: number }> {
  const [ledger, reservations] = await db.batch([
    db.prepare('DELETE FROM battery_ledger WHERE created_at < ?').bind(now - LEDGER_RETENTION_MS),
    db.prepare("DELETE FROM battery_reservations WHERE status <> 'reserved' AND finished_at < ?").bind(now - RESERVATION_RETENTION_MS),
  ]);
  return { ledger: ledger?.meta.changes ?? 0, reservations: reservations?.meta.changes ?? 0 };
}

/**
 * Admin Lite turns Battery on for an App: creates (or rotates) the service key for the App backend. Only the key's
 * SHA-256 is stored, so the returned key is the only time it is visible. The App decides what its tasks cost.
 */
export async function enableAppBattery(db: D1Database, appId: string, actorUserId: string, now: number): Promise<{ serviceKey: string }> {
  const serviceKey = `sbk_${randomToken(32)}`;
  const keyHash = await sha256Hex(serviceKey);
  await db
    .prepare(
      `INSERT INTO battery_app_keys (app_id, key_hash, created_at, created_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (app_id) DO UPDATE SET key_hash = excluded.key_hash, rotated_at = ?, rotated_by = ?`,
    )
    .bind(appId, keyHash, now, actorUserId, now, actorUserId)
    .run();
  return { serviceKey };
}

export async function hasAppBatteryKey(db: D1Database, appId: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS found FROM battery_app_keys WHERE app_id = ?').bind(appId).first()) !== null;
}

/** The App whose key was created in Admin Lite, or null. Keys are 43+ random characters, so a hash lookup is enough. */
export async function appForStoredKey(db: D1Database, presented: string | undefined): Promise<string | null> {
  if (!presented || presented.length < 32 || presented.length > 200) return null;
  const row = await db.prepare('SELECT app_id FROM battery_app_keys WHERE key_hash = ?').bind(await sha256Hex(presented)).first<{ app_id: string }>();
  return row?.app_id ?? null;
}

export async function anyStoredKeys(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS found FROM battery_app_keys LIMIT 1').first()) !== null;
}

/** The App whose backend presented this service key (BATTERY_SERVICE_KEYS secret), or null. */
export function appForServiceKey(keys: Record<string, string>, presented: string | undefined): string | null {
  if (!presented || presented.length < 32) return null;
  let match: string | null = null;
  for (const [appId, key] of Object.entries(keys)) {
    if (key.length >= 32 && constantTimeEqual(key, presented)) match = appId;
  }
  return match;
}
