import { Hono } from 'hono';
import type { AppBindings } from '../env';
import { errorBody } from '../lib/errors';
import { getApp } from './registry';
import { withEffectiveStatus } from './status';

export const appRoutes = new Hono<AppBindings>();

/**
 * Remote config read by each App at launch (S-PLT-02). The App must stop or
 * ask for an update when status is not "active" or its version is below
 * min_version. Only whitelisted, non-secret values are ever returned.
 */
appRoutes.get('/:appId/config', async (c) => {
  const configured = getApp(c.req.param('appId'));
  if (!configured) {
    return c.json(errorBody('APP_NOT_FOUND', 'Unknown app', c.get('requestId')), 404);
  }
  const app = await withEffectiveStatus(c.env.DB_IDENTITY, configured, Date.now());
  return c.json({
    app_id: app.app_id,
    status: app.status,
    min_version: app.min_version,
    config: app.config,
  });
});
