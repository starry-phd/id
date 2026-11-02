import { randomToken } from '../lib/crypto';

export const NONCE_TTL_MS = 10 * 60 * 1000;

/**
 * Issues a single-use sign-in nonce bound to an app_id (spec S-ID-01). Each call also
 * removes up to 20 long-expired nonces, so the table stays small between daily runs.
 */
export async function issueNonce(db: D1Database, appId: string, now: number): Promise<string> {
  const nonce = randomToken(24);
  await db.batch([
    db.prepare('INSERT INTO auth_nonces (nonce, app_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(nonce, appId, now, now + NONCE_TTL_MS),
    db.prepare('DELETE FROM auth_nonces WHERE nonce IN (SELECT nonce FROM auth_nonces WHERE expires_at < ? LIMIT 20)').bind(now - NONCE_TTL_MS),
  ]);
  return nonce;
}

/** Marks the nonce used; true only for the first use, before expiry, for the same app. */
export async function consumeNonce(db: D1Database, nonce: string, appId: string, now: number): Promise<boolean> {
  const result = await db
    .prepare('UPDATE auth_nonces SET consumed_at = ? WHERE nonce = ? AND app_id = ? AND consumed_at IS NULL AND expires_at > ?')
    .bind(now, nonce, appId, now)
    .run();
  return result.meta.changes === 1;
}
