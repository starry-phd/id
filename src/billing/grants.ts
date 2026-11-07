/**
 * Manual entitlement grants (Admin Lite). A grant gives a member an App entitlement without a store purchase, with
 * an optional end date. Grants are read together with the RevenueCat projection (activeEntitlements) and are never
 * touched by RevenueCat events or the daily reconciliation.
 */
import { uuidv7 } from '../lib/crypto';

export const GRANT_STORE = 'STARRY_GRANT';
export const MAX_ACTIVE_GRANTS = 10;
const ENTITLEMENT_RE = /^[A-Za-z0-9_.-]{1,60}$/;

export interface Grant {
  grant_id: string;
  app_id: string;
  entitlement: string;
  expires_at: number | null;
  reason: string;
  granted_by: string;
  created_at: number;
}

export type GrantResult = { ok: true; grantId: string } | { ok: false; reason: 'bad_entitlement' | 'bad_reason' | 'bad_expiry' | 'too_many' };

export async function grantEntitlement(
  db: D1Database,
  input: { userId: string; appId: string; entitlement: string; expiresAt: number | null; reason: string; actorUserId: string },
  now: number,
): Promise<GrantResult> {
  const entitlement = input.entitlement.trim();
  const reason = input.reason.trim();
  if (!ENTITLEMENT_RE.test(entitlement)) return { ok: false, reason: 'bad_entitlement' };
  if (reason.length < 1 || reason.length > 200) return { ok: false, reason: 'bad_reason' };
  if (input.expiresAt !== null && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now)) return { ok: false, reason: 'bad_expiry' };
  const active = await db
    .prepare('SELECT COUNT(*) AS n FROM entitlement_grants WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)')
    .bind(input.userId, now)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_GRANTS) return { ok: false, reason: 'too_many' };
  const grantId = uuidv7(now);
  await db
    .prepare('INSERT INTO entitlement_grants (grant_id, user_id, app_id, entitlement, expires_at, reason, granted_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(grantId, input.userId, input.appId, entitlement, input.expiresAt, reason, input.actorUserId, now)
    .run();
  return { ok: true, grantId };
}

/** Grants that still count (not revoked, not expired), newest first. */
export async function listGrants(db: D1Database, userId: string, now: number): Promise<Grant[]> {
  const rows = await db
    .prepare(
      `SELECT grant_id, app_id, entitlement, expires_at, reason, granted_by, created_at FROM entitlement_grants
       WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC`,
    )
    .bind(userId, now)
    .all<Grant>();
  return rows.results;
}

/** Ends a grant now. False when it does not belong to the member or already ended. */
export async function revokeGrant(db: D1Database, userId: string, grantId: string, now: number): Promise<{ appId: string; entitlement: string } | null> {
  const row = await db
    .prepare('SELECT app_id, entitlement FROM entitlement_grants WHERE grant_id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(grantId, userId)
    .first<{ app_id: string; entitlement: string }>();
  if (!row) return null;
  const done = await db.prepare('UPDATE entitlement_grants SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL').bind(now, grantId).run();
  return done.meta.changes === 1 ? { appId: row.app_id, entitlement: row.entitlement } : null;
}
