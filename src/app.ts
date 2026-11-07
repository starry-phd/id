import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DOCUMENT_CONFIG, errorResponses, json } from './api/openapi';
import { avatarRoutes } from './apps/avatar-route';
import { directoryRoutes } from './apps/directory';
import { refreshDynamicApps } from './apps/dynamic';
import { appRoutes } from './apps/routes';
import { loadSigningKey } from './auth/access-token';
import { authRoutes } from './auth/routes';
import { batteryRoutes, myBatteryRoutes } from './battery/routes';
import { billingRoutes } from './billing/routes';
import type { AppBindings } from './env';
import { errorBody, type ErrorCode } from './lib/errors';
import { apiCors } from './lib/cors';
import { reportError } from './lib/error-report';
import { limitApi, limitByIp } from './lib/rate-limit';
import { meRoutes } from './me/routes';
import { accountApp, publicPages } from './web/account';
import { loginRelay } from './web/login-relay';
import { adminApp, setApiDocument } from './web/admin';
import { supportApp } from './web/support';

/** The whole Worker: /v1 API (OpenAPI-documented), JWKS, web account center, support and Admin Lite. */
export const app = new OpenAPIHono<AppBindings>();

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
  c.res.headers.set('x-request-id', requestId);
  if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
});
// Apps registered in Admin Lite join config/apps.json (cached per isolate for 30 seconds).
app.use('*', async (c, next) => {
  await refreshDynamicApps(c.env.DB_IDENTITY, Date.now());
  await next();
});
// Avatars are images shown by App web versions on other origins; everything else stays same-origin.
// Registered before secureHeaders so it runs after it and has the last word.
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('cross-origin-resource-policy', c.req.path.startsWith('/v1/avatars/') ? 'cross-origin' : 'same-origin');
});
// Google and Apple web sign-in use popups, which need same-origin-allow-popups;
// their buttons also need the page origin, so the referrer keeps the origin cross-site.
app.use('*', secureHeaders({ crossOriginOpenerPolicy: 'same-origin-allow-popups', referrerPolicy: 'strict-origin-when-cross-origin', crossOriginResourcePolicy: false }));

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Starry access token (ES256, 15 minutes) from /v1/auth/{provider} or /v1/auth/refresh',
});
app.openAPIRegistry.registerComponent('securitySchemes', 'appKey', {
  type: 'apiKey',
  in: 'header',
  name: 'x-starry-app-key',
  description: 'App backend service key (BATTERY_SERVICE_KEYS); never ship it inside an App',
});

const HealthSchema = z.object({ status: z.string(), service: z.string(), environment: z.string(), db: z.string() }).openapi('Health');

const healthRoute = createRoute({
  method: 'get',
  path: '/v1/health',
  tags: ['Platform'],
  summary: 'Liveness plus a D1 round trip',
  responses: { 200: json(HealthSchema, 'Healthy'), 503: json(HealthSchema, 'Database unreachable') },
});

/** Liveness plus a single D1 round trip; 503 when the identity database is unreachable. */
app.openapi(healthRoute, async (c) => {
  let ok: boolean;
  try {
    const row = await c.env.DB_IDENTITY.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    ok = row?.ok === 1;
  } catch {
    ok = false;
  }
  if (ok) return c.json({ status: 'ok', service: 'starry-id', environment: c.env.STARRY_ENV, db: 'ok' }, 200);
  return c.json({ status: 'degraded', service: 'starry-id', environment: c.env.STARRY_ENV, db: 'error' }, 503);
});

const jwksRoute = createRoute({
  method: 'get',
  path: '/.well-known/jwks.json',
  tags: ['Platform'],
  summary: 'Public keys for verifying Starry access tokens (ES256)',
  responses: {
    200: {
      description: 'JSON Web Key Set',
      content: { 'application/json': { schema: z.object({ keys: z.array(z.record(z.string(), z.unknown())) }).openapi('JWKS') } },
    },
    ...errorResponses(503),
  },
});

/** Public key set so other Starry backends (e.g. Echo) can verify access tokens without a shared secret. */
app.openapi(jwksRoute, async (c) => {
  const key = await loadSigningKey(c.env);
  if (!key) return c.json(errorBody('AUTH_NOT_CONFIGURED', 'Signing key not configured', c.get('requestId')), 503);
  c.header('cache-control', 'public, max-age=3600');
  return c.json({ keys: [{ ...key.publicJwk }, ...key.retired.map((r) => ({ ...r.publicJwk }))] }, 200);
});

app.use('/v1/*', apiCors);
app.use('/v1/*', limitApi);
app.use('/v1/auth/*', limitByIp('RL_AUTH'));
app.use('/account/session', limitByIp('RL_WEB'));
app.use('/account/link', limitByIp('RL_WEB'));
app.use('/account/link/merge', limitByIp('RL_WEB'));
app.use('/support', limitByIp('RL_WEB'));
app.use('/auth/*', limitByIp('RL_WEB'));

app.route('/v1/apps', appRoutes);
app.route('/v1/avatars', avatarRoutes);
app.route('/v1/directory', directoryRoutes);
app.route('/v1/billing', billingRoutes);
app.route('/v1/auth', authRoutes);
app.route('/v1/me/battery', myBatteryRoutes);
app.route('/v1/me', meRoutes);
app.route('/v1/battery', batteryRoutes);

// Web account center, support form and Admin Lite (server-rendered, cookie sessions).
app.route('/account', accountApp);
app.route('/support', supportApp);
app.route('/admin', adminApp);
app.route('/auth', loginRelay);
app.route('/', publicPages);

app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Resource not found', c.get('requestId')), 404));

const HTTP_ERROR_CODES: Partial<Record<number, ErrorCode>> = { 400: 'BAD_REQUEST', 413: 'BAD_REQUEST', 415: 'UNSUPPORTED_MEDIA_TYPE' };

app.onError((err, c) => {
  const requestId = c.get('requestId');
  // Malformed JSON and wrong Content-Type from request validation arrive as HTTPException.
  if (err instanceof HTTPException && err.status < 500) {
    const code = HTTP_ERROR_CODES[err.status] ?? 'BAD_REQUEST';
    return c.json(errorBody(code, err.status === 415 ? 'Send the body as application/json' : 'Invalid request', requestId), err.status as ContentfulStatusCode);
  }
  console.error(JSON.stringify({ level: 'error', request_id: requestId, message: err.message }));
  const report = reportError(c.env.SENTRY_DSN, err, { kind: 'request', environment: c.env.STARRY_ENV, requestId, where: `${c.req.method} ${c.req.routePath}` });
  try {
    c.executionCtx.waitUntil(report);
  } catch {
    // No execution context (local tests): the report finishes on its own.
  }
  return c.json(errorBody('INTERNAL', 'Internal error', requestId), 500);
});

/** OpenAPI 3.1 document generated from the route definitions (S-PLT-03). */
export function openApiDocument() {
  return app.getOpenAPI31Document(DOCUMENT_CONFIG);
}

setApiDocument(openApiDocument);
