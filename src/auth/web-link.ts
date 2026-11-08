import { createRoute, z } from '@hono/zod-openapi';
import { apiRouter, bearer, errorResponses, json, jsonBody } from '../api/openapi';
import { issueNonce } from '../identity/nonces';
import { WEB_APP_ID } from '../identity/web-sessions';
import { seal } from '../lib/sealed';
import { requireAuth } from './middleware';
import { fail } from './routes';

/**
 * App → in-App web view without a second sign-in. The App calls POST /v1/me/web-link with its access token and
 * opens the returned URL in its web view; GET /auth/app-open (src/web/app-open.ts) turns the single-use code in
 * that URL into the web account session cookie and lands on the requested member page.
 */
export const webLinkRoutes = apiRouter();

export const WEB_LINK_CONTEXT = 'app-web-link-v1';
export const WEB_LINK_TTL_MS = 2 * 60 * 1000;
export const WEB_LINK_PAGES = ['card', 'profile', 'referral', 'network', 'apps'] as const;
export type WebLinkPage = (typeof WEB_LINK_PAGES)[number];

const route = createRoute({
  method: 'post',
  path: '/',
  tags: ['Account'],
  summary: 'Open a Starry member page in the App’s web view already signed in (code works once, for 2 minutes)',
  security: bearer,
  middleware: [requireAuth] as const,
  request: {
    body: jsonBody(
      z.object({
        page: z.enum(WEB_LINK_PAGES).openapi({ description: '`card` is the standard member block of the settings page; the others are the member pages.', example: 'card' }),
      }),
    ),
  },
  responses: { 200: json(z.object({ url: z.string(), expires_in: z.number().int() }).openapi('WebLink'), 'Open this URL in the App’s web view right away'), ...errorResponses(400, 401, 403, 415, 429, 503) },
});

webLinkRoutes.openapi(route, async (c) => {
  const auth = c.get('auth');
  const key = c.env.DATA_ENCRYPTION_KEY;
  if (!key) return fail(c, 503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not available');
  const body = c.req.valid('json');
  const db = c.env.DB_IDENTITY;
  const user = await db.prepare('SELECT session_version FROM users WHERE user_id = ?').bind(auth.userId).first<{ session_version: number }>();
  if (!user) return fail(c, 401, 'UNAUTHORIZED', 'Sign-in required');
  const now = Date.now();
  const nonce = await issueNonce(db, WEB_APP_ID, now);
  const claims = { u: auth.userId, sv: user.session_version, n: nonce, to: body.page, a: auth.appId, exp: now + WEB_LINK_TTL_MS };
  const code = await seal(key, WEB_LINK_CONTEXT, JSON.stringify(claims));
  if (!code) return fail(c, 503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not available');
  return c.json({ url: `${new URL(c.req.url).origin}/auth/app-open?c=${encodeURIComponent(code)}`, expires_in: WEB_LINK_TTL_MS / 1000 }, 200, { 'Cache-Control': 'no-store' });
});
