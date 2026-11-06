import { Hono } from 'hono';
import { fail } from '../auth/routes';
import { callingApp, INVALID, UNCONFIGURED } from '../battery/routes';
import type { AppBindings } from '../env';
import { signedAvatarPath } from '../identity/avatars';
import { PROFILE_SQL, publicProfile, type ProfileRow } from '../identity/profile';

/**
 * POST /v1/directory/members — for an App's backend (x-starry-app-key): the public name, avatar and member number
 * of up to 50 of ITS OWN members, for features such as leaderboards. Names and avatars follow each member's
 * visibility settings (hidden ones come back as null); Email and every other field are never returned here.
 * Members who never signed in to the calling App are left out. Deliberately not part of the generated OpenAPI file;
 * documented in docs/integration-guide.md.
 */
export const directoryRoutes = new Hono<AppBindings>();

const MAX_IDS = 50;
const ID = /^[0-9a-f-]{36}$/;

directoryRoutes.post('/members', async (c) => {
  const caller = await callingApp(c);
  if (caller === UNCONFIGURED) return fail(c, 503, 'SERVICE_UNAVAILABLE', 'The service key is not configured');
  if (caller === INVALID) return fail(c, 401, 'UNAUTHORIZED', 'Invalid app key');
  const body = (await c.req.json().catch(() => null)) as { user_ids?: unknown } | null;
  const ids = Array.isArray(body?.user_ids) ? [...new Set(body.user_ids)] : null;
  if (!ids || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id): id is string => typeof id === 'string' && ID.test(id))) {
    return fail(c, 400, 'BAD_REQUEST', `user_ids must be 1 to ${MAX_IDS} member IDs`);
  }
  const db = c.env.DB_IDENTITY;
  const marks = ids.map(() => '?').join(',');
  const owned = await db
    .prepare(`SELECT m.user_id, u.member_no FROM member_apps m JOIN users u ON u.user_id = m.user_id WHERE m.app_id = ? AND u.status = 'active' AND m.user_id IN (${marks})`)
    .bind(caller, ...ids)
    .all<{ user_id: string; member_no: string | null }>();
  const now = Date.now();
  const members = [];
  for (const row of owned.results) {
    const profile = await db.prepare(PROFILE_SQL).bind(row.user_id).first<ProfileRow>();
    if (!profile) continue;
    const key = c.env.DATA_ENCRYPTION_KEY;
    const avatar = profile.avatar_key && key ? await signedAvatarPath(key, profile.avatar_key, now) : null;
    const shown = publicProfile(profile, avatar, now);
    members.push({ user_id: row.user_id, member_no: row.member_no, display_name: shown.display_name, avatar_url: shown.avatar_url });
  }
  return c.json({ members }, 200);
});
