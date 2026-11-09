import { createRoute, z } from '@hono/zod-openapi';
import { apiRouter, bearer, errorResponses, json } from '../api/openapi';
import { requireAuth } from '../auth/middleware';
import { fail } from '../auth/routes';
import { hasAppBatteryKey } from '../battery/battery';
import { roleOf } from '../identity/roles';
import { listCatalog } from './catalog';
import { buildHandoff, HANDOFF_UPDATED, HANDOFF_VERSION } from './handoff';
import { getApp } from './registry';
import { centralTeamId } from './team-id';

/** GET /v1/apps/{appId}/handoff — the newest integration instructions, for the App's own /admin page (central owner only). */
export const handoffRoutes = apiRouter();

const VERSION = /^\d{4}-\d{2}-\d{2}\.\d{1,3}$/;

const route = createRoute({
  method: 'get',
  path: '/{appId}/handoff',
  tags: ['Apps'],
  summary: 'Newest central integration instructions for this App (owner only, own App only)',
  description:
    'Called by the App’s own /admin page. Sends `integrated` (the instruction version the App was last built to) and records it. When up_to_date is false the App’s AI must patch ONLY the differences. Never contains keys.',
  security: bearer,
  middleware: [requireAuth] as const,
  request: {
    params: z.object({ appId: z.string().openapi({ example: 'echo' }) }),
    query: z.object({ integrated: z.string().regex(VERSION).optional().openapi({ example: '2026-11-09.4', description: 'The instruction version this App was last built to.' }) }),
  },
  responses: {
    200: json(
      z
        .object({
          app_id: z.string(),
          version: z.string().openapi({ example: '2026-11-09.5' }),
          updated: z.string(),
          integrated: z.string().nullable(),
          up_to_date: z.boolean(),
          text: z.string(),
        })
        .openapi('LatestHandoff'),
      'Newest instructions',
    ),
    ...errorResponses(400, 401, 403, 404, 429),
  },
});

handoffRoutes.openapi(route, async (c) => {
  const auth = c.get('auth');
  const { appId } = c.req.valid('param');
  const app = getApp(appId);
  if (!app) return fail(c, 404, 'APP_NOT_FOUND', 'Unknown app');
  // The identity is checked here on every request: a hidden button is not authorization.
  if (auth.appId !== app.app_id) return fail(c, 403, 'FORBIDDEN', 'Only this App’s own session can read this');
  const db = c.env.DB_IDENTITY;
  if ((await roleOf(db, c.env.OWNER_USER_IDS, auth.userId)) !== 'owner') return fail(c, 403, 'FORBIDDEN', 'Owner only');
  const integrated = c.req.valid('query').integrated ?? null;
  if (integrated) {
    await db
      .prepare(
        'INSERT INTO app_handoff_reports (app_id, integrated_version, reported_at, reported_by) VALUES (?, ?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET integrated_version = excluded.integrated_version, reported_at = excluded.reported_at, reported_by = excluded.reported_by',
      )
      .bind(app.app_id, integrated, Date.now(), auth.userId)
      .run();
  }
  const text = buildHandoff(app, new URL(c.req.url).origin, {
    battery: await hasAppBatteryKey(c.env.DB_BATTERY, app.app_id),
    products: await listCatalog(db, app.app_id),
    teamId: centralTeamId(c.env),
  });
  return c.json({ app_id: app.app_id, version: HANDOFF_VERSION, updated: HANDOFF_UPDATED, integrated, up_to_date: integrated === HANDOFF_VERSION, text }, 200, { 'Cache-Control': 'no-store' });
});
