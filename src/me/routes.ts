import { createRoute, z } from '@hono/zod-openapi';
import {
  apiRouter, bearer, EntitlementsSchema, ErrorSchema, errorResponses, json, jsonBody, MeSchema, NotificationPreferencesSchema,
  ProfileResponseSchema, ProviderRequestSchema, VersionConflictSchema, VisibilitySchema,
} from '../api/openapi';
import { getApp } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import { requireAuth } from '../auth/middleware';
import type { Provider } from '../auth/provider-keys';
import { appleRedirectFor, background, fail, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import { activeEntitlements } from '../billing/revenuecat';
import type { AppBindings } from '../env';
import { rememberAppleToken } from '../identity/apple';
import { initialsOf } from '../identity/initials';
import { importProviderAvatar, MAX_AVATAR_BYTES, r2Store, rememberProviderPhoto, removeAvatar, setAvatar, signedAvatarPath } from '../identity/avatars';
import { seedProfileFromGoogle } from '../identity/google-seed';
import { cleanupAfterDeletion } from '../identity/erase';
import { deleteMemberNow } from '../identity/lifecycle';
import { linkIdentity } from '../identity/link';
import { completeMerge, findMergeCandidate } from '../identity/merge';
import { acceptConsents } from '../identity/members';
import { sendContactEmailVerification } from '../identity/contact-email';
import { randomMotto } from '../identity/mottos';
import { roleOf } from '../identity/roles';
import { derivedOf, effectiveVisibility, hasChanges, loadProfile, publicProfile, saveProfile, shownName, validateProfileInput, type FieldUpdate, type ProfileRow } from '../identity/profile';
import { errorBody } from '../lib/errors';
import { mailSettings } from '../notify/email';
import { getPreferences, isCategory, isPushToken, registerPushToken, setPreferences, unregisterPushToken } from '../notify/push';
import type { Context } from 'hono';

export const meRoutes = apiRouter();

async function avatarUrlOf(env: { DATA_ENCRYPTION_KEY?: string }, p: ProfileRow, now: number): Promise<string | null> {
  return p.avatar_key && env.DATA_ENCRYPTION_KEY ? signedAvatarPath(env.DATA_ENCRYPTION_KEY, p.avatar_key, now) : null;
}

/** The member's own profile (S-ID-08, 02.01-02.10); avatar_url is a signed path valid for one hour. */
async function profileJson(env: { DATA_ENCRYPTION_KEY?: string }, p: ProfileRow, fieldUpdates: Record<string, FieldUpdate>) {
  const now = Date.now();
  return {
    shown_name: shownName(p.nickname, p.display_name, p.primary_name),
    display_name: p.display_name,
    avatar_url: await avatarUrlOf(env, p, now),
    initials: initialsOf(p.display_name ?? p.nickname),
    birthday: p.birthday,
    locale: p.locale,
    contact_email: p.contact_email,
    contact_email_verified: p.contact_email !== null && p.contact_email_verified_at !== null,
    phone: p.phone,
    country: p.country,
    region: p.region,
    city: p.city,
    motto: p.motto,
    nickname: p.nickname,
    occupation: p.occupation,
    organization: p.organization,
    website: p.website,
    bio: p.bio,
    languages: p.languages,
    interests: p.interests,
    skills: p.skills,
    university: p.university,
    university_dept: p.university_dept,
    grad_school: p.grad_school,
    grad_dept: p.grad_dept,
    derived: derivedOf(p.birthday),
    visibility: effectiveVisibility(p, now),
    field_updated_at: fieldUpdates,
    version: p.version,
    updated_at: p.updated_at,
  };
}

const meRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Account'],
  summary: 'The signed-in member: profile, sign-in methods and consent state',
  security: bearer,
  middleware: [requireAuth] as const,
  responses: { 200: json(MeSchema, 'Member'), ...errorResponses(401, 403, 404, 429, 503) },
});

/** GET /v1/me — the signed-in member, profile, linked providers and consent state. */
meRoutes.openapi(meRoute, async (c) => {
  const { userId } = c.get('auth');
  const db = c.env.DB_IDENTITY;
  const [[user, identities, consents], loaded] = await Promise.all([
    db.batch([
      db.prepare('SELECT user_id, member_no, status, created_at FROM users WHERE user_id = ?').bind(userId),
      db.prepare('SELECT provider, email, email_is_private_relay FROM auth_identities WHERE user_id = ? ORDER BY provider').bind(userId),
      db.prepare('SELECT document, version FROM consents WHERE user_id = ? AND withdrawn_at IS NULL').bind(userId),
    ]),
    loadProfile(db, userId),
  ]);
  const u = user?.results[0] as { user_id: string; member_no: string | null; status: string; created_at: number } | undefined;
  if (!u || !loaded) return fail(c, 404, 'NOT_FOUND', 'Member not found');
  const p = loaded.row;
  const accepted = (consents?.results ?? []) as { document: string; version: string }[];
  const has = (doc: string, version: string) => accepted.some((r) => r.document === doc && r.version === version);
  c.header('etag', `"${p.version}"`);
  return c.json(
    {
      user_id: u.user_id,
      member_no: u.member_no,
      staff_role: await roleOf(db, c.env.OWNER_USER_IDS, userId),
      status: u.status,
      created_at: u.created_at,
      deletion_requested_at: null,
      deletion_purge_at: null,
      profile: await profileJson(c.env, p, loaded.fieldUpdates),
      public_profile: publicProfile(p, await avatarUrlOf(c.env, p, Date.now()), Date.now()),
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
    display_name: z.string().nullable().optional().openapi({ description: 'Name (姓名), 1-50 characters, or null to clear' }),
    birthday: z.string().nullable().optional().openapi({ description: 'YYYY-MM-DD, or null to clear' }),
    locale: z.string().optional().openapi({ example: 'zh-TW' }),
    contact_email: z.string().nullable().optional().openapi({ description: 'Main contact email; a verification link is sent when it changes. Empty or null clears it.' }),
    phone: z.string().nullable().optional().openapi({ description: 'Stored as E.164; a local number takes the country calling code (Taiwan by default)', example: '0912345678' }),
    country: z.string().nullable().optional().openapi({ description: 'ISO 3166-1 alpha-2', example: 'TW' }),
    region: z.string().nullable().optional().openapi({ description: 'State, province or county, at most 60 characters' }),
    city: z.string().nullable().optional().openapi({ description: 'At most 60 characters' }),
    motto: z.string().nullable().optional().openapi({ description: 'At most 200 characters' }),
    nickname: z.string().nullable().optional().openapi({ description: 'Nickname (暱稱), at most 30 characters. Always public.' }),
    occupation: z.string().nullable().optional().openapi({ description: 'At most 60 characters' }),
    organization: z.string().nullable().optional().openapi({ description: 'Employer or organization, at most 80 characters' }),
    website: z.string().nullable().optional().openapi({ description: 'https:// URL, at most 200 characters' }),
    bio: z.string().nullable().optional().openapi({ description: 'At most 500 characters' }),
    languages: z.string().nullable().optional().openapi({ description: 'At most 100 characters' }),
    interests: z.string().nullable().optional().openapi({ description: 'At most 200 characters' }),
    skills: z.string().nullable().optional().openapi({ description: 'At most 200 characters' }),
    university: z.string().nullable().optional().openapi({ description: 'University, at most 80 characters' }),
    university_dept: z.string().nullable().optional().openapi({ description: 'Department, at most 60 characters' }),
    grad_school: z.string().nullable().optional().openapi({ description: 'Graduate school, at most 80 characters' }),
    grad_dept: z.string().nullable().optional().openapi({ description: 'Graduate department, at most 60 characters' }),
    visibility: VisibilitySchema.partial().optional().openapi({ description: 'Only the fields to change' }),
  })
  .strict();

const profileRoute = createRoute({
  method: 'patch',
  path: '/profile',
  tags: ['Account'],
  summary: 'Change profile fields and their visibility',
  description:
    'Send only the fields to change, with If-Match set to the profile version you edited; a stale version is never written (409). Empty text clears an optional field. 400 errors name the field in the message.',
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
 * PATCH /v1/me/profile — optimistic concurrency (S-ID-08, 02.08): the client sends
 * If-Match with the version it edited; a stale version gets 409 and is never written.
 */
meRoutes.openapi(profileRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const ifMatch = /^"?(\d{1,9})"?$/.exec(c.req.header('if-match') ?? '');
  if (!ifMatch?.[1]) return fail(c, 428, 'PRECONDITION_REQUIRED', 'If-Match with the profile version is required');
  const body = c.req.valid('json');
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const before = await loadProfile(db, userId);
  if (!before) return fail(c, 404, 'NOT_FOUND', 'Member not found');
  const validated = validateProfileInput(body, now, before.row.country);
  if (!validated.ok) return fail(c, 400, 'BAD_REQUEST', `${validated.field}: ${validated.message}`);
  if (!hasChanges(validated.changes)) return fail(c, 400, 'BAD_REQUEST', 'Nothing to change');
  const saved = await saveProfile(db, { userId, expectedVersion: Number(ifMatch[1]), changes: validated.changes, source: 'member', actorUserId: userId, appId, requestId }, now);
  const current = await loadProfile(db, userId);
  if (!current) return fail(c, 404, 'NOT_FOUND', 'Member not found');
  c.header('etag', `"${current.row.version}"`);
  if (!saved.written) {
    return c.json({ ...errorBody('VERSION_CONFLICT', 'The profile changed elsewhere; reload and try again', requestId), profile: await profileJson(c.env, current.row, current.fieldUpdates) }, 409);
  }
  if (saved.newContactEmail) {
    const pending = background(c, sendContactEmailVerification(c.env.DATA_ENCRYPTION_KEY, mailSettings(c.env, new URL(c.req.url).origin), userId, saved.newContactEmail, now));
    if (pending) await pending;
  }
  return c.json({ profile: await profileJson(c.env, current.row, current.fieldUpdates) }, 200);
});

const verifyEmailRoute = createRoute({
  method: 'post',
  path: '/contact-email/verification',
  tags: ['Account'],
  summary: 'Send the verification link for the main contact email again',
  security: bearer,
  middleware: [requireAuth] as const,
  responses: {
    202: json(z.object({ sent: z.boolean() }), 'Sent'),
    200: json(z.object({ verified: z.boolean() }), 'Already verified'),
    ...errorResponses(401, 403, 404, 409, 429, 503),
  },
});

meRoutes.openapi(verifyEmailRoute, async (c) => {
  const { userId } = c.get('auth');
  const loaded = await loadProfile(c.env.DB_IDENTITY, userId);
  if (!loaded) return fail(c, 404, 'NOT_FOUND', 'Member not found');
  const email = loaded.row.contact_email;
  if (!email) return fail(c, 409, 'CONFLICT', 'No contact email is set');
  if (loaded.row.contact_email_verified_at !== null) return c.json({ verified: true }, 200);
  const result = await sendContactEmailVerification(c.env.DATA_ENCRYPTION_KEY, mailSettings(c.env, new URL(c.req.url).origin), userId, email, Date.now());
  if (result === 'unavailable') return fail(c, 503, 'SERVICE_UNAVAILABLE', 'Email is not available');
  return c.json({ sent: result === 'sent' }, 202);
});

const mottoRoute = createRoute({
  method: 'get',
  path: '/motto-suggestion',
  tags: ['Account'],
  summary: 'A random motto to fill the edit box (02.05); nothing is saved',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { query: z.object({ current: z.string().max(200).optional() }) },
  responses: { 200: json(z.object({ motto: z.string() }), 'Suggestion'), ...errorResponses(400, 401, 403, 429, 503) },
});

meRoutes.openapi(mottoRoute, async (c) => c.json({ motto: randomMotto(c.req.valid('query').current ?? null) }, 200));

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
  summary: 'Delete the account at once and permanently',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { body: jsonBody(z.object({ confirm: z.literal(true) })) },
  responses: {
    202: json(z.object({ status: z.string(), deletion_purge_at: z.number().int() }), 'Account deleted; all sessions ended'),
    ...errorResponses(400, 401, 403, 409, 415, 429, 503),
  },
});

/**
 * POST /v1/me/deletion — deletes the account at once and permanently (S-ID-06, no waiting period since 2026-11-07).
 * Requires {"confirm": true}.
 */
meRoutes.openapi(deletionRoute, async (c) => {
  const { userId, appId } = c.get('auth');
  const now = Date.now();
  const result = await deleteMemberNow(c.env.DB_IDENTITY, { userId, appId, requestId: c.get('requestId') }, now);
  if (!result.ok) return fail(c, 409, 'CONFLICT', 'The account cannot be deleted in its current state');
  await cleanupAfterDeletion(c.env, userId, result.avatarKey, now);
  return c.json({ status: 'deleted', deletion_purge_at: now }, 202);
});

const cancelDeletionRoute = createRoute({
  method: 'delete',
  path: '/deletion',
  tags: ['Account'],
  summary: 'Cancel a pending deletion (kept for old Apps; deletion is immediate, so there is never one to cancel)',
  security: bearer,
  middleware: [requireAuth] as const,
  responses: { 200: json(z.object({ status: z.string() }), 'Account active again'), ...errorResponses(401, 403, 409, 429, 503) },
});

/** DELETE /v1/me/deletion — compatibility only: since 2026-11-07 deletion is immediate, so nothing can be pending. */
meRoutes.openapi(cancelDeletionRoute, async (c) => fail(c, 409, 'CONFLICT', 'No deletion is pending'));

const LinkResultSchema = z.object({
  provider: z.string(),
  linked: z.boolean(),
  merged: z.boolean().optional().openapi({ description: 'true when a separate Starry account made earlier with this sign-in was merged into this one' }),
});

const LinkRequestSchema = ProviderRequestSchema.extend({
  merge_other_account: z.boolean().optional().openapi({
    description: 'If this sign-in already made its own Starry account, merge that account into this one. Ask the member first; the other account is deleted.',
  }),
});

const LinkConflictSchema = ErrorSchema.extend({
  mergeable: z.boolean().optional().openapi({ description: 'IDENTITY_IN_USE only: whether resending with merge_other_account: true would merge' }),
  merge_blocked: z.enum(['already_has_provider', 'staff', 'suspended', 'other_sign_in', 'purchases']).optional(),
  other_account_created_at: z.number().int().optional(),
}).openapi('LinkConflict');

function linkRoute<P extends Provider>(provider: P) {
  return createRoute({
    method: 'post',
    path: `/identities/${provider}` as `/identities/${P}`,
    tags: ['Account'],
    summary: `Link ${provider === 'apple' ? 'Sign in with Apple' : 'Google'} to the signed-in member`,
    description:
      'Needs a fresh nonce and ID token for that provider, issued for the same App. When that sign-in already made a separate Starry account, 409 IDENTITY_IN_USE says whether it can be merged; resend with merge_other_account: true after the member agrees.',
    security: bearer,
    middleware: [requireAuth] as const,
    request: { body: jsonBody(LinkRequestSchema) },
    responses: {
      201: json(LinkResultSchema, 'Linked (or merged)'),
      200: json(LinkResultSchema, 'Already linked to this member'),
      409: json(LinkConflictSchema, 'The sign-in belongs to another Starry account, or this provider is already linked'),
      ...errorResponses(400, 401, 403, 415, 429, 503),
    },
  });
}

/**
 * POST /v1/me/identities/apple | google — links the other sign-in method (S-ID-02).
 */
async function link(c: Context<AppBindings>, provider: Provider, body: z.infer<typeof LinkRequestSchema>) {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const request = readProviderRequest(body);
  if (!request) return fail(c, 400, 'BAD_REQUEST', 'id_token and nonce are required');
  const configured = getApp(appId);
  const app = configured ? await withEffectiveStatus(c.env.DB_IDENTITY, configured, Date.now()) : undefined;
  if (!app || app.status !== 'active') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  const verified = await verifyProviderRequest(c, provider, app, request, `account.link.${provider}`, userId);
  if (!verified.ok) return verified.response;
  const now = Date.now();
  const identity = { provider, subject: verified.identity.subject, email: verified.identity.email, isPrivateRelay: verified.identity.isPrivateRelay };
  let outcome: 'linked' | 'already_linked' | 'provider_in_use' | 'identity_in_use' | 'merged' = await linkIdentity(c.env.DB_IDENTITY, { userId, appId, requestId }, identity, now);
  if (outcome === 'identity_in_use') {
    const found = await findMergeCandidate(c.env.DB_IDENTITY, c.env.DB_BILLING, c.env.OWNER_USER_IDS, userId, identity);
    const mergeable = Boolean(found && !found.blocker);
    if (found && mergeable && body.merge_other_account === true) {
      const merged = await completeMerge(
        { db: c.env.DB_IDENTITY, battery: c.env.DB_BATTERY, ...(c.env.AVATARS ? { avatars: c.env.AVATARS } : {}) },
        { userId, appId, requestId },
        identity,
        found.candidate.userId,
        now,
      );
      if (merged) outcome = 'merged';
    }
    if (outcome === 'identity_in_use') {
      return c.json(
        {
          ...errorBody('IDENTITY_IN_USE', 'This sign-in already belongs to another Starry account', requestId),
          mergeable,
          ...(found?.blocker ? { merge_blocked: found.blocker } : {}),
          ...(found ? { other_account_created_at: found.candidate.createdAt } : {}),
        },
        409,
      );
    }
  }
  if (outcome === 'provider_in_use') return fail(c, 409, 'PROVIDER_ALREADY_LINKED', `A different ${provider} sign-in is already linked`);
  if (provider === 'apple' && request.authorizationCode && (outcome === 'linked' || outcome === 'merged')) {
    const pending = background(
      c,
      rememberAppleToken(
        c.env.DB_IDENTITY,
        c.env,
        (url, init) => fetch(url, init),
        { userId, subject: verified.identity.subject, clientId: verified.identity.audience, code: request.authorizationCode, redirectUri: appleRedirectFor(c, app, request.redirectUri), appId, requestId },
        now,
      ),
    );
    if (pending) await pending;
  }
  if (outcome === 'linked' || outcome === 'merged') {
    await rememberProviderPhoto(c.env.DB_IDENTITY, verified.identity.subject, verified.identity.picture);
    await seedProfileFromGoogle(c.env.DB_IDENTITY, verified.identity.subject, verified.identity, now);
  }
  if ((outcome === 'linked' || outcome === 'merged') && verified.identity.picture && c.env.AVATARS) {
    // A member without an avatar (for example one who registered with Apple) gets the Google photo once Google is linked.
    const photo = background(c, importProviderAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), (url, init) => fetch(url, init), { userId, url: verified.identity.picture, appId, requestId }, now));
    if (photo) await photo;
  }
  if (outcome === 'merged') return c.json({ provider, linked: true, merged: true }, 201);
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
  const current = await loadProfile(c.env.DB_IDENTITY, userId);
  if (!current) return fail(c, 404, 'NOT_FOUND', 'Member not found');
  c.header('etag', `"${current.row.version}"`);
  return c.json({ profile: await profileJson(c.env, current.row, current.fieldUpdates) }, 200);
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
  middleware: [requireAuth] as const,
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
