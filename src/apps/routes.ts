import { createRoute, z } from '@hono/zod-openapi';
import { apiRouter, errorResponses, json } from '../api/openapi';
import { fail } from '../auth/routes';
import { getApp } from './registry';
import { withEffectiveStatus } from './status';

export const appRoutes = apiRouter();

const configRoute = createRoute({
  method: 'get',
  path: '/{appId}/config',
  tags: ['Apps'],
  summary: 'Status, minimum version and whitelisted settings an App reads at launch',
  description: 'Stop or show maintenance when status is not active; require an update below min_version (S-PLT-02).',
  request: { params: z.object({ appId: z.string().openapi({ example: 'echo' }) }) },
  responses: {
    200: json(
      z
        .object({
          app_id: z.string(),
          status: z.string().openapi({ example: 'active', description: 'active, paused or killed' }),
          min_version: z.string().openapi({ example: '1.0.0' }),
          config: z.record(z.string(), z.unknown()),
        })
        .openapi('AppConfig'),
      'App configuration',
    ),
    ...errorResponses(404, 429),
  },
});

/** Remote config read by each App at launch (S-PLT-01/02). Only whitelisted, non-secret values. */
appRoutes.openapi(configRoute, async (c) => {
  const configured = getApp(c.req.valid('param').appId);
  if (!configured) return fail(c, 404, 'APP_NOT_FOUND', 'Unknown app');
  const app = await withEffectiveStatus(c.env.DB_IDENTITY, configured, Date.now());
  return c.json({ app_id: app.app_id, status: app.status, min_version: app.min_version, config: { ...app.config } }, 200);
});
