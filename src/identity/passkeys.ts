import { auditStatement } from '../lib/audit';
import type { PasskeyKey } from '../auth/webauthn';

export const MAX_PASSKEYS = 10;

export interface PasskeyRow {
  credential_id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export async function listPasskeys(db: D1Database, userId: string): Promise<PasskeyRow[]> {
  return (await db.prepare('SELECT credential_id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at').bind(userId).all<PasskeyRow>()).results;
}

export type AddResult = 'added' | 'limit' | 'duplicate';

export async function addPasskey(
  db: D1Database,
  input: { userId: string; credentialId: string; key: PasskeyKey; signCount: number; name: string; requestId: string | null },
  now: number,
): Promise<AddResult> {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(input.userId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_PASSKEYS) return 'limit';
  const name = input.name.trim().slice(0, 40) || 'Passkey';
  try {
    await db.batch([
      db.prepare('INSERT INTO passkeys (credential_id, user_id, public_key, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(input.credentialId, input.userId, JSON.stringify(input.key), input.signCount, name, now),
      auditStatement(db, { actorType: 'user', actorUserId: input.userId, action: 'passkey.added', targetType: 'user', targetId: input.userId, result: 'success', requestId: input.requestId, retention: 'security' }, now),
    ]);
    return 'added';
  } catch {
    return 'duplicate';
  }
}

export async function removePasskey(db: D1Database, userId: string, credentialId: string, requestId: string | null, now: number): Promise<boolean> {
  const [removed] = await db.batch([
    db.prepare('DELETE FROM passkeys WHERE credential_id = ? AND user_id = ?').bind(credentialId, userId),
    auditStatement(db, { actorType: 'user', actorUserId: userId, action: 'passkey.removed', targetType: 'user', targetId: userId, result: 'success', requestId, retention: 'security' }, now),
  ]);
  return (removed?.meta.changes ?? 0) === 1;
}

export interface PasskeyForLogin {
  user_id: string;
  key: PasskeyKey;
  sign_count: number;
}

export async function findPasskey(db: D1Database, credentialId: string): Promise<PasskeyForLogin | null> {
  const row = await db.prepare('SELECT user_id, public_key, sign_count FROM passkeys WHERE credential_id = ?').bind(credentialId).first<{ user_id: string; public_key: string; sign_count: number }>();
  if (!row) return null;
  return { user_id: row.user_id, key: JSON.parse(row.public_key) as PasskeyKey, sign_count: row.sign_count };
}

/** Records the use; false when the counter moved in the meantime (a replayed or cloned assertion). */
export async function touchPasskey(db: D1Database, credentialId: string, previousCount: number, signCount: number, now: number): Promise<boolean> {
  const result = await db.prepare('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ? AND sign_count = ?').bind(signCount, now, credentialId, previousCount).run();
  return result.meta.changes === 1;
}
