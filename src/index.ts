import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { appRoutes } from './apps/routes';
import { loadSigningKey } from './auth/access-token';
import { authRoutes } from './auth/routes';
import type { AppBindings, Env } from './env';
import { runDailyMaintenance } from './identity/maintenance';
import { errorBody } from './lib/errors';
import { meRoutes } from './me/routes';

const app = new Hono<AppBindings>();

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
  c.res.headers.set('x-request-id', requestId);
  if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
});
app.use('*', secureHeaders());

/** Liveness plus a single D1 round trip; 503 when the identity database is unreachable. */
app.get('/v1/health', async (c) => {
  let db: 'ok' | 'error' = 'ok';
  try {
    const row = await c.env.DB_IDENTITY.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    if (row?.ok !== 1) db = 'error';
  } catch {
    db = 'error';
  }
  const body = { status: db === 'ok' ? 'ok' : 'degraded', service: 'starry-id', environment: c.env.STARRY_ENV, db };
  return c.json(body, db === 'ok' ? 200 : 503);
});

/** Public key set so other Starry backends (e.g. Echo) can verify access tokens without a shared secret. */
app.get('/.well-known/jwks.json', async (c) => {
  const key = await loadSigningKey(c.env);
  if (!key) return c.json(errorBody('AUTH_NOT_CONFIGURED', 'Signing key not configured', c.get('requestId')), 503);
  c.header('cache-control', 'public, max-age=3600');
  return c.json({ keys: [key.publicJwk] });
});

app.route('/v1/apps', appRoutes);
app.route('/v1/auth', authRoutes);
app.route('/v1/me', meRoutes);

app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Resource not found', c.get('requestId')), 404));

app.onError((err, c) => {
  console.error(JSON.stringify({ level: 'error', request_id: c.get('requestId'), message: err.message }));
  return c.json(errorBody('INTERNAL', 'Internal error', c.get('requestId')), 500);
});

/** Cron Trigger (wrangler.jsonc "triggers"): daily purge, revocations and retention (S-ID-06, S-PLT-06). */
async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  try {
    const report = await runDailyMaintenance({ db: env.DB_IDENTITY, secrets: env, fetch: (url, init) => fetch(url, init) }, controller.scheduledTime);
    console.log(JSON.stringify({ level: 'info', event: 'maintenance.daily', ...report }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'maintenance.daily', message: error instanceof Error ? error.message : 'failed' }));
    throw error;
  }
}

export default { fetch: app.fetch, scheduled };
