import { Hono } from 'hono';
import type { AppBindings } from '../env';
import { verifyAvatarSignature } from '../identity/avatars';
import { errorBody } from '../lib/errors';

/** GET /v1/avatars/{user_id}/{file}?exp&sig — serves a private avatar through a signed, expiring URL. */
export const avatarRoutes = new Hono<AppBindings>();

avatarRoutes.get('/:userId/:file', async (c) => {
  const key = `avatars/${c.req.param('userId')}/${c.req.param('file')}`;
  const secret = c.env.DATA_ENCRYPTION_KEY;
  const notFound = () => c.json(errorBody('NOT_FOUND', 'Resource not found', c.get('requestId')), 404);
  if (!secret || !c.env.AVATARS) return notFound();
  if (!(await verifyAvatarSignature(secret, key, c.req.query('exp'), c.req.query('sig'), Date.now()))) return notFound();
  const object = await c.env.AVATARS.get(key);
  if (!object) return notFound();
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
});
