import { Hono } from 'hono';
import { getApp } from '../apps/registry';
import { background } from '../auth/routes';
import type { AppBindings } from '../env';
import { WEB_APP_ID } from '../identity/web-sessions';
import { errorBody } from '../lib/errors';
import { parseWebhook, perAppSecrets, processPendingEvents, recordEvent, webhookAuthorized } from './revenuecat';

export const billingRoutes = new Hono<AppBindings>();

/**
 * POST /v1/billing/revenuecat/{app_id} — RevenueCat webhook of that App's project (S-BIL-04).
 * Checks the configured Authorization value, stores the event once by id, answers 200 at
 * once and updates the projection after the response; the cron retries anything left over.
 */
billingRoutes.post('/revenuecat/:appId', async (c) => {
  const requestId = c.get('requestId');
  const appId = c.req.param('appId');
  if (appId === WEB_APP_ID || !getApp(appId)) return c.json(errorBody('APP_NOT_FOUND', 'Unknown app', requestId), 404);
  const secret = perAppSecrets(c.env.REVENUECAT_WEBHOOK_AUTH)[appId];
  if (!secret) return c.json(errorBody('SERVICE_UNAVAILABLE', 'Webhook not configured for this app', requestId), 503);
  if (!webhookAuthorized(c.req.header('authorization'), secret)) return c.json(errorBody('UNAUTHORIZED', 'Invalid webhook authorization', requestId), 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(errorBody('BAD_REQUEST', 'Invalid JSON', requestId), 400);
  }
  const parsed = parseWebhook(body);
  if (!parsed) return c.json(errorBody('BAD_REQUEST', 'Not a RevenueCat event', requestId), 400);
  const now = Date.now();
  const stored = await recordEvent(c.env.DB_BILLING, appId, parsed, now);
  if (stored === 'new') {
    const pending = background(c, processPendingEvents(c.env.DB_BILLING, now, 10));
    if (pending) await pending;
  }
  return c.json({ received: true, duplicate: stored === 'duplicate' });
});
