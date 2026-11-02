/**
 * Push notifications through the free Expo Push Service (spec S-NTF-01). Starry ID keeps
 * the device tokens (A-04) and each member's per-App category choices. Messages must not
 * contain sensitive personal data; callers pass only titles and short texts.
 */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,180}\]$/;
const CATEGORY = /^[a-z][a-z0-9_]{0,39}$/;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function isPushToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

export function isCategory(value: unknown): value is string {
  return typeof value === 'string' && CATEGORY.test(value);
}

/** Registers (or moves) a device token to this member and App; a device has one owner at a time. */
export async function registerPushToken(db: D1Database, input: { userId: string; appId: string; token: string; platform: 'ios' | 'android' }, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_tokens (token, user_id, app_id, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, app_id = excluded.app_id, platform = excluded.platform, updated_at = excluded.updated_at`,
    )
    .bind(input.token, input.userId, input.appId, input.platform, now, now)
    .run();
}

/** Removes a token, but only one that belongs to this member. */
export async function unregisterPushToken(db: D1Database, userId: string, token: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').bind(token, userId).run();
  return result.meta.changes === 1;
}

export async function getPreferences(db: D1Database, userId: string, appId: string): Promise<Record<string, boolean>> {
  const rows = await db.prepare('SELECT category, enabled FROM push_preferences WHERE user_id = ? AND app_id = ? ORDER BY category').bind(userId, appId).all<{ category: string; enabled: number }>();
  return Object.fromEntries(rows.results.map((r) => [r.category, r.enabled === 1]));
}

/** Saves explicit choices, e.g. {"reminders": false}; at most 20 categories per request. */
export async function setPreferences(db: D1Database, userId: string, appId: string, choices: Record<string, boolean>, now: number): Promise<void> {
  const entries = Object.entries(choices).slice(0, 20);
  if (entries.length === 0) return;
  await db.batch(
    entries.map(([category, enabled]) =>
      db
        .prepare(
          `INSERT INTO push_preferences (user_id, app_id, category, enabled, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, app_id, category) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
        )
        .bind(userId, appId, category, enabled ? 1 : 0, now),
    ),
  );
}

export interface PushMessage {
  userId: string;
  appId: string;
  category: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Sends to every device of an active member in that App unless the category is turned off.
 * Tokens Expo reports as DeviceNotRegistered are removed.
 */
export async function sendPush(
  db: D1Database,
  fetchFn: FetchLike,
  message: PushMessage,
  options: { accessToken?: string | undefined } = {},
): Promise<{ sent: number; skipped: 'inactive' | 'opted_out' | 'no_devices' | null; removed: number }> {
  const member = await db.prepare('SELECT status FROM users WHERE user_id = ?').bind(message.userId).first<{ status: string }>();
  if (member?.status !== 'active') return { sent: 0, skipped: 'inactive', removed: 0 };
  const pref = await db
    .prepare('SELECT enabled FROM push_preferences WHERE user_id = ? AND app_id = ? AND category = ?')
    .bind(message.userId, message.appId, message.category)
    .first<{ enabled: number }>();
  if (pref?.enabled === 0) return { sent: 0, skipped: 'opted_out', removed: 0 };
  const tokens = (await db.prepare('SELECT token FROM push_tokens WHERE user_id = ? AND app_id = ?').bind(message.userId, message.appId).all<{ token: string }>()).results.map((r) => r.token);
  if (tokens.length === 0) return { sent: 0, skipped: 'no_devices', removed: 0 };
  const res = await fetchFn(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}) },
    body: JSON.stringify(tokens.map((to) => ({ to, title: message.title.slice(0, 100), body: message.body.slice(0, 300), data: message.data ?? {}, sound: 'default', channelId: message.category }))),
  });
  if (!res.ok) throw new Error(`EXPO_PUSH_${res.status}`);
  const result: unknown = await res.json();
  const tickets = typeof result === 'object' && result !== null && Array.isArray((result as { data?: unknown }).data) ? ((result as { data: unknown[] }).data) : [];
  let removed = 0;
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i] as { status?: string; details?: { error?: string } } | undefined;
    const token = tokens[i];
    if (token && ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      await db.prepare('DELETE FROM push_tokens WHERE token = ?').bind(token).run();
      removed++;
    }
  }
  return { sent: tokens.length - removed, skipped: null, removed };
}
