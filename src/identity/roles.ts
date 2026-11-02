import { auditStatement } from '../lib/audit';

/** Spec S-ID-10: three Starry staff roles. */
export type Role = 'owner' | 'admin' | 'support';

const RANK: Record<Role, number> = { support: 1, admin: 2, owner: 3 };

/** Sensitive admin actions require a sign-in no older than this (spec S-ID-10). */
export const RECENT_LOGIN_MS = 10 * 60 * 1000;

/**
 * Owners come from the OWNER_USER_IDS secret (comma-separated member IDs), so the
 * first owner needs no database bootstrap and can never be removed through the UI.
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
  return row?.role === 'admin' || row?.role === 'support' ? row.role : null;
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

/** a***@example.com — enough for staff to recognise a member without exposing the address. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function maskName(name: string | null): string | null {
  if (!name) return null;
  const chars = [...name];
  return chars.length <= 1 ? '＊' : `${chars[0]}${'＊'.repeat(Math.min(chars.length - 1, 4))}`;
}

export interface MemberSummary {
  user_id: string;
  status: string;
  status_reason: string | null;
  created_at: number;
  display_name: string | null;
  emails: (string | null)[];
  providers: string[];
  role: Role | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Staff member search (spec S-ADM-01): exact member ID or exact email, otherwise the
 * newest members, with cursor pagination. Names and emails come back masked.
 */
export async function searchMembers(
  db: D1Database,
  ownerUserIds: string | undefined,
  options: { query?: string | undefined; cursor?: string | undefined; limit?: number | undefined },
): Promise<{ members: MemberSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const query = options.query?.trim().toLowerCase() ?? '';
  let ids: string[];
  if (query.length > 0) {
    const rows = UUID.test(query)
      ? await db.prepare('SELECT user_id FROM users WHERE user_id = ?').bind(query).all<{ user_id: string }>()
      : await db.prepare('SELECT DISTINCT user_id FROM auth_identities WHERE lower(email) = ? LIMIT ?').bind(query, limit).all<{ user_id: string }>();
    ids = rows.results.map((r) => r.user_id);
  } else {
    const cursor = options.cursor && UUID.test(options.cursor) ? options.cursor : 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const rows = await db.prepare('SELECT user_id FROM users WHERE user_id < ? ORDER BY user_id DESC LIMIT ?').bind(cursor, limit + 1).all<{ user_id: string }>();
    ids = rows.results.map((r) => r.user_id);
  }
  const hasMore = query.length === 0 && ids.length > limit;
  if (hasMore) ids = ids.slice(0, limit);
  const members: MemberSummary[] = [];
  for (const id of ids) {
    const [user, identities] = await db.batch([
      db
        .prepare('SELECT u.user_id, u.status, u.status_reason, u.created_at, p.display_name FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id WHERE u.user_id = ?')
        .bind(id),
      db.prepare('SELECT provider, email FROM auth_identities WHERE user_id = ? ORDER BY provider').bind(id),
    ]);
    const u = user?.results[0] as { user_id: string; status: string; status_reason: string | null; created_at: number; display_name: string | null } | undefined;
    if (!u) continue;
    const linked = (identities?.results ?? []) as { provider: string; email: string | null }[];
    members.push({
      user_id: u.user_id,
      status: u.status,
      status_reason: u.status_reason,
      created_at: u.created_at,
      display_name: maskName(u.display_name),
      emails: linked.map((i) => maskEmail(i.email)),
      providers: linked.map((i) => i.provider),
      role: await roleOf(db, ownerUserIds, u.user_id),
    });
  }
  return { members, nextCursor: hasMore ? (ids[ids.length - 1] ?? null) : null };
}
