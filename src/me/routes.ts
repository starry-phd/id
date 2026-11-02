import { createRoute, z } from '@hono/zod-openapi';
import {
  apiRouter, bearer, EntitlementsSchema, errorResponses, json, jsonBody, MeSchema, NotificationPreferencesSchema,
  ProfileResponseSchema, ProviderRequestSchema, VersionConflictSchema,
} from '../api/openapi';
import { getApp } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import { requireAuth, requireAuthAllowPending } from '../auth/middleware';
import type { Provider } from '../auth/provider-keys';
import { background, fail, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import { activeEntitlements } from '../billing/revenuecat';
import type { AppBindings } from '../env';
import { rememberAppleToken } from '../identity/apple';
import { MAX_AVATAR_BYTES, r2Store, removeAvatar, setAvatar, signedAvatarPath } from '../identity/avatars';
import { cancelDeletion, DELETION_GRACE_MS, requestDeletion } from '../identity/lifecycle';
import { linkIdentity } from '../identity/link';
import { acceptConsents } from '../identity/members';
import { auditStatement } from '../lib/audit';
import { errorBody } from '../lib/errors';
import { boundedString, isBirthday, isLocale } from '../lib/validate';
import { getPreferences, isCategory, isPushToken, registerPushToken, setPreferences, unregisterPushToken } from '../notify/push';
import type { Context } from 'hono';

export const meRoutes = apiRouter();

interface ProfileRow {
  display_name: string | null;
  avatar_key: string | null;
  birthday: string | null;
  locale: string;
  version: number;
  updated_at: number;
}

const PROFILE_SQL = 'SELECT display_name, avatar_key, birthday, locale, version, updated_at FROM profiles WHERE user_id = ?';

/** avatar_url is a signed path valid for one hour (S-ID-08); null without an avatar or signing key. */
async function profileJson(env: { DATA_ENCRYPTION_KEY?: string }, p: ProfileRow) {
  const avatarUrl = p.avatar_key && env.DATA_ENCRYPTION_KEY ? await signedAvatarPath(env.DATA_ENCRYPTION_KEY, p.avatar_key, Date.now()) : null;
  return { display_name: p.display_name, avatar_url: avatarUrl, birthday: p.birthday, locale: p.locale, version: p.version, updated_at: p.updated_at };
}

const meRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Account'],
  summary: 'The signed-in member: profile, sign-in methods, consent and deletion state',
  description: 'Also available while deletion is pending, so the App can offer to cancel it.',
  security: bearer,
  middleware: [requireAuthAllowPending] as const,
  responses: { 200: json(MeSchema, 'Member'), ...errorResponses(401, 403, 404, 429, 503) },
});

/** GET /v1/me — the signed-in member, profile, linked providers and consent state. */
meRoutes.openapi(meRoute, async (c) => {
  const { userId } = c.get('auth');
  const db = c.env.DB_IDENTITY;
  const [user, profile, identities, consents] = await db.batch([
    db.prepare('SELECT user_id, status, created_at, deletion_requested_at FROM users WHERE user_id = ?').bind(userId),
    db.prepare(PROFILE_SQL).bind(userId),
    db.prepare('SELECT provider, email, email_is_private_relay FROM auth_identities WHERE user_id = ? ORDER BY provider').bind(userId),
    db.prepare('SELECT document, version FROM consents WHERE user_id = ? AND withdrawn_at IS NULL').bind(userId),
  ]);
  const u = user?.results[0] as { user_id: string; status: string; created_at: number; deletion_requested_at: number | null } | undefined;
  const p = profile?.results[0] as ProfileRow | undefined;
  if (!u || !p) return fail(c, 404, 'NOT_FOUND', 'Member not found');
  const accepted = (consents?.results ?? []) as { document: string; version: string }[];
  const has = (doc: string, version: string) => accepted.some((r) => r.document === doc && r.version === version);
  c.header('etag', `"${p.version}"`);
  return c.json(
    {
      user_id: u.user_id,
      status: u.status,
      created_at: u.created_at,
      deletion_requested_at: u.deletion_requested_at,
      deletion_purge_at: u.deletion_requested_at === null ? null : u.deletion_requested_at + DELETION_GRACE_MS,
      profile: await profileJson(c.env, p),
      identities: ((identities?.results ?? []) as { provider: string; email: string | null; email_is_private_relay: number }[]).map((i) => ({
        provider: i.provider,
        email: i.email,
        email_is_private_relay: i.email_is_private_relay === 1,
      })),
      consent: {
        terms_version: c.env.TERMS_VERSION,
        privacy_version: c.env.PRIVACY_VERSION,
        required: !(has('terms', c.env.TERMS_VERSION) && has('privacy', c.env.PRIVACY_VERSION)),
      },
    },
    200,
  );
});

const ProfilePatchSchema = z
  .object({
    display_name: z.string().nullable().optional().openapi({ description: '1-50 characters, or null to clear' }),
    birthday: z.string().nullable().optional().openapi({ description: 'YYYY-MM-DD, or null to clear' }),
    locale: z.string().optional().openapi({ example: 'zh-TW' }),
  })
  .strict();

const profileRoute = createRoute({
  method: 'patch',
  path: '/profile',
  tags: ['Account'],
  summary: 'Change display name, birthday or locale',
  description: 'Send If-Match with the profile version you edited; a stale version is never written (409).',
  security: bearer,
  middleware: [requireAuth] as const,
  request: {
    headers: z.object({ 'if-match': z.string().optional().openapi({ example: '"3"' }) }),
    body: jsonBody(ProfilePatchSchema),
  },
  responses: {
    200: json(ProfileResponseSchema, 'Saved'),
    409: json(VersionConflictSchema, 'The profile changed elsewhere; the current profile is returned'),
    ...errorResponses(400, 401, 403, 404, 415, 428, 429, 503),
  },
});

/**
 * PATCH /v1/me/profile — optimistic concurrency (S-ID-08): the client sends
 * If-Match with the version it edited; a stale version gets 409 and is never written.
 */
meRoutes.openapi(profileRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const ifMatch = /^"?(\d{1,9})"?$/.exec(c.req.header('if-match') ?? '');
  if (!ifMatch?.[1]) return fail(c, 428, 'PRECONDITION_REQUIRED', 'If-Match with the profile version is required');
  const version = Number(ifMatch[1]);
  const body = c.req.valid('json');
  if (Object.keys(body).length === 0) return fail(c, 400, 'BAD_REQUEST', 'Only display_name, birthday and locale can be changed');
  const now = Date.now();
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (body.display_name !== undefined) {
    const v = body.display_name;
    if (v !== null && !(boundedString(v, 50) && v.trim().length > 0)) return fail(c, 400, 'BAD_REQUEST', 'display_name must be 1-50 characters or null');
    sets.push('display_name = ?');
    values.push(v === null ? null : v.trim());
  }
  if (body.birthday !== undefined) {
    const v = body.birthday;
    if (v !== null && !isBirthday(v, now)) return fail(c, 400, 'BAD_REQUEST', 'birthday must be YYYY-MM-DD or null');
    sets.push('birthday = ?');
    values.push(v);
  }
  if (body.locale !== undefined) {
    if (!isLocale(body.locale)) return fail(c, 400, 'BAD_REQUEST', 'locale must look like zh-TW');
    sets.push('locale = ?');
    values.push(body.locale);
  }
  if (sets.length === 0) return fail(c, 400, 'BAD_REQUEST', 'Only display_name, birthday and locale can be changed');
  const db = c.env.DB_IDENTITY;
  const update = await db
    .prepare(`UPDATE profiles SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?`)
    .bind(...values, now, userId, version)
    .run();
  const written = update.meta.changes === 1;
  await auditStatement(db, { actorType: 'user', actorUserId: userId, action: 'profile.update', targetType: 'user', targetId: userId, appId, result: written ? 'success' : 'denied', requestId, retention: 'general' }, now).run();
  const current = await db.prepare(PROFILE_SQL).bind(userId).first<ProfileRow>();
  if (!current) return fail(c, 404, 'NOT_FOUND', 'Member not found');
  c.header('etag', `"${current.version}"`);
  if (!written) {
    return c.json({ ...errorBody('VERSION_CONFLICT', 'The profile changed elsewhere; reload and try again', requestId), profile: await profileJson(c.env, current) }, 409);
  }
  return c.json({ profile: await profileJson(c.env, current) }, 200);
});

const consentRoute = createRoute({
  method: 'post',
  path: '/consents',
  tags: ['Account'],
  summary: 'Accept the current terms of service and privacy policy',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { body: jsonBody(z.object({ terms_version: z.string(), privacy_version: z.string() })) },
  responses: { 204: { description: 'Recorded' }, ...errorResponses(400, 401, 403, 415, 429, 503) },
});

/** POST /v1/me/consents — records acceptance of the current terms and privacy policy (S-ID-09). */
meRoutes.openapi(consentRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const body = c.req.valid('json');
  if (body.terms_version !== c.env.TERMS_VERSION || body.privacy_version !== c.env.PRIVACY_VERSION) {
    return c.json(errorBody('CONSENT_VERSION_MISMATCH', 'Accept the current terms and privacy policy versions', c.get('requestId')), 400);
  }
  await acceptConsents(c.env.DB_IDENTITY, { userId, termsVersion: c.env.TERMS_VERSION, privacyVersion: c.env.PRIVACY_VERSION, appId, requestId: c.get('requestId') }, Date.now());
  return c.body(null, 204);
});

const deletionRoute = createRoute({
  method: 'post',
  path: '/deletion',
  tags: ['Account'],
  summary: 'Delete the account (disabled at once, purged after 7 days unless cancelled)',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { body: jsonBody(z.object({ confirm: z.literal(true) })) },
  responses: {
    202: json(z.object({ status: z.string(), deletion_purge_at: z.number().int() }), 'Deletion scheduled; all sessions ended'),
    ...errorResponses(400, 401, 403, 409, 415, 429, 503),
  },
});

/**
 * POST /v1/me/deletion — starts account deletion (S-ID-06). The account is disabled at once;
 * signing in again within 7 days allows cancelling. Requires {"confirm": true}.
 */
meRoutes.openapi(deletionRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const result = await requestDeletion(c.env.DB_IDENTITY, { userId, appId, requestId: c.get('requestId') }, Date.now());
  if (!result.ok) return fail(c, 409, 'CONFLICT', 'The account cannot be deleted in its current state');
  return c.json({ status: 'pending_deletion', deletion_purge_at: result.purgeAt }, 202);
});

const cancelDeletionRoute = createRoute({
  method: 'delete',
  path: '/deletion',
  tags: ['Account'],
  summary: 'Cancel a pending deletion',
  security: bearer,
  middleware: [requireAuthAllowPending] as const,
  responses: { 200: json(z.object({ status: z.string() }), 'Account active again'), ...errorResponses(401, 403, 409, 429, 503) },
});

/** DELETE /v1/me/deletion — cancels a pending deletion during the grace period. */
meRoutes.openapi(cancelDeletionRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const cancelled = await cancelDeletion(c.env.DB_IDENTITY, { userId, appId, requestId: c.get('requestId') }, Date.now());
  if (!cancelled) return fail(c, 409, 'CONFLICT', 'No deletion is pending');
  return c.json({ status: 'active' }, 200);
});

const LinkResultSchema = z.object({ provider: z.string(), linked: z.boolean() });

function linkRoute<P extends Provider>(provider: P) {
  return createRoute({
    method: 'post',
    path: `/identities/${provider}` as `/identities/${P}`,
    tags: ['Account'],
    summary: `Link ${provider === 'apple' ? 'Sign in with Apple' : 'Google'} to the signed-in member`,
    description: 'Needs a fresh nonce and ID token for that provider, issued for the same App.',
    security: bearer,
    middleware: [requireAuth] as const,
    request: { body: jsonBody(ProviderRequestSchema) },
    responses: {
      201: json(LinkResultSchema, 'Linked'),
      200: json(LinkResultSchema, 'Already linked to this member'),
      ...errorResponses(400, 401, 403, 409, 415, 429, 503),
    },
  });
}

/**
 * POST /v1/me/identities/apple | google — links the other sign-in method (S-ID-02).
 */
async function link(c: Context<AppBindings>, provider: Provider, body: z.infer<typeof ProviderRequestSchema>) {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const request = readProviderRequest(body);
  if (!request) return fail(c, 400, 'BAD_REQUEST', 'id_token and nonce are required');
  const configured = getApp(appId);
  const app = configured ? await withEffectiveStatus(c.env.DB_IDENTITY, configured, Date.now()) : undefined;
  if (!app || app.status !== 'active') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  const verified = await verifyProviderRequest(c, provider, app, request, `account.link.${provider}`, userId);
  if ('response' in verified) return verified.response;
  const now = Date.now();
  const outcome = await linkIdentity(c.env.DB_IDENTITY, { userId, appId, requestId }, { provider, subject: verified.identity.subject, email: verified.identity.email, isPrivateRelay: verified.identity.isPrivateRelay }, now);
  if (outcome === 'identity_in_use') return fail(c, 409, 'IDENTITY_IN_USE', 'This sign-in already belongs to another Starry account');
  if (outcome === 'provider_in_use') return fail(c, 409, 'PROVIDER_ALREADY_LINKED', `A different ${provider} sign-in is already linked`);
  if (provider === 'apple' && request.authorizationCode && outcome === 'linked') {
    const pending = background(
      c,
      rememberAppleToken(c.env.DB_IDENTITY, c.env, (url, init) => fetch(url, init), { userId, subject: verified.identity.subject, clientId: verified.identity.audience, code: request.authorizationCode, appId, requestId }, now),
    );
    if (pending) await pending;
  }
  if (outcome === 'linked') return c.json({ provider, linked: true }, 201);
  return c.json({ provider, linked: true }, 200);
}

meRoutes.openapi(linkRoute('apple'), async (c) => link(c, 'apple', c.req.valid('json')));
meRoutes.openapi(linkRoute('google'), async (c) => link(c, 'google', c.req.valid('json')));

const avatarPutRoute = createRoute({
  method: 'put',
  path: '/avatar',
  tags: ['Account'],
  summary: 'Upload an avatar (WebP, JPEG or PNG, at most 256 KB, cropped square by the App)',
  security: bearer,
  middleware: [requireAuth] as const,
  request: {
    body: {
      required: true,
      content: {
        'image/webp': { schema: { type: 'string', format: 'binary' } },
        'image/jpeg': { schema: { type: 'string', format: 'binary' } },
        'image/png': { schema: { type: 'string', format: 'binary' } },
      },
    },
  },
  responses: { 200: json(ProfileResponseSchema, 'Saved'), ...errorResponses(401, 403, 404, 413, 415, 429, 503) },
});

/** PUT /v1/me/avatar — replaces the previous avatar (S-ID-08). */
meRoutes.openapi(avatarPutRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  if (!c.env.AVATARS) return fail(c, 503, 'SERVICE_UNAVAILABLE', 'Avatar storage is not configured');
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > MAX_AVATAR_BYTES) return fail(c, 413, 'BAD_REQUEST', 'Avatar must be at most 256 KB');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const result = await setAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), { userId, bytes, appId, requestId }, Date.now());
  if (!result.ok) {
    if (result.reason === 'too_large') return fail(c, 413, 'BAD_REQUEST', 'Avatar must be at most 256 KB');
    if (result.reason === 'unsupported') return fail(c, 415, 'BAD_REQUEST', 'Avatar must be a WebP, JPEG or PNG image');
    return fail(c, 404, 'NOT_FOUND', 'Member not found');
  }
  const current = await c.env.DB_IDENTITY.prepare(PROFILE_SQL).bind(userId).first<ProfileRow>();
  if (!current) return fail(c, 404, 'NOT_FOUND', 'Member not found');
  c.header('etag', `"${current.version}"`);
  return c.json({ profile: await profileJson(c.env, current) }, 200);
});

const avatarDeleteRoute = createRoute({
  method: 'delete',
  path: '/avatar',
  tags: ['Account'],
  summary: 'Remove the avatar (Apps then show the first character of the name)',
  security: bearer,
  middleware: [requireAuth] as const,
  responses: { 204: { description: 'Removed' }, ...errorResponses(401, 403, 429, 503) },
});

meRoutes.openapi(avatarDeleteRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  if (!c.env.AVATARS) return c.json(errorBody('SERVICE_UNAVAILABLE', 'Avatar storage is not configured', c.get('requestId')), 503);
  await removeAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), { userId, appId, requestId: c.get('requestId') }, Date.now());
  return c.body(null, 204);
});

const entitlementsRoute = createRoute({
  method: 'get',
  path: '/entitlements',
  tags: ['Purchases'],
  summary: 'Active entitlements in the App that issued the token',
  description: 'RevenueCat projection (S-BIL-04). Entitlements never cross Apps; the App SDK stays the live source.',
  security: bearer,
  middleware: [requireAuth] as const,
  responses: { 200: json(EntitlementsSchema, 'Active entitlements'), ...errorResponses(401, 403, 429, 503) },
});

meRoutes.openapi(entitlementsRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const entitlements = await activeEntitlements(c.env.DB_BILLING, userId, appId, Date.now());
  return c.json({ app_id: appId, entitlements }, 200);
});

const pushPutRoute = createRoute({
  method: 'put',
  path: '/push-tokens',
  tags: ['Notifications'],
  summary: "Register this device's Expo push token for the token's App",
  security: bearer,
  middleware: [requireAuth] as const,
  request: { body: jsonBody(z.object({ token: z.string().openapi({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' }), platform: z.string().openapi({ example: 'ios' }) })) },
  responses: { 204: { description: 'Registered' }, ...errorResponses(400, 401, 403, 415, 429, 503) },
});

meRoutes.openapi(pushPutRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const { token, platform } = c.req.valid('json');
  if (!isPushToken(token) || (platform !== 'ios' && platform !== 'android')) {
    return c.json(errorBody('BAD_REQUEST', 'token must be an Expo push token and platform ios or android', c.get('requestId')), 400);
  }
  await registerPushToken(c.env.DB_IDENTITY, { userId, appId, token, platform }, Date.now());
  return c.body(null, 204);
});

const pushDeleteRoute = createRoute({
  method: 'delete',
  path: '/push-tokens',
  tags: ['Notifications'],
  summary: 'Remove a push token; call before signing out on the device',
  security: bearer,
  middleware: [requireAuthAllowPending] as const,
  request: { body: jsonBody(z.object({ token: z.string() })) },
  responses: { 204: { description: 'Removed' }, ...errorResponses(400, 401, 403, 415, 429, 503) },
});

meRoutes.openapi(pushDeleteRoute, async (c) => {
  const { userId } = c.get('auth');
  const { token } = c.req.valid('json');
  if (!isPushToken(token)) return c.json(errorBody('BAD_REQUEST', 'token is required', c.get('requestId')), 400);
  await unregisterPushToken(c.env.DB_IDENTITY, userId, token);
  return c.body(null, 204);
});

const prefsGetRoute = createRoute({
  method: 'get',
  path: '/notification-preferences',
  tags: ['Notifications'],
  summary: "Per-category push choices for the token's App (categories without a choice are on)",
  security: bearer,
  middleware: [requireAuth] as const,
  responses: { 200: json(NotificationPreferencesSchema, 'Choices'), ...errorResponses(401, 403, 429, 503) },
});

meRoutes.openapi(prefsGetRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  return c.json({ app_id: appId, categories: await getPreferences(c.env.DB_IDENTITY, userId, appId) }, 200);
});

const prefsPutRoute = createRoute({
  method: 'put',
  path: '/notification-preferences',
  tags: ['Notifications'],
  summary: 'Turn push categories on or off',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { body: jsonBody(z.object({ categories: z.record(z.string(), z.boolean()).openapi({ example: { reminders: false } }) })) },
  responses: { 200: json(NotificationPreferencesSchema, 'Saved'), ...errorResponses(400, 401, 403, 415, 429, 503) },
});

meRoutes.openapi(prefsPutRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const entries = Object.entries(c.req.valid('json').categories);
  if (entries.length === 0 || entries.length > 20 || entries.some(([k]) => !isCategory(k))) {
    return fail(c, 400, 'BAD_REQUEST', 'Up to 20 categories (a-z, 0-9, _) with true or false');
  }
  await setPreferences(c.env.DB_IDENTITY, userId, appId, Object.fromEntries(entries), Date.now());
  return c.json({ app_id: appId, categories: await getPreferences(c.env.DB_IDENTITY, userId, appId) }, 200);
});
