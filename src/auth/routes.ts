import { Hono, type Context } from 'hono';
import { audiencesFor, getApp, type AppEntry } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import type { AppBindings } from '../env';
import { rememberAppleToken } from '../identity/apple';
import { DELETION_GRACE_MS } from '../identity/lifecycle';
import { consentRequired, findOrCreateMember } from '../identity/members';
import { consumeNonce, issueNonce, NONCE_TTL_MS } from '../identity/nonces';
import { WEB_APP_ID } from '../identity/web-sessions';
import { audit, auditStatement } from '../lib/audit';
import { constantTimeEqual, sha256Hex, uuidv7 } from '../lib/crypto';
import { errorBody, type ErrorCode } from '../lib/errors';
import { boundedString, readJsonObject } from '../lib/validate';
import { loadSigningKey } from './access-token';
import { verifyIdToken, type ProviderIdentity } from './id-token';
import { requireAuthAllowPending } from './middleware';
import type { Provider } from './provider-keys';
import { issueTokenPair, newRefreshToken, parseRefreshToken, REFRESH_TTL_MS } from './sessions';

export const authRoutes = new Hono<AppBindings>();

type Ctx = Context<AppBindings>;

function fail(c: Ctx, status: 400 | 401 | 403 | 409 | 503, code: ErrorCode, message: string) {
  return c.json(errorBody(code, message, c.get('requestId')), status);
}

/**
 * The App a request names, with its runtime status (config default or Admin override).
 * The web account center's app_id is reserved for cookie sessions and never valid here.
 */
export async function resolveApp(c: Ctx, appId: unknown): Promise<AppEntry | 'unknown' | 'unavailable'> {
  if (typeof appId !== 'string' || appId === WEB_APP_ID) return 'unknown';
  const app = getApp(appId);
  if (!app) return 'unknown';
  const effective = await withEffectiveStatus(c.env.DB_IDENTITY, app, Date.now());
  return effective.status === 'active' ? effective : 'unavailable';
}

/** Runs work after the response when the runtime allows it (Apple code exchange). */
export function background(c: Ctx, work: Promise<unknown>): Promise<unknown> | undefined {
  const guarded = work.catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', request_id: c.get('requestId'), message: error instanceof Error ? error.message : 'background task failed' }));
  });
  try {
    c.executionCtx.waitUntil(guarded);
    return undefined;
  } catch {
    return guarded;
  }
}

/** POST /v1/auth/nonce — single-use nonce the App hands to Apple or Google. */
authRoutes.post('/nonce', async (c) => {
  const body = await readJsonObject(c);
  const app = await resolveApp(c, body?.app_id);
  if (app === 'unknown') return fail(c, 400, 'APP_NOT_FOUND', 'Unknown app');
  if (app === 'unavailable') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  const nonce = await issueNonce(c.env.DB_IDENTITY, app.app_id, Date.now());
  return c.json({ nonce, expires_in: NONCE_TTL_MS / 1000 });
});

export interface ProviderRequest {
  idToken: string;
  nonce: string;
  authorizationCode: string | null;
}

/** Reads id_token, nonce and the optional Apple authorization_code from a JSON body. */
export function readProviderRequest(body: Record<string, unknown> | null): ProviderRequest | null {
  if (!body || !boundedString(body.id_token, 8192) || !boundedString(body.nonce, 128, 16)) return null;
  const code = boundedString(body.authorization_code, 1024) ? body.authorization_code : null;
  return { idToken: body.id_token, nonce: body.nonce, authorizationCode: code };
}

/**
 * Verifies a provider ID token for `app` and consumes its nonce (spec S-ID-01).
 * Used by sign-in and by linking a second provider (S-ID-02). Returns an error
 * response on any failure without revealing which check failed.
 */
export async function verifyProviderRequest(
  c: Ctx,
  provider: Provider,
  app: AppEntry,
  request: ProviderRequest,
  auditAction: string,
  actorUserId: string | null,
): Promise<{ identity: ProviderIdentity } | { response: Response }> {
  const db = c.env.DB_IDENTITY;
  const audiences = audiencesFor(c.env, app, provider);
  if (audiences.length === 0) return { response: fail(c, 503, 'PROVIDER_NOT_CONFIGURED', `${provider} sign-in is not configured for this app`) };
  const now = Date.now();
  const identity = await verifyIdToken(c.env, provider, request.idToken, { audiences, nonce: request.nonce, now });
  if (!identity) {
    await audit(db, { actorType: 'user', actorUserId, action: auditAction, appId: app.app_id, result: 'denied', requestId: c.get('requestId'), retention: 'security' }, now);
    return { response: fail(c, 401, 'INVALID_TOKEN', 'Sign-in could not be verified') };
  }
  if (!(await consumeNonce(db, request.nonce, app.app_id, now))) return { response: fail(c, 401, 'INVALID_NONCE', 'Sign-in expired, please try again') };
  return { identity };
}

/** POST /v1/auth/apple | /v1/auth/google — sign in or sign up with a native ID token (S-ID-01, S-ID-03). */
authRoutes.post('/:provider{apple|google}', async (c) => {
  const provider = c.req.param('provider') as Provider;
  const requestId = c.get('requestId');
  const db = c.env.DB_IDENTITY;
  const body = await readJsonObject(c);
  const request = readProviderRequest(body);
  if (!body || !request) return fail(c, 400, 'BAD_REQUEST', 'id_token, nonce and app_id are required');
  const deviceLabel = boundedString(body.device_label, 80) ? body.device_label : null;
  const app = await resolveApp(c, body.app_id);
  if (app === 'unknown') return fail(c, 400, 'APP_NOT_FOUND', 'Unknown app');
  if (app === 'unavailable') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  if (!(await loadSigningKey(c.env))) return fail(c, 503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not available');
  const verified = await verifyProviderRequest(c, provider, app, request, `auth.login.${provider}`, null);
  if ('response' in verified) return verified.response;
  const { identity } = verified;

  const now = Date.now();
  const { member, isNew } = await findOrCreateMember(db, identity, { appId: app.app_id, requestId }, now);
  if (member.status === 'suspended') {
    await audit(db, { actorType: 'user', actorUserId: member.user_id, action: `auth.login.${provider}`, appId: app.app_id, result: 'denied', requestId, retention: 'security' }, now);
    return fail(c, 403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  }

  const sessionId = uuidv7(now);
  const refresh = await newRefreshToken(sessionId);
  await db.batch([
    db
      .prepare(
        'UPDATE auth_identities SET last_login_at = ?, email = COALESCE(?, email), email_is_private_relay = ? WHERE provider = ? AND subject = ?',
      )
      .bind(now, identity.email, identity.isPrivateRelay ? 1 : 0, provider, identity.subject),
    db
      .prepare(
        `INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, device_label, created_at, last_used_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(sessionId, member.user_id, app.app_id, refresh.hash, member.session_version, deviceLabel, now, now, now + REFRESH_TTL_MS),
    auditStatement(db, { actorType: 'user', actorUserId: member.user_id, action: `auth.login.${provider}`, targetType: 'session', targetId: sessionId, appId: app.app_id, result: 'success', requestId, retention: 'security' }, now),
  ]);
  if (provider === 'apple' && request.authorizationCode) {
    const pending = background(
      c,
      rememberAppleToken(db, c.env, (url, init) => fetch(url, init), { userId: member.user_id, subject: identity.subject, clientId: identity.audience, code: request.authorizationCode, appId: app.app_id, requestId }, now),
    );
    if (pending) await pending;
  }
  const tokens = await issueTokenPair(
    c.env,
    { userId: member.user_id, appId: app.app_id, sessionId, sessionVersion: member.session_version, refreshToken: refresh.token },
    now,
  );
  return c.json({
    ...tokens,
    user: {
      user_id: member.user_id,
      status: member.status,
      is_new: isNew,
      deletion_purge_at: member.status === 'pending_deletion' && member.deletion_requested_at !== null ? member.deletion_requested_at + DELETION_GRACE_MS : null,
    },
    consent_required: await consentRequired(db, member.user_id, c.env.TERMS_VERSION, c.env.PRIVACY_VERSION),
  });
});

interface RefreshRow {
  user_id: string;
  app_id: string;
  refresh_token_hash: string;
  previous_refresh_token_hash: string | null;
  session_version: number;
  expires_at: number;
  revoked_at: number | null;
  user_session_version: number;
  status: 'active' | 'suspended' | 'pending_deletion';
}

/** POST /v1/auth/refresh — rotates the refresh token; reuse of an old one revokes the session (S-ID-04). */
authRoutes.post('/refresh', async (c) => {
  const requestId = c.get('requestId');
  const db = c.env.DB_IDENTITY;
  const parsed = parseRefreshToken((await readJsonObject(c))?.refresh_token);
  if (!parsed) return fail(c, 401, 'INVALID_REFRESH', 'Please sign in again');
  if (!(await loadSigningKey(c.env))) return fail(c, 503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not available');
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT s.user_id, s.app_id, s.refresh_token_hash, s.previous_refresh_token_hash, s.session_version, s.expires_at, s.revoked_at,
              u.session_version AS user_session_version, u.status
       FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.session_id = ?`,
    )
    .bind(parsed.sessionId)
    .first<RefreshRow>();
  // Web account center cookie sessions are never accepted as App refresh tokens.
  if (!row || row.app_id === WEB_APP_ID || row.revoked_at !== null || row.expires_at <= now || row.session_version !== row.user_session_version) {
    return fail(c, 401, 'INVALID_REFRESH', 'Please sign in again');
  }
  const hash = await sha256Hex(parsed.secret);
  if (row.previous_refresh_token_hash && constantTimeEqual(hash, row.previous_refresh_token_hash)) {
    await db.batch([
      db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'refresh_reuse' WHERE session_id = ? AND revoked_at IS NULL").bind(now, parsed.sessionId),
      auditStatement(db, { actorType: 'system', actorUserId: row.user_id, action: 'auth.refresh_reuse', targetType: 'session', targetId: parsed.sessionId, appId: row.app_id, result: 'denied', requestId, retention: 'security' }, now),
    ]);
    return fail(c, 401, 'REFRESH_REUSED', 'Please sign in again');
  }
  if (!constantTimeEqual(hash, row.refresh_token_hash)) return fail(c, 401, 'INVALID_REFRESH', 'Please sign in again');
  if (row.status === 'suspended') return fail(c, 403, 'ACCOUNT_SUSPENDED', 'Account suspended');

  const next = await newRefreshToken(parsed.sessionId);
  const rotated = await db
    .prepare(
      `UPDATE sessions SET previous_refresh_token_hash = refresh_token_hash, refresh_token_hash = ?, last_used_at = ?, expires_at = ?
       WHERE session_id = ? AND refresh_token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(next.hash, now, now + REFRESH_TTL_MS, parsed.sessionId, row.refresh_token_hash)
    .run();
  if (rotated.meta.changes !== 1) return fail(c, 401, 'INVALID_REFRESH', 'Please sign in again');
  const tokens = await issueTokenPair(
    c.env,
    { userId: row.user_id, appId: row.app_id, sessionId: parsed.sessionId, sessionVersion: row.session_version, refreshToken: next.token },
    now,
  );
  return c.json(tokens);
});

/** POST /v1/auth/logout — ends the current session only (S-ID-05). */
authRoutes.post('/logout', requireAuthAllowPending, async (c) => {
  const auth = c.get('auth');
  const now = Date.now();
  const db = c.env.DB_IDENTITY;
  await db.batch([
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'logout' WHERE session_id = ? AND revoked_at IS NULL").bind(now, auth.sessionId),
    auditStatement(db, { actorType: 'user', actorUserId: auth.userId, action: 'auth.logout', targetType: 'session', targetId: auth.sessionId, appId: auth.appId, result: 'success', requestId: c.get('requestId'), retention: 'security' }, now),
  ]);
  return c.body(null, 204);
});

/** POST /v1/auth/logout-all — invalidates every session of the member in every Starry App (S-ID-05). */
authRoutes.post('/logout-all', requireAuthAllowPending, async (c) => {
  const auth = c.get('auth');
  const now = Date.now();
  const db = c.env.DB_IDENTITY;
  await db.batch([
    db.prepare('UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE user_id = ?').bind(now, auth.userId),
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'logout_all' WHERE user_id = ? AND revoked_at IS NULL").bind(now, auth.userId),
    auditStatement(db, { actorType: 'user', actorUserId: auth.userId, action: 'auth.logout_all', targetType: 'user', targetId: auth.userId, appId: auth.appId, result: 'success', requestId: c.get('requestId'), retention: 'security' }, now),
  ]);
  return c.body(null, 204);
});
