import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../env';
import { errorBody } from '../lib/errors';
import { tooManyRequests, withinLimit } from '../lib/rate-limit';
import { loadSigningKey, verifyAccessToken } from './access-token';

interface SessionRow {
  revoked_at: number | null;
  expires_at: number;
  created_at: number;
  session_version: number;
  user_session_version: number;
  status: 'active' | 'suspended' | 'pending_deletion';
}

/**
 * Requires a valid access token AND a live session (spec S-ID-04, S-ID-05, S-ID-07):
 * revoked sessions, "log out all devices" and suspension take effect immediately,
 * not when the 15-minute access token expires.
 *
 * A member whose deletion is pending (S-ID-06) is disabled: only routes guarded with
 * `allowPendingDeletion` (read own account, cancel deletion, log out) accept them.
 */
function authGuard(options: { allowPendingDeletion: boolean }): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const requestId = c.get('requestId');
    const deny = () => c.json(errorBody('UNAUTHORIZED', 'Sign-in required', requestId), 401);
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
    if (!match?.[1]) return deny();
    const key = await loadSigningKey(c.env);
    if (!key) return c.json(errorBody('AUTH_NOT_CONFIGURED', 'Sign-in is not available', requestId), 503);
    const now = Date.now();
    const claims = await verifyAccessToken(key, c.env, match[1], Math.floor(now / 1000));
    if (!claims) return deny();
    const row = await c.env.DB_IDENTITY.prepare(
      `SELECT s.revoked_at, s.expires_at, s.created_at, s.session_version, u.session_version AS user_session_version, u.status
       FROM sessions s JOIN users u ON u.user_id = s.user_id
       WHERE s.session_id = ? AND s.user_id = ? AND s.app_id = ?`,
    )
      .bind(claims.sid, claims.sub, claims.app_id)
      .first<SessionRow>();
    if (!row || row.revoked_at !== null || row.expires_at <= now) return deny();
    if (row.session_version !== claims.sv || row.user_session_version !== claims.sv) return deny();
    if (row.status === 'suspended') return c.json(errorBody('ACCOUNT_SUSPENDED', 'Account suspended', requestId), 403);
    if (row.status === 'pending_deletion' && !options.allowPendingDeletion) {
      return c.json(errorBody('ACCOUNT_PENDING_DELETION', 'Account deletion is pending; cancel it to continue', requestId), 403);
    }
    if (!(await withinLimit(c, 'RL_API', `user:${claims.sub}`))) return tooManyRequests(c);
    c.set('auth', { userId: claims.sub, sessionId: claims.sid, appId: claims.app_id, status: row.status, sessionCreatedAt: row.created_at });
    await next();
  };
}

/** Active members only. */
export const requireAuth = authGuard({ allowPendingDeletion: false });

/** Also accepts members in the deletion grace period, so they can see their state and cancel. */
export const requireAuthAllowPending = authGuard({ allowPendingDeletion: true });
