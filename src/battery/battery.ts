import { constantTimeEqual, randomToken, uuidv7 } from '../lib/crypto';

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

export interface TaskType {
  task_type: string;
  app_id: string;
  label: string;
  unit_cost: number;
  max_units: number;
  timeout_ms: number | null;
  enabled: number;
  updated_at: number;
}

const TASK_COLUMNS = 'task_type, app_id, label, unit_cost, max_units, timeout_ms, enabled, updated_at';
export const TASK_TYPE_ID = /^[a-z][a-z0-9-]{1,31}\.[a-z][a-z0-9_-]{1,31}$/;

export async function listTaskTypes(db: D1Database): Promise<TaskType[]> {
  return (await db.prepare(`SELECT ${TASK_COLUMNS} FROM battery_task_types ORDER BY app_id, task_type`).all<TaskType>()).results;
}

export async function getTaskType(db: D1Database, taskType: string): Promise<TaskType | null> {
  return db.prepare(`SELECT ${TASK_COLUMNS} FROM battery_task_types WHERE task_type = ?`).bind(taskType).first<TaskType>();
}

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
}

const RESERVATION_COLUMNS = 'reservation_id, user_id, app_id, task_type, units, amount, status, charged, period, created_at, expires_at, finished_at, op_id';

async function reservationById(db: D1Database, id: string): Promise<Reservation | null> {
  return db.prepare(`SELECT ${RESERVATION_COLUMNS} FROM battery_reservations WHERE reservation_id = ?`).bind(id).first<Reservation>();
}

async function reservationByKey(db: D1Database, appId: string, key: string): Promise<Reservation | null> {
  return db.prepare(`SELECT ${RESERVATION_COLUMNS} FROM battery_reservations WHERE app_id = ? AND idempotency_key = ?`).bind(appId, key).first<Reservation>();
}

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export type ReserveResult =
  | { ok: true; reservation: Reservation; replayed: boolean }
  | { ok: false; reason: 'unknown_task' | 'invalid_units' | 'idempotency_conflict' }
  | { ok: false; reason: 'insufficient'; balance: Balance };

/**
 * S-BAT-03 reserve. A retry with the same idempotency key returns the original reservation;
 * the same key with different content is a conflict.
 */
export async function reserve(
  db: D1Database,
  input: { userId: string; appId: string; taskType: string; units: number; idempotencyKey: string },
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
  const task = await getTaskType(db, input.taskType);
  if (!task || task.app_id !== input.appId || task.enabled !== 1) return { ok: false, reason: 'unknown_task' };
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > task.max_units) return { ok: false, reason: 'invalid_units' };
  const policy = await getPolicy(db);
  const amount = task.unit_cost * input.units;
  const reservation: Reservation = {
    reservation_id: uuidv7(now),
    user_id: input.userId,
    app_id: input.appId,
    task_type: task.task_type,
    units: input.units,
    amount,
    status: 'reserved',
    charged: null,
    period: periodOf(now),
    created_at: now,
    expires_at: now + (task.timeout_ms ?? policy.default_timeout_ms),
    finished_at: null,
    op_id: null,
  };
  try {
    await db.batch([
      ensureAccount(db, input.userId, policy, now),
      db
        .prepare(
          `INSERT INTO battery_reservations (reservation_id, user_id, app_id, task_type, idempotency_key, units, amount, status, period, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`,
        )
        .bind(reservation.reservation_id, input.userId, input.appId, task.task_type, input.idempotencyKey, input.units, amount, reservation.period, now, reservation.expires_at),
      db.prepare('UPDATE battery_accounts SET reserved = reserved + ?, updated_at = ? WHERE user_id = ?').bind(amount, now, input.userId),
    ]);
  } catch (error) {
    // A concurrent retry with the same key won the race, or the reservation does not fit.
    const raced = await replay();
    if (raced) return raced;
    const balance = await getBalance(db, input.userId, now);
    if (balance.remaining < amount) return { ok: false, reason: 'insufficient', balance };
    throw error;
  }
  return { ok: true, reservation, replayed: false };
}

/** Closes one open reservation; op_id makes sure only the request that closed it moves the balance. */
function closeStatements(db: D1Database, r: Reservation, status: 'committed' | 'released' | 'expired', charged: number, opId: string, now: number): D1PreparedStatement[] {
  const guard = status === 'committed' ? 'AND expires_at > ?' : status === 'expired' ? 'AND expires_at <= ?' : 'AND ? = ?';
  const guardArgs = status === 'released' ? [0, 0] : [now];
  const statements = [
    db
      .prepare(`UPDATE battery_reservations SET status = ?, charged = ?, finished_at = ?, op_id = ? WHERE reservation_id = ? AND status = 'reserved' ${guard}`)
      .bind(status, status === 'committed' ? charged : null, now, opId, r.reservation_id, ...guardArgs),
    db
      .prepare(
        `UPDATE battery_accounts SET reserved = reserved - ?, used = used + ?, updated_at = ?
         WHERE user_id = ? AND EXISTS (SELECT 1 FROM battery_reservations WHERE reservation_id = ? AND op_id = ?)`,
      )
      .bind(r.amount, status === 'committed' ? charged : 0, now, r.user_id, r.reservation_id, opId),
  ];
  if (status === 'committed' && charged > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO battery_ledger (entry_id, user_id, period, kind, amount, app_id, task_type, reservation_id, created_at)
           SELECT ?, user_id, period, 'usage', charged, app_id, task_type, reservation_id, ? FROM battery_reservations WHERE reservation_id = ? AND op_id = ?`,
        )
        .bind(uuidv7(now), now, r.reservation_id, opId),
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
      await db.batch(closeStatements(db, r, 'expired', 0, randomToken(12), now));
      r = (await reservationById(db, r.reservation_id)) ?? r;
    }
    if (r.status !== 'reserved') {
      if (input.action === 'commit') return r.status === 'committed' ? { ok: true, reservation: r } : { ok: false, reason: r.status === 'expired' ? 'expired' : 'closed', reservation: r };
      return r.status === 'committed' ? { ok: false, reason: 'closed', reservation: r } : { ok: true, reservation: r };
    }
    const opId = randomToken(12);
    const charged = input.action === 'commit' ? (r.amount / r.units) * (input.units ?? r.units) : 0;
    await db.batch(closeStatements(db, r, input.action === 'commit' ? 'committed' : 'released', charged, opId, now));
    const after = await reservationById(db, r.reservation_id);
    if (!after) return { ok: false, reason: 'not_found' };
    if (after.op_id === opId) return { ok: true, reservation: after };
    r = after; // another request closed it first; answer from its outcome
  }
  return { ok: false, reason: 'closed', reservation: r };
}

/** Every minute (S-BAT-03): releases reservations whose timeout passed. Results arriving later charge nothing. */
export async function releaseExpired(db: D1Database, now: number): Promise<number> {
  const [, expired] = await db.batch([
    db
      .prepare(
        `UPDATE battery_accounts SET updated_at = ?, reserved = reserved - (
           SELECT COALESCE(SUM(r.amount), 0) FROM battery_reservations r WHERE r.user_id = battery_accounts.user_id AND r.status = 'reserved' AND r.expires_at <= ?)
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

export interface TaskTypeInput {
  taskType: string;
  appId: string;
  label: string;
  unitCost: number;
  maxUnits: number;
  timeoutMs: number | null;
  enabled: boolean;
}

/** S-BAT-02: the Owner defines what each AI task costs. task_type is "<app_id>.<name>". */
export function validTaskType(input: TaskTypeInput): boolean {
  const int = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  return (
    TASK_TYPE_ID.test(input.taskType) &&
    input.taskType.startsWith(`${input.appId}.`) &&
    input.label.trim().length >= 1 &&
    input.label.trim().length <= 60 &&
    int(input.unitCost, 1, 100_000) &&
    int(input.maxUnits, 1, 100_000) &&
    (input.timeoutMs === null || int(input.timeoutMs, 10_000, 3_600_000))
  );
}

export async function upsertTaskType(db: D1Database, input: TaskTypeInput, actorUserId: string, now: number): Promise<boolean> {
  if (!validTaskType(input)) return false;
  await db
    .prepare(
      `INSERT INTO battery_task_types (task_type, app_id, label, unit_cost, max_units, timeout_ms, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (task_type) DO UPDATE SET label = excluded.label, unit_cost = excluded.unit_cost, max_units = excluded.max_units,
         timeout_ms = excluded.timeout_ms, enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by
       WHERE battery_task_types.app_id = excluded.app_id`,
    )
    .bind(input.taskType, input.appId, input.label.trim(), input.unitCost, input.maxUnits, input.timeoutMs, input.enabled ? 1 : 0, now, actorUserId)
    .run();
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
      `SELECT l.entry_id, l.kind, l.amount, l.app_id, l.task_type, t.label AS task_label, l.created_at
       FROM battery_ledger l LEFT JOIN battery_task_types t ON t.task_type = l.task_type
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
      `SELECT l.entry_id, l.kind, l.amount, l.app_id, l.task_type, t.label AS task_label, l.created_at, l.reason, l.actor_user_id
       FROM battery_ledger l LEFT JOIN battery_task_types t ON t.task_type = l.task_type
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
}

/** Daily: ledger kept one year, closed reservations 35 days. */
export async function batteryRetention(db: D1Database, now: number): Promise<{ ledger: number; reservations: number }> {
  const [ledger, reservations] = await db.batch([
    db.prepare('DELETE FROM battery_ledger WHERE created_at < ?').bind(now - LEDGER_RETENTION_MS),
    db.prepare("DELETE FROM battery_reservations WHERE status <> 'reserved' AND finished_at < ?").bind(now - RESERVATION_RETENTION_MS),
  ]);
  return { ledger: ledger?.meta.changes ?? 0, reservations: reservations?.meta.changes ?? 0 };
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
