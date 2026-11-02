import { createRoute, z } from '@hono/zod-openapi';
import { apiRouter, errorResponses, json, jsonBody } from '../api/openapi';
import { getApp } from '../apps/registry';
import { background, fail } from '../auth/routes';
import { WEB_APP_ID } from '../identity/web-sessions';
import { parseWebhook, perAppSecrets, processPendingEvents, recordEvent, webhookAuthorized } from './revenuecat';

export const billingRoutes = apiRouter();

const webhookRoute = createRoute({
  method: 'post',
  path: '/revenuecat/{appId}',
  tags: ['Purchases'],
  summary: "RevenueCat webhook for one App's RevenueCat project",
  description: 'Authorization must equal the value configured in RevenueCat. Events are stored once by id and projected after the response (S-BIL-04).',
  request: {
    params: z.object({ appId: z.string().openapi({ example: 'echo' }) }),
    headers: z.object({ authorization: z.string().optional() }),
    body: jsonBody(z.object({ api_version: z.string().optional(), event: z.record(z.string(), z.unknown()) })),
  },
  responses: {
    200: json(z.object({ received: z.boolean(), duplicate: z.boolean() }), 'Stored'),
    ...errorResponses(400, 401, 404, 415, 429, 503),
  },
});

billingRoutes.openapi(webhookRoute, async (c) => {
  const { appId } = c.req.valid('param');
  if (appId === WEB_APP_ID || !getApp(appId)) return fail(c, 404, 'APP_NOT_FOUND', 'Unknown app');
  const secret = perAppSecrets(c.env.REVENUECAT_WEBHOOK_AUTH)[appId];
  if (!secret) return fail(c, 503, 'SERVICE_UNAVAILABLE', 'Webhook not configured for this app');
  if (!webhookAuthorized(c.req.header('authorization'), secret)) return fail(c, 401, 'UNAUTHORIZED', 'Invalid webhook authorization');
  const parsed = parseWebhook(c.req.valid('json'));
  if (!parsed) return fail(c, 400, 'BAD_REQUEST', 'Not a RevenueCat event');
  const now = Date.now();
  const stored = await recordEvent(c.env.DB_BILLING, appId, parsed, now);
  if (stored === 'new') {
    const pending = background(c, processPendingEvents(c.env.DB_BILLING, now, 10));
    if (pending) await pending;
  }
  return c.json({ received: true, duplicate: stored === 'duplicate' }, 200);
});
