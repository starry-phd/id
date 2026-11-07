import { auditStatement } from '../lib/audit';
import { constantTimeEqual, sha256Hex } from '../lib/crypto';

/** Spec S-ID-10: three Starry staff roles. */
export type Role = 'owner' | 'admin' | 'support';

const RANK: Record<Role, number> = { support: 1, admin: 2, owner: 3 };

/** Sensitive admin actions require a sign-in no older than this (spec S-ID-10). */
export const RECENT_LOGIN_MS = 10 * 60 * 1000;

/**
 * Owners come from the OWNER_USER_IDS secret (comma-separated member IDs) or from a
 * one-time claim (claimOwner) stored in user_roles; neither can be changed through the UI.
 * Admin and Support are granted by an owner and stored in user_roles.
 */
export function ownerIds(ownerUserIds: string | undefined): ReadonlySet<string> {
  return new Set(
    (ownerUserIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

export async function roleOf(db: D1Database, ownerUserIds: string | undefined, userId: string): Promise<Role | null> {
  if (ownerIds(ownerUserIds).has(userId)) return 'owner';
  const row = await db.prepare('SELECT role FROM user_roles WHERE user_id = ?').bind(userId).first<{ role: Role }>();
  return row?.role === 'owner' || row?.role === 'admin' || row?.role === 'support' ? row.role : null;
}

export function hasRole(role: Role | null, minimum: Role): boolean {
  return role !== null && RANK[role] >= RANK[minimum];
}

export function isRecentLogin(sessionCreatedAt: number, now: number): boolean {
  return now - sessionCreatedAt <= RECENT_LOGIN_MS;
}

export interface StaffActor {
  userId: string;
  role: Role;
  requestId: string | null;
}

export type StatusChangeResult = 'ok' | 'not_found' | 'not_allowed' | 'wrong_status';

/**
 * Spec S-ID-07: suspension bumps session_version so every Starry App rejects the
 * member's tokens immediately. Nobody can suspend an owner or themselves, and only an
 * owner can suspend staff.
 */
export async function suspendMember(
  db: D1Database,
  ownerUserIds: string | undefined,
  actor: StaffActor,
  targetId: string,
  reason: string,
  now: number,
): Promise<StatusChangeResult> {
  if (!hasRole(actor.role, 'admin') || targetId === actor.userId) return 'not_allowed';
  const target = await db.prepare('SELECT status FROM users WHERE user_id = ?').bind(targetId).first<{ status: string }>();
  if (!target) return 'not_found';
  const targetRole = await roleOf(db, ownerUserIds, targetId);
  if (targetRole === 'owner' || (targetRole !== null && actor.role !== 'owner')) return 'not_allowed';
  if (target.status !== 'active') return 'wrong_status';
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE users SET status = 'suspended', status_reason = ?, status_changed_at = ?,
           session_version = session_version + 1, updated_at = ?
         WHERE user_id = ? AND status = 'active'`,
      )
      .bind(reason, now, now, targetId),
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'suspended' WHERE user_id = ? AND revoked_at IS NULL").bind(now, targetId),
  ]);
  if (update?.meta.changes !== 1) return 'wrong_status';
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.member_suspended', targetType: 'user', targetId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return 'ok';
}

/** Restores a suspended member (owner or admin). Old tokens stay invalid; the member signs in again. */
export async function restoreMember(db: D1Database, actor: StaffActor, targetId: string, now: number): Promise<StatusChangeResult> {
  if (!hasRole(actor.role, 'admin')) return 'not_allowed';
  const update = await db
    .prepare(
      `UPDATE users SET status = 'active', status_reason = NULL, status_changed_at = ?, updated_at = ?
       WHERE user_id = ? AND status = 'suspended'`,
    )
    .bind(now, now, targetId)
    .run();
  if (update.meta.changes !== 1) {
    const exists = await db.prepare('SELECT 1 AS present FROM users WHERE user_id = ?').bind(targetId).first();
    return exists ? 'wrong_status' : 'not_found';
  }
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.member_restored', targetType: 'user', targetId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return 'ok';
}

/** Signs a member out of every device now: tokens stop working everywhere (session_version) and all sessions are revoked. */
export async function revokeAllSessions(db: D1Database, ownerUserIds: string | undefined, actor: StaffActor, targetId: string, now: number): Promise<StatusChangeResult> {
  if (!hasRole(actor.role, 'admin') || targetId === actor.userId) return 'not_allowed';
  const exists = await db.prepare('SELECT 1 AS present FROM users WHERE user_id = ?').bind(targetId).first();
  if (!exists) return 'not_found';
  const targetRole = await roleOf(db, ownerUserIds, targetId);
  if (targetRole === 'owner' || (targetRole !== null && actor.role !== 'owner')) return 'not_allowed';
  await db.batch([
    db.prepare('UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE user_id = ?').bind(now, targetId),
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'admin_signout' WHERE user_id = ? AND revoked_at IS NULL").bind(now, targetId),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.member_signed_out', targetType: 'user', targetId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return 'ok';
}

/** Owner-only: grant Admin or Support, or remove a staff role (role = null). */
export async function setStaffRole(
  db: D1Database,
  ownerUserIds: string | undefined,
  actor: StaffActor,
  targetId: string,
  role: 'admin' | 'support' | null,
  now: number,
): Promise<StatusChangeResult> {
  if (actor.role !== 'owner' || targetId === actor.userId || ownerIds(ownerUserIds).has(targetId)) return 'not_allowed';
  const exists = await db.prepare('SELECT 1 AS present FROM users WHERE user_id = ?').bind(targetId).first();
  if (!exists) return 'not_found';
  if ((await roleOf(db, ownerUserIds, targetId)) === 'owner') return 'not_allowed';
  const change =
    role === null
      ? db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(targetId)
      : db
          .prepare(
            `INSERT INTO user_roles (user_id, role, granted_at, granted_by) VALUES (?, ?, ?, ?)
             ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, granted_at = excluded.granted_at, granted_by = excluded.granted_by`,
          )
          .bind(targetId, role, now, actor.userId);
  await db.batch([
    change,
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: role === null ? 'admin.role_revoked' : `admin.role_granted.${role}`, targetType: 'user', targetId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return 'ok';
}

export type ClaimResult = 'claimed' | 'disabled' | 'already_claimed' | 'wrong_code' | 'not_active';

/**
 * One-time owner bootstrap: while the OWNER_CLAIM_CODE secret is set and no owner exists in
 * user_roles, a signed-in active member who enters the code becomes Owner. Remove the secret
 * afterwards. Keeps member IDs off every page (S-ID-03).
 */
export async function claimOwner(db: D1Database, claimCode: string | undefined, userId: string, code: string, requestId: string | null, now: number): Promise<ClaimResult> {
  if (!claimCode || claimCode.length < 12) return 'disabled';
  const existing = await db.prepare("SELECT 1 AS present FROM user_roles WHERE role = 'owner' LIMIT 1").first();
  if (existing) return 'already_claimed';
  const member = await db.prepare('SELECT status FROM users WHERE user_id = ?').bind(userId).first<{ status: string }>();
  if (member?.status !== 'active') return 'not_active';
  const ok = constantTimeEqual(await sha256Hex(code), await sha256Hex(claimCode));
  if (!ok) {
    await auditStatement(db, { actorType: 'user', actorUserId: userId, action: 'admin.owner_claim', targetType: 'user', targetId: userId, result: 'denied', requestId, retention: 'security' }, now).run();
    return 'wrong_code';
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO user_roles (user_id, role, granted_at, granted_by) VALUES (?, 'owner', ?, 'owner-claim')
         ON CONFLICT (user_id) DO UPDATE SET role = 'owner', granted_at = excluded.granted_at, granted_by = excluded.granted_by`,
      )
      .bind(userId, now),
    auditStatement(db, { actorType: 'user', actorUserId: userId, action: 'admin.owner_claim', targetType: 'user', targetId: userId, result: 'success', requestId, retention: 'security' }, now),
  ]);
  return 'claimed';
}

/** App managers: scoped to specific Apps (remote config, read-only views). They have no global staff role. */
export async function listAppStaffApps(db: D1Database, userId: string): Promise<string[]> {
  return (await db.prepare('SELECT app_id FROM app_staff WHERE user_id = ? ORDER BY app_id').bind(userId).all<{ app_id: string }>()).results.map((r) => r.app_id);
}

export async function isAppStaff(db: D1Database, userId: string, appId: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS ok FROM app_staff WHERE user_id = ? AND app_id = ?').bind(userId, appId).first()) !== null;
}

export async function setAppStaff(db: D1Database, actor: StaffActor, userId: string, appId: string, grant: boolean, now: number): Promise<boolean> {
  if (actor.role !== 'owner') return false;
  const user = await db.prepare('SELECT 1 AS ok FROM users WHERE user_id = ?').bind(userId).first();
  if (!user) return false;
  await db.batch([
    grant
      ? db.prepare('INSERT OR IGNORE INTO app_staff (user_id, app_id, granted_at, granted_by) VALUES (?, ?, ?, ?)').bind(userId, appId, now, actor.userId)
      : db.prepare('DELETE FROM app_staff WHERE user_id = ? AND app_id = ?').bind(userId, appId),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: grant ? 'admin.app_staff_granted' : 'admin.app_staff_revoked', targetType: 'user', targetId: userId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return true;
}
