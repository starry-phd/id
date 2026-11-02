import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { apiRouter, bearer, errorResponses, json, jsonBody, ProviderRequestSchema, SignInResponseSchema, TokenPairSchema } from '../api/openapi';
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
import { boundedString } from '../lib/validate';
import { loadSigningKey } from './access-token';
import { verifyIdToken, type ProviderIdentity } from './id-token';
import { requireAuthAllowPending } from './middleware';
import type { Provider } from './provider-keys';
import { issueTokenPair, newRefreshToken, parseRefreshToken, REFRESH_TTL_MS } from './sessions';

export const authRoutes = apiRouter();

type Ctx = Context<AppBindings>;

/** Error response with a literal status, so typed OpenAPI routes accept it. */
export function fail<S extends 400 | 401 | 403 | 404 | 409 | 413 | 415 | 428 | 503>(c: Ctx, status: S, code: ErrorCode, message: string) {
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

export interface ProviderRequest {
  idToken: string;
  nonce: string;
  authorizationCode: string | null;
}

/** Reads id_token, nonce and the optional Apple authorization_code; rejects control characters. */
export function readProviderRequest(body: Record<string, unknown> | null | undefined): ProviderRequest | null {
  if (!body || !boundedString(body.id_token, 8192) || !boundedString(body.nonce, 128, 16)) return null;
  const code = boundedString(body.authorization_code, 1024) ? body.authorization_code : null;
  return { idToken: body.id_token, nonce: body.nonce, authorizationCode: code };
}

/**
 * Verifies a provider ID token for `app` and consumes its nonce (spec S-ID-01).
 * Used by sign-in and by linking a second provider (S-ID-02). Returns an error
 * response on any failure without revealing which check failed.
 */
export async function verifyProviderRequest(c: Ctx, provider: Provider, app: AppEntry, request: ProviderRequest, auditAction: string, actorUserId: string | null) {
  const db = c.env.DB_IDENTITY;
  const audiences = audiencesFor(c.env, app, provider);
  if (audiences.length === 0) return { response: fail(c, 503, 'PROVIDER_NOT_CONFIGURED', `${provider} sign-in is not configured for this app`) };
  const now = Date.now();
  const identity: ProviderIdentity | null = await verifyIdToken(c.env, provider, request.idToken, { audiences, nonce: request.nonce, now });
  if (!identity) {
    await audit(db, { actorType: 'user', actorUserId, action: auditAction, appId: app.app_id, result: 'denied', requestId: c.get('requestId'), retention: 'security' }, now);
    return { response: fail(c, 401, 'INVALID_TOKEN', 'Sign-in could not be verified') };
  }
  if (!(await consumeNonce(db, request.nonce, app.app_id, now))) return { response: fail(c, 401, 'INVALID_NONCE', 'Sign-in expired, please try again') };
  return { identity };
}

const nonceRoute = createRoute({
  method: 'post',
  path: '/nonce',
  tags: ['Auth'],
  summary: 'Get a single-use sign-in nonce (10 minutes, bound to the App)',
  request: { body: jsonBody(z.object({ app_id: z.string().openapi({ example: 'echo' }) })) },
  responses: {
    200: json(z.object({ nonce: z.string(), expires_in: z.number().int() }), 'Nonce for the native Apple or Google SDK'),
    ...errorResponses(400, 403, 415, 429),
  },
});

authRoutes.openapi(nonceRoute, async (c) => {
  const { app_id } = c.req.valid('json');
  const app = await resolveApp(c, app_id);
  if (app === 'unknown') return fail(c, 400, 'APP_NOT_FOUND', 'Unknown app');
  if (app === 'unavailable') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  const nonce = await issueNonce(c.env.DB_IDENTITY, app.app_id, Date.now());
  return c.json({ nonce, expires_in: NONCE_TTL_MS / 1000 }, 200);
});

const SignInRequestSchema = ProviderRequestSchema.extend({
  app_id: z.string().openapi({ example: 'echo' }),
  device_label: z.string().max(80).optional(),
});

function signInRoute<P extends Provider>(provider: P) {
  return createRoute({
    method: 'post',
    path: `/${provider}` as `/${P}`,
    tags: ['Auth'],
    summary: `Sign in or sign up with a native ${provider === 'apple' ? 'Sign in with Apple' : 'Google'} ID token`,
    request: { body: jsonBody(SignInRequestSchema) },
    responses: {
      200: json(SignInResponseSchema, 'Signed in'),
      ...errorResponses(400, 401, 403, 415, 429, 503),
    },
  });
}

async function signIn(c: Ctx, provider: Provider, body: z.infer<typeof SignInRequestSchema>) {
  const requestId = c.get('requestId');
  const db = c.env.DB_IDENTITY;
  const request = readProviderRequest(body);
  if (!request) return fail(c, 400, 'BAD_REQUEST', 'id_token, nonce and app_id are required');
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
      .prepare('UPDATE auth_identities SET last_login_at = ?, email = COALESCE(?, email), email_is_private_relay = ? WHERE provider = ? AND subject = ?')
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
  const tokens = await issueTokenPair(c.env, { userId: member.user_id, appId: app.app_id, sessionId, sessionVersion: member.session_version, refreshToken: refresh.token }, now);
  return c.json(
    {
      ...tokens,
      user: {
        user_id: member.user_id,
        status: member.status,
        is_new: isNew,
        deletion_purge_at: member.status === 'pending_deletion' && member.deletion_requested_at !== null ? member.deletion_requested_at + DELETION_GRACE_MS : null,
      },
      consent_required: await consentRequired(db, member.user_id, c.env.TERMS_VERSION, c.env.PRIVACY_VERSION),
    },
    200,
  );
}

/** POST /v1/auth/apple | /v1/auth/google (S-ID-01, S-ID-03). Other providers stay 404. */
authRoutes.openapi(signInRoute('apple'), async (c) => signIn(c, 'apple', c.req.valid('json')));
authRoutes.openapi(signInRoute('google'), async (c) => signIn(c, 'google', c.req.valid('json')));

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

const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags: ['Auth'],
  summary: 'Rotate tokens; reusing an old refresh token revokes the session',
  request: { body: jsonBody(z.object({ refresh_token: z.string() })) },
  responses: {
    200: json(TokenPairSchema, 'New token pair; replace the stored refresh token'),
    ...errorResponses(400, 401, 403, 415, 429, 503),
  },
});

/** POST /v1/auth/refresh — rotates the refresh token; reuse of an old one revokes the session (S-ID-04). */
authRoutes.openapi(refreshRoute, async (c) => {
  const requestId = c.get('requestId');
  const db = c.env.DB_IDENTITY;
  const parsed = parseRefreshToken(c.req.valid('json').refresh_token);
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
  const tokens = await issueTokenPair(c.env, { userId: row.user_id, appId: row.app_id, sessionId: parsed.sessionId, sessionVersion: row.session_version, refreshToken: next.token }, now);
  return c.json(tokens, 200);
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Auth'],
  summary: 'End the current session',
  security: bearer,
  middleware: [requireAuthAllowPending] as const,
  responses: { 204: { description: 'Signed out' }, ...errorResponses(401, 403, 429, 503) },
});

/** POST /v1/auth/logout — ends the current session only (S-ID-05). */
authRoutes.openapi(logoutRoute, async (c) => {
  const auth = c.get('auth');
  const now = Date.now();
  const db = c.env.DB_IDENTITY;
  await db.batch([
    db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'logout' WHERE session_id = ? AND revoked_at IS NULL").bind(now, auth.sessionId),
    auditStatement(db, { actorType: 'user', actorUserId: auth.userId, action: 'auth.logout', targetType: 'session', targetId: auth.sessionId, appId: auth.appId, result: 'success', requestId: c.get('requestId'), retention: 'security' }, now),
  ]);
  return c.body(null, 204);
});

const logoutAllRoute = createRoute({
  method: 'post',
  path: '/logout-all',
  tags: ['Auth'],
  summary: 'End every session of the member in every Starry App',
  security: bearer,
  middleware: [requireAuthAllowPending] as const,
  responses: { 204: { description: 'All sessions ended' }, ...errorResponses(401, 403, 429, 503) },
});

/** POST /v1/auth/logout-all — invalidates every session of the member in every Starry App (S-ID-05). */
authRoutes.openapi(logoutAllRoute, async (c) => {
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
