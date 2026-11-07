import { createRoute, z } from '@hono/zod-openapi';
import { apiRouter, errorResponses, json, jsonBody } from '../api/openapi';
import { fail } from '../auth/routes';
import { callingApp, INVALID, UNCONFIGURED } from '../battery/routes';
import { signedAvatarPath } from '../identity/avatars';
import { PROFILE_SQL, publicProfile, type ProfileRow } from '../identity/profile';

/**
 * POST /v1/directory/members — for an App's backend (x-starry-app-key): the public nickname, name, avatar and member number
 * of up to 50 of ITS OWN members, for features such as leaderboards. Names and avatars follow each member's
 * visibility settings (hidden ones come back as null); Email and every other field are never returned here.
 * Members who never signed in to the calling App are left out.
 */
export const directoryRoutes = apiRouter();

const MAX_IDS = 50;

const DirectoryMemberSchema = z
  .object({
    user_id: z.string(),
    member_no: z.string().nullable().openapi({ example: 'TW0112342' }),
    shown_name: z.string().nullable().openapi({ description: 'THE name to show for this member in every Starry App: the nickname first, the real name only when there is no nickname (null when neither exists; then show initials)', example: '陽光海豚' }),
    nickname: z.string().nullable(),
    display_name: z.string().nullable().openapi({ description: 'null when the member chose to hide their name' }),
    avatar_url: z.string().nullable(),
    initials: z.string().openapi({ description: 'Show in a circle when avatar_url is null' }),
  })
  .openapi('DirectoryMember');

const membersRoute = createRoute({
  method: 'post',
  path: '/members',
  tags: ['Apps'],
  summary: 'App backend: public nickname, name and avatar of its own members (leaderboards)',
  description: `Needs the App backend service key (x-starry-app-key). 1 to ${MAX_IDS} member IDs per call. Only members who have signed in to the calling App are returned; Email and all other fields are never included.`,
  security: [{ appKey: [] }],
  request: {
    headers: z.object({ 'x-starry-app-key': z.string().optional() }),
    body: jsonBody(z.object({ user_ids: z.array(z.string()).min(1).max(MAX_IDS) })),
  },
  responses: {
    200: json(z.object({ members: z.array(DirectoryMemberSchema) }).openapi('DirectoryMembers'), 'Members of the calling App'),
    ...errorResponses(400, 401, 415, 429, 503),
  },
});

directoryRoutes.openapi(membersRoute, async (c) => {
  const caller = await callingApp(c);
  if (caller === UNCONFIGURED) return fail(c, 503, 'SERVICE_UNAVAILABLE', 'The service key is not configured');
  if (caller === INVALID) return fail(c, 401, 'UNAUTHORIZED', 'Invalid app key');
  const ids = [...new Set(c.req.valid('json').user_ids)];
  if (!ids.every((id) => /^[0-9a-f-]{36}$/.test(id))) return fail(c, 400, 'BAD_REQUEST', `user_ids must be 1 to ${MAX_IDS} member IDs`);
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
    members.push({ user_id: row.user_id, member_no: row.member_no, shown_name: shown.shown_name, nickname: shown.nickname, display_name: shown.display_name, avatar_url: shown.avatar_url, initials: shown.initials });
  }
  return c.json({ members }, 200);
});
