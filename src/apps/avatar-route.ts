import { createRoute, z } from '@hono/zod-openapi';
import { apiRouter, errorResponses } from '../api/openapi';
import { fail } from '../auth/routes';
import { verifyAvatarSignature } from '../identity/avatars';

/** GET /v1/avatars/{userId}/{file}?exp&sig — serves a private avatar through a signed, expiring URL. */
export const avatarRoutes = apiRouter();

const avatarRoute = createRoute({
  method: 'get',
  path: '/{userId}/{file}',
  tags: ['Account'],
  summary: 'Avatar image through a signed URL (use profile.avatar_url as given)',
  request: {
    params: z.object({ userId: z.string(), file: z.string() }),
    query: z.object({ exp: z.string().optional(), sig: z.string().optional() }),
  },
  responses: {
    200: { description: 'Image bytes (image/webp, image/jpeg or image/png)' },
    ...errorResponses(404, 429),
  },
});

avatarRoutes.openapi(avatarRoute, async (c) => {
  const { userId, file } = c.req.valid('param');
  const { exp, sig } = c.req.valid('query');
  const key = `avatars/${userId}/${file}`;
  const secret = c.env.DATA_ENCRYPTION_KEY;
  if (!secret || !c.env.AVATARS) return fail(c, 404, 'NOT_FOUND', 'Resource not found');
  if (!(await verifyAvatarSignature(secret, key, exp, sig, Date.now()))) return fail(c, 404, 'NOT_FOUND', 'Resource not found');
  const object = await c.env.AVATARS.get(key);
  if (!object) return fail(c, 404, 'NOT_FOUND', 'Resource not found');
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
});
