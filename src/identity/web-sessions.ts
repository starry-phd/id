import { parseRefreshToken } from '../auth/sessions';
import { auditStatement } from '../lib/audit';
import { constantTimeEqual, randomToken, sha256Hex, uuidv7 } from '../lib/crypto';

/**
 * Cookie sessions for the web account center and Admin Lite. They live in the same
 * sessions table under the reserved app_id "account", so logout-all, suspension and
 * deletion end them exactly like App sessions. The cookie holds "<session_id>.<secret>";
 * only SHA-256(secret) is stored. These sessions can never be used as App refresh tokens.
 */
export const WEB_APP_ID = 'account';
export const WEB_SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const WEB_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface WebSession {
  sessionId: string;
  userId: string;
  status: 'active';
  createdAt: number;
}

export async function createWebSession(
  db: D1Database,
  input: { userId: string; sessionVersion: number; provider: string; deviceLabel: string | null; requestId: string | null },
  now: number,
): Promise<{ cookieValue: string; sessionId: string }> {
  const sessionId = uuidv7(now);
  const secret = randomToken(32);
  await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, device_label, created_at, last_used_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(sessionId, input.userId, WEB_APP_ID, await sha256Hex(secret), input.sessionVersion, input.deviceLabel, now, now, now + WEB_SESSION_ABSOLUTE_MS),
    auditStatement(db, { actorType: 'user', actorUserId: input.userId, action: `web.login.${input.provider}`, targetType: 'session', targetId: sessionId, appId: WEB_APP_ID, result: 'success', requestId: input.requestId, retention: 'security' }, now),
  ]);
  return { cookieValue: `${sessionId}.${secret}`, sessionId };
}

/** Validates the cookie against D1; suspended members and ended sessions get null. */
export async function readWebSession(db: D1Database, cookieValue: string | undefined, now: number): Promise<WebSession | null> {
  const parsed = parseRefreshToken(cookieValue);
  if (!parsed) return null;
  const row = await db
    .prepare(
      `SELECT s.user_id, s.app_id, s.refresh_token_hash, s.session_version, s.created_at, s.last_used_at, s.expires_at, s.revoked_at,
              u.session_version AS user_session_version, u.status
       FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.session_id = ?`,
    )
    .bind(parsed.sessionId)
    .first<{
      user_id: string;
      app_id: string;
      refresh_token_hash: string;
      session_version: number;
      created_at: number;
      last_used_at: number;
      expires_at: number;
      revoked_at: number | null;
      user_session_version: number;
      status: 'active' | 'suspended';
    }>();
  if (!row || row.app_id !== WEB_APP_ID || row.revoked_at !== null || row.expires_at <= now) return null;
  if (now - row.last_used_at > WEB_SESSION_IDLE_MS || row.session_version !== row.user_session_version || row.status === 'suspended') return null;
  if (!constantTimeEqual(await sha256Hex(parsed.secret), row.refresh_token_hash)) return null;
  if (now - row.last_used_at > TOUCH_INTERVAL_MS) {
    await db.prepare('UPDATE sessions SET last_used_at = ? WHERE session_id = ?').bind(now, parsed.sessionId).run();
  }
  return { sessionId: parsed.sessionId, userId: row.user_id, status: row.status, createdAt: row.created_at };
}

export async function endWebSession(db: D1Database, session: { sessionId: string; userId: string; requestId: string | null }, now: number): Promise<void> {
  await db.batch([
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'logout' WHERE session_id = ? AND revoked_at IS NULL").bind(now, session.sessionId),
    auditStatement(db, { actorType: 'user', actorUserId: session.userId, action: 'web.logout', targetType: 'session', targetId: session.sessionId, appId: WEB_APP_ID, result: 'success', requestId: session.requestId, retention: 'security' }, now),
  ]);
}
