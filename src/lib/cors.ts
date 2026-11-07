import type { MiddlewareHandler } from 'hono';
import { appRegistry } from '../apps/registry';
import type { AppBindings } from '../env';

/**
 * CORS for the web versions of Starry Apps (spec security: CORS allowlist). Only origins listed
 * in an App's "web_origins" (registered in Admin Lite) may call /v1 from a browser. Tokens travel in the
 * Authorization header, never in cookies, so credentials are not allowed.
 */

const ALLOW_HEADERS = 'authorization, content-type, if-match, x-starry-app-key';
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const EXPOSE_HEADERS = 'etag, x-request-id, retry-after';

export function corsOriginAllowed(origin: string | undefined): origin is string {
  return origin !== undefined && appRegistry.values().some((app) => app.web_origins.includes(origin));
}

export const apiCors: MiddlewareHandler<AppBindings> = async (c, next) => {
  const origin = c.req.header('origin');
  const allowed = corsOriginAllowed(origin);
  if (c.req.method === 'OPTIONS') {
    // Preflight: answered here, never reaching rate limits or routes.
    const headers = new Headers({ vary: 'Origin' });
    if (allowed) {
      headers.set('access-control-allow-origin', origin);
      headers.set('access-control-allow-methods', ALLOW_METHODS);
      headers.set('access-control-allow-headers', ALLOW_HEADERS);
      headers.set('access-control-max-age', '600');
    }
    return new Response(null, { status: 204, headers });
  }
  await next();
  c.res.headers.append('vary', 'Origin');
  if (allowed) {
    c.res.headers.set('access-control-allow-origin', origin);
    c.res.headers.set('access-control-expose-headers', EXPOSE_HEADERS);
  }
};
