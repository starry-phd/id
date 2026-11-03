import { auditStatement } from '../lib/audit';
import { WEB_APP_ID, WEB_SESSION_IDLE_MS } from './web-sessions';

/**
 * Spec S-ID-05: a member sees where they are signed in and can end one session or all of
 * them. App sessions and web account-center sessions share the sessions table, so the same
 * rules cover both.
 */
export interface ActiveSession {
  sessionId: string;
  appId: string;
  deviceLabel: string | null;
  createdAt: number;
  lastUsedAt: number;
}

const MAX_LISTED = 50;

/** Sessions that would still be accepted right now, most recently used first. */
export async function listActiveSessions(db: D1Database, userId: string, now: number): Promise<ActiveSession[]> {
  const rows = await db
    .prepare(
      `SELECT s.session_id, s.app_id, s.device_label, s.created_at, s.last_used_at
       FROM sessions s JOIN users u ON u.user_id = s.user_id
       WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND s.session_version = u.session_version
         AND (s.app_id <> ? OR s.last_used_at >= ?)
       ORDER BY s.last_used_at DESC, s.session_id DESC LIMIT ?`,
    )
    .bind(userId, now, WEB_APP_ID, now - WEB_SESSION_IDLE_MS, MAX_LISTED)
    .all<{ session_id: string; app_id: string; device_label: string | null; created_at: number; last_used_at: number }>();
  return (rows.results ?? []).map((r) => ({ sessionId: r.session_id, appId: r.app_id, deviceLabel: r.device_label, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** Ends one of the member's own sessions; false when it is not theirs or already ended. */
export async function revokeOwnSession(
  db: D1Database,
  actor: { userId: string; sessionId: string; appId: string | null; requestId: string | null },
  now: number,
): Promise<boolean> {
  const owned = await db
    .prepare('SELECT 1 AS present FROM sessions WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(actor.sessionId, actor.userId)
    .first();
  if (!owned) return false;
  await db.batch([
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'revoked_by_member' WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL").bind(now, actor.sessionId, actor.userId),
    auditStatement(db, { actorType: 'user', actorUserId: actor.userId, action: 'account.session_revoked', targetType: 'session', targetId: actor.sessionId, appId: actor.appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return true;
}

/** Ends every session of the member in every Starry App and the web (session_version bump). */
export async function logoutEverywhere(db: D1Database, actor: { userId: string; appId: string | null; requestId: string | null }, now: number): Promise<void> {
  await db.batch([
    db.prepare('UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE user_id = ?').bind(now, actor.userId),
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'logout_all' WHERE user_id = ? AND revoked_at IS NULL").bind(now, actor.userId),
    auditStatement(db, { actorType: 'user', actorUserId: actor.userId, action: 'auth.logout_all', targetType: 'user', targetId: actor.userId, appId: actor.appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
}
