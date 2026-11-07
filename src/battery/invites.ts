import { uuidv7 } from '../lib/crypto';

export interface InviteCode {
  code: string;
  app_id: string;
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
    .prepare('SELECT code, app_id, units, max_uses, used, expires_at, active, note, created_at FROM invite_codes WHERE app_id = ? ORDER BY created_at DESC, code LIMIT ?')
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

export type RedeemResult = { ok: true; appId: string; units: number } | { ok: false; reason: 'invalid' | 'already' | 'used_up' };

/** A member redeems a code once. Gift units go to the member's Quantum Battery of the code's App. */
export async function redeemInvite(db: D1Database, userId: string, rawCode: string, now: number): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  if (!CODE_RE.test(code)) return { ok: false, reason: 'invalid' };
  const row = await db.prepare('SELECT app_id, units, max_uses, used, expires_at, active FROM invite_codes WHERE code = ?').bind(code).first<{ app_id: string; units: number; max_uses: number; used: number; expires_at: number | null; active: number }>();
  if (!row || row.active !== 1 || (row.expires_at !== null && row.expires_at <= now)) return { ok: false, reason: 'invalid' };
  if (row.used >= row.max_uses) return { ok: false, reason: 'used_up' };
  // The primary key makes a second redemption by the same member fail here.
  try {
    await db.prepare('INSERT INTO invite_redemptions (code, user_id, redeemed_at) VALUES (?, ?, ?)').bind(code, userId, now).run();
  } catch {
    return { ok: false, reason: 'already' };
  }
  const claim = await db
    .prepare('UPDATE invite_codes SET used = used + 1 WHERE code = ? AND active = 1 AND used < max_uses AND (expires_at IS NULL OR expires_at > ?)')
    .bind(code, now)
    .run();
  if (!claim.meta.changes) {
    await db.prepare('DELETE FROM invite_redemptions WHERE code = ? AND user_id = ?').bind(code, userId).run();
    return { ok: false, reason: 'used_up' };
  }
  await db.batch([
    db.prepare('INSERT INTO quantum_accounts (user_id, app_id, balance, reserved, updated_at) VALUES (?, ?, 0, 0, ?) ON CONFLICT (user_id, app_id) DO NOTHING').bind(userId, row.app_id, now),
    db.prepare('UPDATE quantum_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND app_id = ?').bind(row.units, now, userId, row.app_id),
    db
      .prepare("INSERT INTO quantum_ledger (entry_id, user_id, app_id, kind, amount, ref, reason, created_at) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?)")
      .bind(uuidv7(now), userId, row.app_id, row.units, `invite:${code}:${userId}`, '邀請碼贈送', now),
  ]);
  return { ok: true, appId: row.app_id, units: row.units };
}

/** Account purge: forget a member's redemptions. */
export async function forgetInviteMembers(db: D1Database, userIds: string[]): Promise<void> {
  for (const userId of userIds) await db.prepare('DELETE FROM invite_redemptions WHERE user_id = ?').bind(userId).run();
}

/** Account merge: the kept account inherits the merged one's redemptions so a code cannot be used twice. */
export async function moveInvites(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO invite_redemptions (code, user_id, redeemed_at) SELECT code, ?, redeemed_at FROM invite_redemptions WHERE user_id = ?').bind(toUserId, fromUserId).run();
}
