import { Hono } from 'hono';
import { getApp } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import { requireAuth, requireAuthAllowPending } from '../auth/middleware';
import type { Provider } from '../auth/provider-keys';
import { background, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import type { AppBindings } from '../env';
import { rememberAppleToken } from '../identity/apple';
import { MAX_AVATAR_BYTES, r2Store, removeAvatar, setAvatar, signedAvatarPath } from '../identity/avatars';
import { cancelDeletion, DELETION_GRACE_MS, requestDeletion } from '../identity/lifecycle';
import { linkIdentity } from '../identity/link';
import { activeEntitlements } from '../billing/revenuecat';
import { auditStatement } from '../lib/audit';
import { errorBody } from '../lib/errors';
import { boundedString, isBirthday, isLocale, readJsonObject } from '../lib/validate';

export const meRoutes = new Hono<AppBindings>();

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

/** GET /v1/me — the signed-in member, profile, linked providers and consent state. */
meRoutes.get('/', requireAuthAllowPending, async (c) => {
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
  if (!u || !p) return c.json(errorBody('NOT_FOUND', 'Member not found', c.get('requestId')), 404);
  const accepted = (consents?.results ?? []) as { document: string; version: string }[];
  const has = (doc: string, version: string) => accepted.some((r) => r.document === doc && r.version === version);
  c.header('etag', `"${p.version}"`);
  return c.json({
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
  });
});

/**
 * PATCH /v1/me/profile — optimistic concurrency (S-ID-08): the client sends
 * If-Match with the version it edited; a stale version gets 409 and is never written.
 */
meRoutes.patch('/profile', requireAuth, async (c) => {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const ifMatch = /^"?(\d{1,9})"?$/.exec(c.req.header('if-match') ?? '');
  if (!ifMatch?.[1]) return c.json(errorBody('PRECONDITION_REQUIRED', 'If-Match with the profile version is required', requestId), 428);
  const version = Number(ifMatch[1]);
  const body = await readJsonObject(c);
  const allowed = ['display_name', 'birthday', 'locale'];
  if (!body || Object.keys(body).length === 0 || Object.keys(body).some((k) => !allowed.includes(k))) {
    return c.json(errorBody('BAD_REQUEST', 'Only display_name, birthday and locale can be changed', requestId), 400);
  }
  const now = Date.now();
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if ('display_name' in body) {
    const v = body.display_name;
    if (v !== null && !(boundedString(v, 50) && v.trim().length > 0)) {
      return c.json(errorBody('BAD_REQUEST', 'display_name must be 1-50 characters or null', requestId), 400);
    }
    sets.push('display_name = ?');
    values.push(typeof v === 'string' ? v.trim() : null);
  }
  if ('birthday' in body) {
    const v = body.birthday;
    if (v !== null && !isBirthday(v, now)) return c.json(errorBody('BAD_REQUEST', 'birthday must be YYYY-MM-DD or null', requestId), 400);
    sets.push('birthday = ?');
    values.push(typeof v === 'string' ? v : null);
  }
  if ('locale' in body) {
    if (!isLocale(body.locale)) return c.json(errorBody('BAD_REQUEST', 'locale must look like zh-TW', requestId), 400);
    sets.push('locale = ?');
    values.push(body.locale);
  }
  const db = c.env.DB_IDENTITY;
  const update = await db
    .prepare(`UPDATE profiles SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?`)
    .bind(...values, now, userId, version)
    .run();
  const written = update.meta.changes === 1;
  await auditStatement(db, { actorType: 'user', actorUserId: userId, action: 'profile.update', targetType: 'user', targetId: userId, appId, result: written ? 'success' : 'denied', requestId, retention: 'general' }, now).run();
  const current = await db.prepare(PROFILE_SQL).bind(userId).first<ProfileRow>();
  if (!current) return c.json(errorBody('NOT_FOUND', 'Member not found', requestId), 404);
  c.header('etag', `"${current.version}"`);
  if (!written) {
    return c.json({ ...errorBody('VERSION_CONFLICT', 'The profile changed elsewhere; reload and try again', requestId), profile: await profileJson(c.env, current) }, 409);
  }
  return c.json({ profile: await profileJson(c.env, current) });
});

/** POST /v1/me/consents — records acceptance of the current terms and privacy policy (S-ID-09). */
meRoutes.post('/consents', requireAuth, async (c) => {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const body = await readJsonObject(c);
  if (body?.terms_version !== c.env.TERMS_VERSION || body?.privacy_version !== c.env.PRIVACY_VERSION) {
    return c.json(errorBody('CONSENT_VERSION_MISMATCH', 'Accept the current terms and privacy policy versions', requestId), 400);
  }
  const now = Date.now();
  const db = c.env.DB_IDENTITY;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO consents (user_id, document, version, accepted_at) VALUES (?, 'terms', ?, ?)").bind(userId, c.env.TERMS_VERSION, now),
    db.prepare("INSERT OR IGNORE INTO consents (user_id, document, version, accepted_at) VALUES (?, 'privacy', ?, ?)").bind(userId, c.env.PRIVACY_VERSION, now),
    auditStatement(db, { actorType: 'user', actorUserId: userId, action: 'consent.accept', targetType: 'user', targetId: userId, appId, result: 'success', requestId, retention: 'security' }, now),
  ]);
  return c.body(null, 204);
});

/**
 * POST /v1/me/deletion — starts account deletion (S-ID-06). The account is disabled at once;
 * signing in again within 7 days allows cancelling. Requires {"confirm": true}.
 */
meRoutes.post('/deletion', requireAuth, async (c) => {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const body = await readJsonObject(c);
  if (body?.confirm !== true) return c.json(errorBody('BAD_REQUEST', 'Send {"confirm": true} to delete the account', requestId), 400);
  const result = await requestDeletion(c.env.DB_IDENTITY, { userId, appId, requestId }, Date.now());
  if (!result.ok) return c.json(errorBody('CONFLICT', 'The account cannot be deleted in its current state', requestId), 409);
  return c.json({ status: 'pending_deletion', deletion_purge_at: result.purgeAt }, 202);
});

/** DELETE /v1/me/deletion — cancels a pending deletion during the grace period. */
meRoutes.delete('/deletion', requireAuthAllowPending, async (c) => {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const cancelled = await cancelDeletion(c.env.DB_IDENTITY, { userId, appId, requestId }, Date.now());
  if (!cancelled) return c.json(errorBody('CONFLICT', 'No deletion is pending', requestId), 409);
  return c.json({ status: 'active' });
});

/**
 * POST /v1/me/identities/apple | google — links the other sign-in method (S-ID-02).
 * Needs a fresh ID token and nonce for that provider, issued for the same App.
 */
meRoutes.post('/identities/:provider{apple|google}', requireAuth, async (c) => {
  const provider = c.req.param('provider') as Provider;
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  const request = readProviderRequest(await readJsonObject(c));
  if (!request) return c.json(errorBody('BAD_REQUEST', 'id_token and nonce are required', requestId), 400);
  const configured = getApp(appId);
  const app = configured ? await withEffectiveStatus(c.env.DB_IDENTITY, configured, Date.now()) : undefined;
  if (!app || app.status !== 'active') return c.json(errorBody('APP_UNAVAILABLE', 'This app is not available', requestId), 403);
  const verified = await verifyProviderRequest(c, provider, app, request, `account.link.${provider}`, userId);
  if ('response' in verified) return verified.response;
  const now = Date.now();
  const outcome = await linkIdentity(c.env.DB_IDENTITY, { userId, appId, requestId }, { provider, subject: verified.identity.subject, email: verified.identity.email, isPrivateRelay: verified.identity.isPrivateRelay }, now);
  if (outcome === 'identity_in_use') return c.json(errorBody('IDENTITY_IN_USE', 'This sign-in already belongs to another Starry account', requestId), 409);
  if (outcome === 'provider_in_use') return c.json(errorBody('PROVIDER_ALREADY_LINKED', `A different ${provider} sign-in is already linked`, requestId), 409);
  if (provider === 'apple' && request.authorizationCode && outcome === 'linked') {
    const pending = background(
      c,
      rememberAppleToken(c.env.DB_IDENTITY, c.env, (url, init) => fetch(url, init), { userId, subject: verified.identity.subject, clientId: verified.identity.audience, code: request.authorizationCode, appId, requestId }, now),
    );
    if (pending) await pending;
  }
  return c.json({ provider, linked: true }, outcome === 'linked' ? 201 : 200);
});

/**
 * PUT /v1/me/avatar — raw image bytes (WebP, JPEG or PNG, at most 256 KB), already cropped
 * and compressed by the App (S-ID-08). Replaces the previous avatar.
 */
meRoutes.put('/avatar', requireAuth, async (c) => {
  const { userId, appId } = c.get('auth');
  const requestId = c.get('requestId');
  if (!c.env.AVATARS) return c.json(errorBody('SERVICE_UNAVAILABLE', 'Avatar storage is not configured', requestId), 503);
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > MAX_AVATAR_BYTES) return c.json(errorBody('BAD_REQUEST', 'Avatar must be at most 256 KB', requestId), 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const result = await setAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), { userId, bytes, appId, requestId }, Date.now());
  if (!result.ok) {
    if (result.reason === 'too_large') return c.json(errorBody('BAD_REQUEST', 'Avatar must be at most 256 KB', requestId), 413);
    if (result.reason === 'unsupported') return c.json(errorBody('BAD_REQUEST', 'Avatar must be a WebP, JPEG or PNG image', requestId), 415);
    return c.json(errorBody('NOT_FOUND', 'Member not found', requestId), 404);
  }
  const current = await c.env.DB_IDENTITY.prepare(PROFILE_SQL).bind(userId).first<ProfileRow>();
  if (!current) return c.json(errorBody('NOT_FOUND', 'Member not found', requestId), 404);
  c.header('etag', `"${current.version}"`);
  return c.json({ profile: await profileJson(c.env, current) });
});

/** DELETE /v1/me/avatar — removes the avatar; Apps then show the first character of the name. */
meRoutes.delete('/avatar', requireAuth, async (c) => {
  const { userId, appId } = c.get('auth');
  if (!c.env.AVATARS) return c.json(errorBody('SERVICE_UNAVAILABLE', 'Avatar storage is not configured', c.get('requestId')), 503);
  await removeAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), { userId, appId, requestId: c.get('requestId') }, Date.now());
  return c.body(null, 204);
});

/**
 * GET /v1/me/entitlements — active entitlements of the member in the App that issued the
 * token (S-BIL-01: entitlements never cross Apps). The App's RevenueCat SDK stays the live
 * source; backends use this projection.
 */
meRoutes.get('/entitlements', requireAuth, async (c) => {
  const { userId, appId } = c.get('auth');
  const entitlements = await activeEntitlements(c.env.DB_BILLING, userId, appId, Date.now());
  return c.json({ app_id: appId, entitlements });
});
