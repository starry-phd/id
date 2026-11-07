import { createRoute, z } from '@hono/zod-openapi';
import { apiRouter, bearer, errorResponses, json, jsonBody, SignInResponseSchema } from '../api/openapi';
import { consentRequired } from '../identity/members';
import { auditStatement } from '../lib/audit';
import { constantTimeEqual, randomToken, sha256Hex, uuidv7 } from '../lib/crypto';
import { boundedString } from '../lib/validate';
import { loadSigningKey } from './access-token';
import { requireAuth } from './middleware';
import type { Context } from 'hono';
import type { AppEntry } from '../apps/registry';
import type { AppBindings } from '../env';
import { open as unseal, seal } from '../lib/sealed';
import { consumeNonce } from '../identity/nonces';
import { fail, resolveApp } from './routes';
import { issueTokenPair, newRefreshToken, parseRefreshToken, REFRESH_TTL_MS } from './sessions';

/**
 * Device single sign-on. After a member signs in to any App, that App calls /sso/start and keeps the returned
 * sso_token in storage shared by all Starry Apps on the device (iOS keychain group, Android shared account).
 * Other Apps read it, call /sso/exchange to get their own session, and call /sso/status when they come to the
 * foreground to notice a switch of member or a sign-out. Signing out or switching revokes the sso record and
 * every session created from it, so every App follows.
 */
export const ssoRoutes = apiRouter();
type Ctx = Context<AppBindings>;

const SsoTokenBody = z.object({ sso_token: z.string() });
const NO_USER = { 'Cache-Control': 'no-store' };

export interface SsoRow {
  sso_id: string;
  user_id: string;
  token_hash: string;
  session_version: number;
  expires_at: number;
  revoked_at: number | null;
  user_session_version: number;
  status: 'active' | 'suspended';
}

/** The live sso record for a token, or null when it is unknown, revoked, expired or from before a logout-all. */
export async function liveSso(db: D1Database, token: unknown, now: number): Promise<SsoRow | null> {
  const parsed = parseRefreshToken(token);
  if (!parsed) return null;
  const row = await liveSsoById(db, parsed.sessionId, now);
  if (!row) return null;
  return constantTimeEqual(await sha256Hex(parsed.secret), row.token_hash) ? row : null;
}

/** The live sso record for an id (the caller has already proven it holds the secret, e.g. through a sealed code). */
export async function liveSsoById(db: D1Database, ssoId: string, now: number): Promise<SsoRow | null> {
  const row = await db
    .prepare(
      `SELECT d.sso_id, d.user_id, d.token_hash, d.session_version, d.expires_at, d.revoked_at, u.session_version AS user_session_version, u.status
       FROM device_sso d JOIN users u ON u.user_id = d.user_id WHERE d.sso_id = ?`,
    )
    .bind(ssoId)
    .first<SsoRow>();
  return !row || row.revoked_at !== null || row.expires_at <= now || row.session_version !== row.user_session_version ? null : row;
}

export function revokeSso(db: D1Database, ssoId: string, now: number, reason: string): D1PreparedStatement[] {
  return [
    db.prepare('UPDATE device_sso SET revoked_at = ? WHERE sso_id = ? AND revoked_at IS NULL').bind(now, ssoId),
    db.prepare('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE sso_id = ? AND revoked_at IS NULL').bind(now, reason, ssoId),
  ];
}

const startRoute = createRoute({
  method: 'post',
  path: '/start',
  tags: ['Auth'],
  summary: 'After signing in: create the device sign-on token to share with the other Starry Apps',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { body: jsonBody(z.object({ previous_sso_token: z.string().optional() })) },
  responses: { 200: json(z.object({ sso_token: z.string() }), 'Store this in the shared keychain'), ...errorResponses(400, 401, 403, 415, 429, 503) },
});

/** POST /v1/auth/sso/start — creates the device record for the signed-in member; an older one on this device (another member) is ended. */
ssoRoutes.openapi(startRoute, async (c) => {
  const auth = c.get('auth');
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const previous = await liveSso(db, c.req.valid('json').previous_sso_token, now);
  const user = await db.prepare('SELECT session_version FROM users WHERE user_id = ?').bind(auth.userId).first<{ session_version: number }>();
  if (!user) return fail(c, 401, 'UNAUTHORIZED', 'Sign in again');
  const ssoId = uuidv7(now);
  const secret = randomToken(32);
  const statements: D1PreparedStatement[] = [];
  // The same member on the same device keeps their other Apps signed in: only another member's record is ended.
  if (previous && previous.user_id !== auth.userId) statements.push(...revokeSso(db, previous.sso_id, now, 'sso_switch'));
  else if (previous) statements.push(db.prepare('UPDATE device_sso SET revoked_at = ? WHERE sso_id = ? AND revoked_at IS NULL').bind(now, previous.sso_id), db.prepare('UPDATE sessions SET sso_id = ? WHERE sso_id = ?').bind(ssoId, previous.sso_id));
  statements.push(
    db.prepare('INSERT INTO device_sso (sso_id, user_id, token_hash, session_version, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(ssoId, auth.userId, await sha256Hex(secret), user.session_version, now, now, now + REFRESH_TTL_MS),
    db.prepare('UPDATE sessions SET sso_id = ? WHERE session_id = ? AND user_id = ?').bind(ssoId, auth.sessionId, auth.userId),
    auditStatement(db, { actorType: 'user', actorUserId: auth.userId, action: 'auth.sso_start', targetType: 'session', targetId: ssoId, appId: auth.appId, result: 'success', requestId: c.get('requestId'), retention: 'security' }, now),
  );
  await db.batch(statements);
  return c.json({ sso_token: `${ssoId}.${secret}` }, 200, NO_USER);
});

/** Gives `app` its own session for the member of a live sso record. */
async function signInFromSso(c: Ctx, sso: SsoRow, app: AppEntry, label: unknown) {
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  if (sso.status === 'suspended') return fail(c, 403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  const deviceLabel = boundedString(label, 80) ? label : null;
  const sessionId = uuidv7(now);
  const refresh = await newRefreshToken(sessionId);
  await db.batch([
    db
      .prepare('INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, device_label, created_at, last_used_at, expires_at, sso_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(sessionId, sso.user_id, app.app_id, refresh.hash, sso.session_version, deviceLabel, now, now, now + REFRESH_TTL_MS, sso.sso_id),
    db.prepare('INSERT INTO member_apps (user_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, app_id) DO UPDATE SET last_seen_at = excluded.last_seen_at').bind(sso.user_id, app.app_id, now, now),
    db.prepare('UPDATE device_sso SET last_used_at = ?, expires_at = ? WHERE sso_id = ?').bind(now, now + REFRESH_TTL_MS, sso.sso_id),
    auditStatement(db, { actorType: 'user', actorUserId: sso.user_id, action: 'auth.login.sso', targetType: 'session', targetId: sessionId, appId: app.app_id, result: 'success', requestId: c.get('requestId'), retention: 'security' }, now),
  ]);
  const tokens = await issueTokenPair(c.env, { userId: sso.user_id, appId: app.app_id, sessionId, sessionVersion: sso.session_version, refreshToken: refresh.token }, now);
  return c.json({ ...tokens, user: { user_id: sso.user_id, status: sso.status, is_new: false, deletion_purge_at: null }, consent_required: await consentRequired(db, sso.user_id, c.env.TERMS_VERSION, c.env.PRIVACY_VERSION) }, 200, NO_USER);
}

const exchangeRoute = createRoute({
  method: 'post',
  path: '/exchange',
  tags: ['Auth'],
  summary: 'Sign in to this App with the device sign-on token from another Starry App',
  request: { body: jsonBody(z.object({ app_id: z.string(), sso_token: z.string(), device_label: z.string().optional() })) },
  responses: { 200: json(SignInResponseSchema, 'Signed in as the same member'), ...errorResponses(400, 401, 403, 415, 429, 503) },
});

/** POST /v1/auth/sso/exchange — gives this App its own session for the member on this device. */
ssoRoutes.openapi(exchangeRoute, async (c) => {
  const body = c.req.valid('json');
  const db = c.env.DB_IDENTITY;
  const app = await resolveApp(c, body.app_id);
  if (app === 'unknown') return fail(c, 400, 'APP_NOT_FOUND', 'Unknown app');
  if (app === 'unavailable') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  if (!(await loadSigningKey(c.env))) return fail(c, 503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not available');
  const now = Date.now();
  const sso = await liveSso(db, body.sso_token, now);
  if (!sso) return fail(c, 401, 'INVALID_REFRESH', 'Please sign in again');
  return signInFromSso(c, sso, app, body.device_label);
});

const statusRoute = createRoute({
  method: 'post',
  path: '/status',
  tags: ['Auth'],
  summary: 'Who is signed in on this device (call when the App comes to the foreground)',
  request: { body: jsonBody(SsoTokenBody) },
  responses: { 200: json(z.object({ active: z.boolean(), user_id: z.string().nullable() }), 'active=false: the device was signed out'), ...errorResponses(400, 415, 429) },
});

/** POST /v1/auth/sso/status — lets an App notice a member switch or a sign-out done in another App. */
ssoRoutes.openapi(statusRoute, async (c) => {
  const now = Date.now();
  const sso = await liveSso(c.env.DB_IDENTITY, c.req.valid('json').sso_token, now);
  return c.json({ active: sso !== null && sso.status === 'active', user_id: sso && sso.status === 'active' ? sso.user_id : null }, 200, NO_USER);
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Auth'],
  summary: 'Sign out of every Starry App on this device',
  request: { body: jsonBody(SsoTokenBody) },
  responses: { 204: { description: 'Signed out everywhere on this device' }, ...errorResponses(400, 415, 429) },
});

/** POST /v1/auth/sso/logout — ends the device record and every App session created from it. Idempotent. */
ssoRoutes.openapi(logoutRoute, async (c) => {
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const sso = await liveSso(db, c.req.valid('json').sso_token, now);
  if (sso) {
    await db.batch([
      ...revokeSso(db, sso.sso_id, now, 'sso_logout'),
      auditStatement(db, { actorType: 'user', actorUserId: sso.user_id, action: 'auth.sso_logout', targetType: 'session', targetId: sso.sso_id, appId: null, result: 'success', requestId: c.get('requestId'), retention: 'security' }, now),
    ]);
  }
  return c.body(null, 204);
});

export const SSO_WEB_CODE_CONTEXT = 'sso-web-code-v1';
export const SSO_WEB_CHECK_CONTEXT = 'sso-web-check-v1';
export const SSO_CODE_TTL_MS = 2 * 60 * 1000;

const webCodeRoute = createRoute({
  method: 'post',
  path: '/web-code',
  tags: ['Auth'],
  summary: 'Web Apps: a short-lived code that lets id.starry.phd remember this browser as signed in',
  request: { body: jsonBody(SsoTokenBody) },
  responses: { 200: json(z.object({ code: z.string() }), 'Send the browser to /auth/sso/adopt?c=<code>'), ...errorResponses(400, 401, 415, 429, 503) },
});

/** POST /v1/auth/sso/web-code — seals the device token for 2 minutes so it can travel in a URL to id.starry.phd. */
ssoRoutes.openapi(webCodeRoute, async (c) => {
  const now = Date.now();
  const key = c.env.DATA_ENCRYPTION_KEY;
  const body = c.req.valid('json');
  if (!(await liveSso(c.env.DB_IDENTITY, body.sso_token, now))) return fail(c, 401, 'INVALID_REFRESH', 'Please sign in again');
  const code = key ? await seal(key, SSO_WEB_CODE_CONTEXT, JSON.stringify({ t: body.sso_token, exp: now + SSO_CODE_TTL_MS })) : null;
  return code ? c.json({ code }, 200, NO_USER) : fail(c, 503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not available');
});

const webExchangeRoute = createRoute({
  method: 'post',
  path: '/web-exchange',
  tags: ['Auth'],
  summary: 'Web Apps: sign in with the code the browser got from /auth/sso/check',
  request: { body: jsonBody(z.object({ app_id: z.string(), code: z.string(), nonce: z.string(), device_label: z.string().optional() })) },
  responses: { 200: json(SignInResponseSchema, 'Signed in as the member of this browser'), ...errorResponses(400, 401, 403, 415, 429, 503) },
});

/** POST /v1/auth/sso/web-exchange — the code is bound to the App and to a nonce only this App instance knows. */
ssoRoutes.openapi(webExchangeRoute, async (c) => {
  const body = c.req.valid('json');
  const db = c.env.DB_IDENTITY;
  const app = await resolveApp(c, body.app_id);
  if (app === 'unknown') return fail(c, 400, 'APP_NOT_FOUND', 'Unknown app');
  if (app === 'unavailable') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  if (!(await loadSigningKey(c.env))) return fail(c, 503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not available');
  const key = c.env.DATA_ENCRYPTION_KEY;
  const now = Date.now();
  interface CheckClaims {
    sid?: string;
    app?: string;
    nh?: string;
    exp?: number;
  }
  let claims: CheckClaims | null;
  try {
    const opened = key && body.code.length <= 1024 ? await unseal(key, SSO_WEB_CHECK_CONTEXT, body.code) : null;
    claims = opened ? (JSON.parse(opened) as CheckClaims) : null;
  } catch {
    claims = null;
  }
  if (!claims || claims.app !== app.app_id || typeof claims.sid !== 'string' || typeof claims.exp !== 'number' || claims.exp <= now || claims.nh !== (await sha256Hex(body.nonce))) {
    return fail(c, 401, 'INVALID_REFRESH', 'Please sign in again');
  }
  if (!(await consumeNonce(db, body.nonce, app.app_id, now))) return fail(c, 401, 'INVALID_NONCE', 'Sign-in expired, please try again');
  const sso = await liveSsoById(db, claims.sid, now);
  if (!sso) return fail(c, 401, 'INVALID_REFRESH', 'Please sign in again');
  return signInFromSso(c, sso, app, body.device_label);
});
