import { Hono } from 'hono';
import type { AppBindings } from '../env';

/** GET /app-icon/:id — the Owner-chosen icon of an App for the launcher (not secret, cached briefly). */
export const launcherIcons = new Hono<AppBindings>();
launcherIcons.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!c.env.AVATARS || !/^[a-z][a-z0-9-]{1,31}$/.test(id)) return c.body(null, 404);
  const row = await c.env.DB_IDENTITY.prepare('SELECT icon_key FROM app_launcher WHERE app_id = ?').bind(id).first<{ icon_key: string | null }>();
  const object = row?.icon_key ? await c.env.AVATARS.get(row.icon_key) : null;
  if (!object) return c.body(null, 404);
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
});

export const iconUrl = (appId: string, iconKey: string): string => `/app-icon/${appId}?v=${encodeURIComponent(iconKey.split('/').pop() ?? '')}`;
