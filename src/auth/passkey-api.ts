import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { apiRouter, bearer, errorResponses, json, jsonBody, SignInResponseSchema } from '../api/openapi';
import { passkeyExtraOrigins } from '../apps/passkey-origins';
import { getApp, type AppEntry } from '../apps/registry';
import type { AppBindings } from '../env';
import { consentRequired } from '../identity/members';
import { consumeNonce, issueNonce, NONCE_TTL_MS } from '../identity/nonces';
import { addPasskey, findPasskey, listPasskeys, MAX_PASSKEYS, removePasskey, touchPasskey } from '../identity/passkeys';
import { audit, auditStatement } from '../lib/audit';
import { uuidv7 } from '../lib/crypto';
import { base64urlDecode, base64urlEncode, fromUtf8, utf8 } from '../lib/encoding';
import { boundedString } from '../lib/validate';
import { loadSigningKey } from './access-token';
import { requireAuth } from './middleware';
import { fail, resolveApp } from './routes';
import { issueTokenPair, newRefreshToken, REFRESH_TTL_MS } from './sessions';
import { readClientData, verifyAssertion, verifyRegistration } from './webauthn';

/**
 * Starry Passkeys for Apps (iOS, Android and App web pages). The Passkey belongs to Starry ID: its relying party is
 * Starry ID's own host (e.g. id.starry.phd), so the same Passkey works on the account center and in every App.
 * Apple and Google tie an App to that host through /.well-known/apple-app-site-association and assetlinks.json;
 * App web pages use WebAuthn Related Origin Requests (/.well-known/webauthn).
 */
export const passkeyAuthRoutes = apiRouter();
export const passkeyMeRoutes = apiRouter();

type Ctx = Context<AppBindings>;

function expectedFor(c: Ctx, app: AppEntry) {
  const url = new URL(c.req.url);
  return { origin: url.origin, extraOrigins: passkeyExtraOrigins(app), rpId: url.hostname };
}

async function consumeChallenge(c: Ctx, app: AppEntry, clientDataJSON: string, type: 'webauthn.create' | 'webauthn.get', now: number): Promise<boolean> {
  if (clientDataJSON.length > 4096) return false;
  const data = readClientData(clientDataJSON, type, expectedFor(c, app));
  if (!data) return false;
  let nonce: string;
  try {
    nonce = fromUtf8(base64urlDecode(data.challenge));
  } catch {
    return false;
  }
  return consumeNonce(c.env.DB_IDENTITY, nonce, app.app_id, now);
}

const RequestOptionsSchema = z
  .object({
    publicKey: z.object({
      challenge: z.string(),
      rpId: z.string(),
      userVerification: z.string(),
      timeout: z.number().int(),
      allowCredentials: z.array(z.object({ type: z.string(), id: z.string() })),
    }),
    expires_in: z.number().int(),
  })
  .openapi('PasskeyRequestOptions');

const AssertionFieldsSchema = z.object({
  app_id: z.string().openapi({ example: 'recordnote' }),
  id: z.string().openapi({ description: 'Credential ID, base64url' }),
  clientDataJSON: z.string().openapi({ description: 'base64url' }),
  authenticatorData: z.string().openapi({ description: 'base64url' }),
  signature: z.string().openapi({ description: 'base64url' }),
  device_label: z.string().max(80).optional(),
});

const loginOptionsRoute = createRoute({
  method: 'post',
  path: '/options',
  tags: ['Auth'],
  summary: 'Passkey sign-in step 1: challenge (single use, 10 minutes, bound to the App)',
  request: { body: jsonBody(z.object({ app_id: z.string().openapi({ example: 'recordnote' }) })) },
  responses: { 200: json(RequestOptionsSchema, 'Options for the platform Passkey API (iOS, Android Credential Manager, web navigator.credentials.get)'), ...errorResponses(400, 403, 415, 429) },
});

passkeyAuthRoutes.openapi(loginOptionsRoute, async (c) => {
  const app = await resolveApp(c, c.req.valid('json').app_id);
  if (app === 'unknown') return fail(c, 400, 'APP_NOT_FOUND', 'Unknown app');
  if (app === 'unavailable') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  const nonce = await issueNonce(c.env.DB_IDENTITY, app.app_id, Date.now());
  return c.json(
    {
      publicKey: { challenge: base64urlEncode(utf8(nonce)), rpId: new URL(c.req.url).hostname, userVerification: 'required', timeout: 120000, allowCredentials: [] },
      expires_in: NONCE_TTL_MS / 1000,
    },
    200,
  );
});

const loginRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Auth'],
  summary: 'Passkey sign-in step 2: send the signed assertion, receive tokens',
  request: { body: jsonBody(AssertionFieldsSchema) },
  responses: { 200: json(SignInResponseSchema, 'Signed in'), ...errorResponses(400, 401, 403, 415, 429, 503) },
});

passkeyAuthRoutes.openapi(loginRoute, async (c) => {
  const requestId = c.get('requestId');
  const body = c.req.valid('json');
  const id = boundedString(body.id, 1024) ? body.id : null;
  const authenticatorData = boundedString(body.authenticatorData, 2048) ? body.authenticatorData : null;
  const signature = boundedString(body.signature, 1024) ? body.signature : null;
  const clientDataJSON = boundedString(body.clientDataJSON, 4096) ? body.clientDataJSON : null;
  if (!id || !authenticatorData || !signature || !clientDataJSON) return fail(c, 400, 'BAD_REQUEST', 'id, clientDataJSON, authenticatorData and signature are required');
  const app = await resolveApp(c, body.app_id);
  if (app === 'unknown') return fail(c, 400, 'APP_NOT_FOUND', 'Unknown app');
  if (app === 'unavailable') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  if (!(await loadSigningKey(c.env))) return fail(c, 503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not available');
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const refuse = () => fail(c, 401, 'UNAUTHORIZED', 'Passkey sign-in failed');
  if (!(await consumeChallenge(c, app, clientDataJSON, 'webauthn.get', now))) return refuse();
  const stored = await findPasskey(db, id);
  if (!stored) return refuse();
  const result = await verifyAssertion({ clientDataJSON, authenticatorData, signature }, stored.key, stored.sign_count, expectedFor(c, app));
  if (!result.ok || !(await touchPasskey(db, id, stored.sign_count, result.signCount, now))) return refuse();
  const member = await db.prepare('SELECT status, session_version FROM users WHERE user_id = ?').bind(stored.user_id).first<{ status: string; session_version: number }>();
  if (!member) return refuse();
  if (member.status === 'suspended') {
    await audit(db, { actorType: 'user', actorUserId: stored.user_id, action: 'auth.login.passkey', appId: app.app_id, result: 'denied', requestId, retention: 'security' }, now);
    return fail(c, 403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  }
  const deviceLabel = boundedString(body.device_label, 80) ? body.device_label : null;
  const sessionId = uuidv7(now);
  const refresh = await newRefreshToken(sessionId);
  await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (session_id, user_id, app_id, refresh_token_hash, session_version, device_label, created_at, last_used_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(sessionId, stored.user_id, app.app_id, refresh.hash, member.session_version, deviceLabel, now, now, now + REFRESH_TTL_MS),
    db.prepare('INSERT INTO member_apps (user_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, app_id) DO UPDATE SET last_seen_at = excluded.last_seen_at').bind(stored.user_id, app.app_id, now, now),
    auditStatement(db, { actorType: 'user', actorUserId: stored.user_id, action: 'auth.login.passkey', targetType: 'session', targetId: sessionId, appId: app.app_id, result: 'success', requestId, retention: 'security' }, now),
  ]);
  const tokens = await issueTokenPair(c.env, { userId: stored.user_id, appId: app.app_id, sessionId, sessionVersion: member.session_version, refreshToken: refresh.token }, now);
  return c.json(
    {
      ...tokens,
      user: { user_id: stored.user_id, status: member.status, is_new: false, deletion_purge_at: null },
      consent_required: await consentRequired(db, stored.user_id, c.env.TERMS_VERSION, c.env.PRIVACY_VERSION),
    },
    200,
  );
});

// ---- Adding, listing and removing a member's own Passkeys from inside an App ----

const PasskeyItemSchema = z.object({ id: z.string(), name: z.string(), created_at: z.number().int(), last_used_at: z.number().int().nullable() });

const registerOptionsRoute = createRoute({
  method: 'post',
  path: '/options',
  tags: ['Account'],
  summary: 'Add a Passkey, step 1: creation options (needs a sign-in from the last 10 minutes)',
  security: bearer,
  middleware: [requireAuth] as const,
  responses: {
    200: json(z.object({ publicKey: z.record(z.string(), z.unknown()), expires_in: z.number().int() }).openapi('PasskeyCreationOptions'), 'Options for the platform Passkey API (create)'),
    ...errorResponses(401, 403, 429, 503),
  },
});

passkeyMeRoutes.openapi(registerOptionsRoute, async (c) => {
  const auth = c.get('auth');
  const now = Date.now();
  const app = getApp(auth.appId);
  if (!app) return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  const db = c.env.DB_IDENTITY;
  const [existing, profile] = await Promise.all([listPasskeys(db, auth.userId), db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').bind(auth.userId).first<{ display_name: string | null }>()]);
  const nonce = await issueNonce(db, app.app_id, now);
  const label = profile?.display_name ?? '繁星會員';
  return c.json(
    {
      publicKey: {
        rp: { name: 'Starry', id: new URL(c.req.url).hostname },
        user: { id: base64urlEncode(utf8(auth.userId)), name: label, displayName: label },
        challenge: base64urlEncode(utf8(nonce)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        attestation: 'none',
        timeout: 120000,
        excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.credential_id })),
      },
      expires_in: NONCE_TTL_MS / 1000,
    },
    200,
  );
});

const registerRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Account'],
  summary: 'Add a Passkey, step 2: send the attestation (at most 10 per member)',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { body: jsonBody(z.object({ clientDataJSON: z.string(), attestationObject: z.string(), name: z.string().max(80).optional() })) },
  responses: { 201: json(z.object({ ok: z.literal(true) }), 'Added'), ...errorResponses(400, 401, 403, 409, 415, 429, 503) },
});

passkeyMeRoutes.openapi(registerRoute, async (c) => {
  const auth = c.get('auth');
  const now = Date.now();
  const app = getApp(auth.appId);
  if (!app) return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  const body = c.req.valid('json');
  if (body.attestationObject.length > 8192 || !(await consumeChallenge(c, app, body.clientDataJSON, 'webauthn.create', now))) return fail(c, 400, 'BAD_REQUEST', 'This Passkey request is invalid or expired');
  const registered = await verifyRegistration(body.attestationObject, expectedFor(c, app));
  if (!registered) return fail(c, 400, 'BAD_REQUEST', 'This Passkey cannot be used');
  const added = await addPasskey(c.env.DB_IDENTITY, { userId: auth.userId, credentialId: registered.credentialId, key: registered.key, signCount: registered.signCount, name: body.name ?? '', requestId: c.get('requestId') }, now);
  if (added === 'limit') return fail(c, 409, 'CONFLICT', `At most ${MAX_PASSKEYS} Passkeys`);
  if (added === 'duplicate') return fail(c, 409, 'CONFLICT', 'This Passkey is already registered');
  return c.json({ ok: true as const }, 201);
});

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Account'],
  summary: "The member's Passkeys",
  security: bearer,
  middleware: [requireAuth] as const,
  responses: { 200: json(z.object({ passkeys: z.array(PasskeyItemSchema) }), 'Passkeys'), ...errorResponses(401, 403, 429, 503) },
});

passkeyMeRoutes.openapi(listRoute, async (c) => {
  const rows = await listPasskeys(c.env.DB_IDENTITY, c.get('auth').userId);
  return c.json({ passkeys: rows.map((p) => ({ id: p.credential_id, name: p.name, created_at: p.created_at, last_used_at: p.last_used_at })) }, 200);
});

const removeRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Account'],
  summary: 'Remove one of the member’s Passkeys',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string().max(1024) }) },
  responses: { 204: { description: 'Removed' }, ...errorResponses(401, 403, 404, 429, 503) },
});

passkeyMeRoutes.openapi(removeRoute, async (c) => {
  const auth = c.get('auth');
  const removed = await removePasskey(c.env.DB_IDENTITY, auth.userId, c.req.valid('param').id, c.get('requestId'), Date.now());
  return removed ? c.body(null, 204) : fail(c, 404, 'NOT_FOUND', 'Passkey not found');
});
