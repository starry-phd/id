import { uuidv7 } from '../lib/crypto';
import { adjustAllowance, bonusOf, scaled } from './battery';

export type CodeKind = 'quantum' | 'battery';

export interface InviteCode {
  code: string;
  kind: CodeKind;
  app_id: string | null;
  units: number;
  max_uses: number;
  used: number;
  expires_at: number | null;
  active: number;
  note: string | null;
  created_at: number;
}

const CODE_RE = /^[A-Z0-9]{6,32}$/;
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export const normalizeCode = (raw: string): string => raw.trim().toUpperCase().split('-').join('').split(' ').join('');

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function listInvites(db: D1Database, appId: string, limit = 50): Promise<InviteCode[]> {
  const rows = await db
    .prepare('SELECT code, kind, app_id, units, max_uses, used, expires_at, active, note, created_at FROM invite_codes WHERE app_id = ? ORDER BY created_at DESC, code LIMIT ?')
    .bind(appId, limit)
    .all<InviteCode>();
  return rows.results;
}

/** Owner creates a code. An empty code means "generate one". Returns the code, or null when the input is invalid or taken. */
export async function createInvite(
  db: D1Database,
  input: { appId: string; code?: string; units: number; maxUses: number; expiresAt: number | null; note: string; actorUserId: string },
  now: number,
): Promise<string | null> {
  const code = input.code ? normalizeCode(input.code) : generateCode();
  const note = input.note.trim().slice(0, 100);
  if (!CODE_RE.test(code) || !Number.isInteger(input.units) || input.units < 1 || input.units > 1000) return null;
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 100000) return null;
  if (input.expiresAt !== null && input.expiresAt <= now) return null;
  try {
    await db
      .prepare('INSERT INTO invite_codes (code, app_id, units, max_uses, expires_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(code, input.appId, input.units, input.maxUses, input.expiresAt, note || null, input.actorUserId, now)
      .run();
  } catch {
    return null;
  }
  return code;
}

export async function setInviteActive(db: D1Database, appId: string, code: string, active: boolean): Promise<void> {
  await db.prepare('UPDATE invite_codes SET active = ? WHERE code = ? AND app_id = ?').bind(active ? 1 : 0, code, appId).run();
}

export type RedeemResult = { ok: true; kind: CodeKind; appId: string | null; units: number } | { ok: false; reason: 'invalid' | 'already' | 'used_up' | 'error' | 'need_app' };

/**
 * A member redeems a code once. A 'quantum' code adds Quantum Battery in the code's App only; a 'battery' code adds
 * free Starry Battery to this month's allowance (it resets to the standard monthly amount next month).
 */
export async function redeemInvite(db: D1Database, userId: string, rawCode: string, now: number, chosenAppId: string | null = null): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  if (!CODE_RE.test(code)) return { ok: false, reason: 'invalid' };
  const row = await db
    .prepare('SELECT kind, app_id, units, max_uses, used, expires_at, active FROM invite_codes WHERE code = ?')
    .bind(code)
    .first<{ kind: CodeKind; app_id: string | null; units: number; max_uses: number; used: number; expires_at: number | null; active: number }>();
  if (!row || row.active !== 1 || (row.expires_at !== null && row.expires_at <= now)) return { ok: false, reason: 'invalid' };
  if (row.used >= row.max_uses) return { ok: false, reason: 'used_up' };
  // A universal quantum code (no App on it) needs the member's choice; the caller checked that the App exists.
  if (row.kind === 'quantum' && !row.app_id && !chosenAppId) return { ok: false, reason: 'need_app' };
  // The primary key makes a second redemption by the same member fail here.
  try {
    await db.prepare('INSERT INTO invite_redemptions (code, user_id, redeemed_at) VALUES (?, ?, ?)').bind(code, userId, now).run();
  } catch {
    return { ok: false, reason: 'already' };
  }
  const undo = async (): Promise<void> => {
    await db.batch([
      db.prepare('DELETE FROM invite_redemptions WHERE code = ? AND user_id = ?').bind(code, userId),
      db.prepare('UPDATE invite_codes SET used = MAX(used - 1, 0) WHERE code = ?').bind(code),
    ]);
  };
  const claim = await db
    .prepare('UPDATE invite_codes SET used = used + 1 WHERE code = ? AND active = 1 AND used < max_uses AND (expires_at IS NULL OR expires_at > ?)')
    .bind(code, now)
    .run();
  if (!claim.meta.changes) {
    await db.prepare('DELETE FROM invite_redemptions WHERE code = ? AND user_id = ?').bind(code, userId).run();
    return { ok: false, reason: 'used_up' };
  }
  if (row.kind === 'battery') {
    // A free Battery code is a gain, so the member's current bonus multiplier applies to it.
    const multiplier = await bonusOf(db, userId);
    const units = scaled(row.units, multiplier);
    try {
      const granted = await adjustAllowance(db, { userId, delta: units, reason: multiplier > 10 ? `序號兌換 ${code}（加碼 ${(multiplier / 10).toFixed(1)} 倍）` : `序號兌換 ${code}`, actorUserId: userId }, now);
      if (!granted.ok) {
        await undo();
        return { ok: false, reason: 'error' };
      }
    } catch {
      await undo();
      return { ok: false, reason: 'error' };
    }
    return { ok: true, kind: 'battery', appId: null, units };
  }
  const appId = (row.app_id ?? chosenAppId) as string;
  await db.batch([
    db.prepare('INSERT INTO quantum_accounts (user_id, app_id, balance, reserved, updated_at) VALUES (?, ?, 0, 0, ?) ON CONFLICT (user_id, app_id) DO NOTHING').bind(userId, appId, now),
    db.prepare('UPDATE quantum_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND app_id = ?').bind(row.units, now, userId, appId),
    db
      .prepare("INSERT INTO quantum_ledger (entry_id, user_id, app_id, kind, amount, ref, reason, created_at) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?)")
      .bind(uuidv7(now), userId, appId, row.units, `invite:${code}:${userId}`, '序號贈送', now),
  ]);
  return { ok: true, kind: 'quantum', appId, units: row.units };
}

/** What a code would give, or null when it cannot be redeemed now (unknown, disabled, expired or used up). */
export async function codeInfo(db: D1Database, rawCode: string, now: number): Promise<{ kind: CodeKind; appId: string | null; units: number } | null> {
  const code = normalizeCode(rawCode);
  if (!CODE_RE.test(code)) return null;
  const row = await db
    .prepare('SELECT kind, app_id, units, max_uses, used, expires_at, active FROM invite_codes WHERE code = ?')
    .bind(code)
    .first<{ kind: CodeKind; app_id: string | null; units: number; max_uses: number; used: number; expires_at: number | null; active: number }>();
  if (!row || row.active !== 1 || row.used >= row.max_uses || (row.expires_at !== null && row.expires_at <= now)) return null;
  return { kind: row.kind, appId: row.app_id, units: row.units };
}

export interface BatchInput {
  kind: CodeKind;
  appId: string | null;
  units: number;
  count: number;
  maxUsesPerCode: number;
  expiresAt: number | null;
  note: string;
  actorUserId: string;
}

export const MAX_BATCH = 100;

/** Owner generates a batch of codes of one kind. Returns the batch id and codes, or null when the input is invalid. */
export async function createBatch(db: D1Database, input: BatchInput, now: number): Promise<{ batchId: string; codes: string[] } | null> {
  const note = input.note.trim().slice(0, 100);
  if (input.kind === 'battery' && input.appId !== null) return null;
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > 1000) return null;
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_BATCH) return null;
  if (!Number.isInteger(input.maxUsesPerCode) || input.maxUsesPerCode < 1 || input.maxUsesPerCode > 100000) return null;
  if (input.expiresAt !== null && input.expiresAt <= now) return null;
  const batchId = uuidv7(now);
  for (let attempt = 0; attempt < 3; attempt++) {
    const codes = new Set<string>();
    while (codes.size < input.count) codes.add(generateCode());
    const list = [...codes];
    try {
      await db.batch(
        list.map((code) =>
          db
            .prepare('INSERT INTO invite_codes (code, kind, app_id, units, max_uses, expires_at, note, created_by, created_at, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(code, input.kind, input.appId, input.units, input.maxUsesPerCode, input.expiresAt, note || null, input.actorUserId, now, batchId),
        ),
      );
      return { batchId, codes: list };
    } catch {
      // A generated code collided with an existing one: the whole batch is rolled back, draw again.
    }
  }
  return null;
}

export interface BatchSummary {
  batch_id: string;
  kind: CodeKind;
  app_id: string | null;
  units: number;
  codes: number;
  used: number;
  max_uses: number;
  active: number;
  expires_at: number | null;
  note: string | null;
  created_at: number;
}

export async function recentBatches(db: D1Database, limit = 20): Promise<BatchSummary[]> {
  const rows = await db
    .prepare(
      `SELECT batch_id, kind, app_id, MAX(units) AS units, COUNT(*) AS codes, SUM(used) AS used, SUM(max_uses) AS max_uses, MAX(active) AS active,
              MAX(expires_at) AS expires_at, MAX(note) AS note, MIN(created_at) AS created_at
       FROM invite_codes WHERE batch_id IS NOT NULL GROUP BY batch_id ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<BatchSummary>();
  return rows.results;
}

export async function batchCodes(db: D1Database, batchId: string): Promise<InviteCode[]> {
  const rows = await db
    .prepare('SELECT code, kind, app_id, units, max_uses, used, expires_at, active, note, created_at FROM invite_codes WHERE batch_id = ? ORDER BY code')
    .bind(batchId)
    .all<InviteCode>();
  return rows.results;
}

export async function setBatchActive(db: D1Database, batchId: string, active: boolean): Promise<void> {
  await db.prepare('UPDATE invite_codes SET active = ? WHERE batch_id = ?').bind(active ? 1 : 0, batchId).run();
}

/** The page address that redeems one code (the member signs in first when needed). */
export const redeemUrl = (origin: string, code: string): string => `${origin}/account/redeem/${code}`;

/** 5-5 grouping for reading and typing; normalizeCode strips the dash again. */
export const displayCode = (code: string): string => (code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code);

/** Account purge: forget a member's redemptions. */
export async function forgetInviteMembers(db: D1Database, userIds: string[]): Promise<void> {
  for (const userId of userIds) await db.prepare('DELETE FROM invite_redemptions WHERE user_id = ?').bind(userId).run();
}

/** Account merge: the kept account inherits the merged one's redemptions so a code cannot be used twice. */
export async function moveInvites(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO invite_redemptions (code, user_id, redeemed_at) SELECT code, ?, redeemed_at FROM invite_redemptions WHERE user_id = ?').bind(toUserId, fromUserId).run();
}
