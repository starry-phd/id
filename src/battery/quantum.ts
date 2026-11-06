import { uuidv7 } from '../lib/crypto';

/**
 * Quantum Battery (owner decision 2026-11-07). A paid top-up sold by one App through the store and spendable only in that
 * App. Separate from the free monthly Battery (src/battery/battery.ts), which is always spent first. Nothing here ever
 * touches battery_accounts, so a payment can never raise the free allowance.
 */
export interface QuantumBalance {
  app_id: string;
  balance: number;
  reserved: number;
  available: number;
}

const EMPTY = (appId: string): QuantumBalance => ({ app_id: appId, balance: 0, reserved: 0, available: 0 });

export async function getQuantum(db: D1Database, userId: string, appId: string): Promise<QuantumBalance> {
  const row = await db.prepare('SELECT balance, reserved FROM quantum_accounts WHERE user_id = ? AND app_id = ?').bind(userId, appId).first<{ balance: number; reserved: number }>();
  return row ? { app_id: appId, balance: row.balance, reserved: row.reserved, available: row.balance - row.reserved } : EMPTY(appId);
}

/** Every App's Quantum Battery of one member (account center and Admin Lite); only Apps with a balance show up. */
export async function listQuantum(db: D1Database, userId: string): Promise<QuantumBalance[]> {
  const rows = await db
    .prepare('SELECT app_id, balance, reserved FROM quantum_accounts WHERE user_id = ? AND (balance > 0 OR reserved > 0) ORDER BY app_id')
    .bind(userId)
    .all<{ app_id: string; balance: number; reserved: number }>();
  return rows.results.map((r) => ({ app_id: r.app_id, balance: r.balance, reserved: r.reserved, available: r.balance - r.reserved }));
}

export interface QuantumProduct {
  app_id: string;
  product_id: string;
  units: number;
}

export async function listQuantumProducts(db: D1Database, appId?: string): Promise<QuantumProduct[]> {
  const rows = appId
    ? await db.prepare('SELECT app_id, product_id, units FROM quantum_products WHERE app_id = ? ORDER BY product_id').bind(appId).all<QuantumProduct>()
    : await db.prepare('SELECT app_id, product_id, units FROM quantum_products ORDER BY app_id, product_id').all<QuantumProduct>();
  return rows.results;
}

const PRODUCT_ID = /^[A-Za-z0-9._:-]{1,200}$/;

/** Owner: map a store product to a number of Quantum Battery units. Returns false for an invalid product id or count. */
export async function saveQuantumProduct(db: D1Database, input: { appId: string; productId: string; units: number; actorUserId: string }, now: number): Promise<boolean> {
  if (!PRODUCT_ID.test(input.productId) || !Number.isInteger(input.units) || input.units < 1 || input.units > 1_000_000) return false;
  await db
    .prepare(
      `INSERT INTO quantum_products (app_id, product_id, units, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (app_id, product_id) DO UPDATE SET units = excluded.units, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(input.appId, input.productId, input.units, now, input.actorUserId)
    .run();
  return true;
}

export async function removeQuantumProduct(db: D1Database, appId: string, productId: string): Promise<void> {
  await db.prepare('DELETE FROM quantum_products WHERE app_id = ? AND product_id = ?').bind(appId, productId).run();
}

export type CreditResult = 'credited' | 'duplicate' | 'not_a_quantum_product';

/** A store purchase of a mapped product: adds its units once per store transaction (idempotent on `ref`). */
export async function creditPurchase(db: D1Database, input: { userId: string; appId: string; productId: string; ref: string }, now: number): Promise<CreditResult> {
  const product = await db.prepare('SELECT units FROM quantum_products WHERE app_id = ? AND product_id = ?').bind(input.appId, input.productId).first<{ units: number }>();
  if (!product) return 'not_a_quantum_product';
  const entryId = uuidv7(now);
  const [ledger] = await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO quantum_ledger (entry_id, user_id, app_id, kind, amount, ref, product_id, created_at) VALUES (?, ?, ?, 'purchase', ?, ?, ?, ?)")
      .bind(entryId, input.userId, input.appId, product.units, input.ref, input.productId, now),
    db
      .prepare(
        `INSERT INTO quantum_accounts (user_id, app_id, balance, reserved, updated_at)
         SELECT ?, ?, ?, 0, ? WHERE EXISTS (SELECT 1 FROM quantum_ledger WHERE entry_id = ?)
         ON CONFLICT (user_id, app_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at`,
      )
      .bind(input.userId, input.appId, product.units, now, entryId),
  ]);
  return ledger?.meta.changes === 1 ? 'credited' : 'duplicate';
}

export type ReverseResult = 'reversed' | 'duplicate' | 'unknown_purchase';

/**
 * A refund of a credited purchase takes the same units back. Units already in running tasks cannot be taken, so the
 * deduction is capped at what is free; the ledger row says how many units could not be recovered.
 */
export async function reversePurchase(db: D1Database, input: { appId: string; ref: string }, now: number): Promise<ReverseResult> {
  const bought = await db
    .prepare("SELECT user_id, amount FROM quantum_ledger WHERE app_id = ? AND ref = ? AND kind = 'purchase'")
    .bind(input.appId, input.ref)
    .first<{ user_id: string; amount: number }>();
  if (!bought) return 'unknown_purchase';
  const account = await getQuantum(db, bought.user_id, input.appId);
  const deduct = Math.max(0, Math.min(bought.amount, account.available));
  const shortfall = bought.amount - deduct;
  const entryId = uuidv7(now);
  const [ledger] = await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO quantum_ledger (entry_id, user_id, app_id, kind, amount, ref, reason, created_at) VALUES (?, ?, ?, 'refund', ?, ?, ?, ?)")
      .bind(entryId, bought.user_id, input.appId, -deduct, `refund:${input.ref}`, shortfall > 0 ? `not recovered: ${shortfall}` : null, now),
    db
      .prepare('UPDATE quantum_accounts SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND app_id = ? AND EXISTS (SELECT 1 FROM quantum_ledger WHERE entry_id = ?)')
      .bind(deduct, now, bought.user_id, input.appId, entryId),
  ]);
  return ledger?.meta.changes === 1 ? 'reversed' : 'duplicate';
}

export type QuantumAdjustResult = { ok: true; balance: QuantumBalance } | { ok: false; reason: 'invalid' | 'too_low' };

/** Staff correction of one member's Quantum Battery in one App (reason required, never below what is held). */
export async function adjustQuantum(db: D1Database, input: { userId: string; appId: string; delta: number; reason: string; actorUserId: string }, now: number): Promise<QuantumAdjustResult> {
  const reason = input.reason.trim();
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > 1_000_000 || reason.length < 1 || reason.length > 200) return { ok: false, reason: 'invalid' };
  try {
    await db.batch([
      db.prepare('INSERT INTO quantum_accounts (user_id, app_id, balance, reserved, updated_at) VALUES (?, ?, 0, 0, ?) ON CONFLICT (user_id, app_id) DO NOTHING').bind(input.userId, input.appId, now),
      db.prepare('UPDATE quantum_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND app_id = ?').bind(input.delta, now, input.userId, input.appId),
      db
        .prepare("INSERT INTO quantum_ledger (entry_id, user_id, app_id, kind, amount, reason, actor_user_id, created_at) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?)")
        .bind(uuidv7(now), input.userId, input.appId, input.delta, reason, input.actorUserId, now),
    ]);
  } catch {
    return { ok: false, reason: 'too_low' };
  }
  return { ok: true, balance: await getQuantum(db, input.userId, input.appId) };
}

export interface QuantumLedgerEntry {
  entry_id: string;
  kind: 'purchase' | 'usage' | 'refund' | 'adjustment';
  amount: number;
  task_label: string | null;
  created_at: number;
}

/** The member's own Quantum Battery history in one App, newest first (reasons stay internal). */
export async function quantumHistory(db: D1Database, userId: string, appId: string, limit = 30): Promise<QuantumLedgerEntry[]> {
  const rows = await db
    .prepare('SELECT entry_id, kind, amount, task_label, created_at FROM quantum_ledger WHERE user_id = ? AND app_id = ? ORDER BY entry_id DESC LIMIT ?')
    .bind(userId, appId, Math.min(Math.max(limit, 1), 100))
    .all<QuantumLedgerEntry>();
  return rows.results;
}

/** Account purge (S-ID-06). */
export async function forgetQuantumMembers(db: D1Database, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await db.batch([db.prepare('DELETE FROM quantum_ledger WHERE user_id = ?').bind(userId), db.prepare('DELETE FROM quantum_accounts WHERE user_id = ?').bind(userId)]);
  }
}

/**
 * Account merge: purchased Quantum Battery is the member's property, so it moves to the account that stays
 * (balances add up, history follows). Safe to repeat: after the move nothing is left to move.
 */
export async function moveQuantum(db: D1Database, fromUserId: string, toUserId: string, now: number): Promise<void> {
  if (fromUserId === toUserId) return;
  await db.batch([
    db
      .prepare(
        `INSERT INTO quantum_accounts (user_id, app_id, balance, reserved, updated_at)
         SELECT ?, app_id, balance, 0, ? FROM quantum_accounts WHERE user_id = ? AND balance > 0
         ON CONFLICT (user_id, app_id) DO UPDATE SET balance = quantum_accounts.balance + excluded.balance, updated_at = excluded.updated_at`,
      )
      .bind(toUserId, now, fromUserId),
    db.prepare('UPDATE quantum_ledger SET user_id = ? WHERE user_id = ?').bind(toUserId, fromUserId),
    db.prepare('DELETE FROM quantum_accounts WHERE user_id = ?').bind(fromUserId),
  ]);
}
