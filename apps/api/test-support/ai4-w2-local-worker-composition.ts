/**
 * AI-4 W2: TEST-SUPPORT ONLY. This module is NOT imported by the Worker entrypoint,
 * public SDK, Expo or Wrangler. It cannot authorize Cloudflare routes or release.
 *
 * Reuses the unchanged Worker health implementation and the AI-0 W1 isolated
 * signed-session/current-SQLite handler. No token issuer, read path or DB writer.
 */
import {handleRequest} from '../src/index.ts';
import type {Env} from '../src/index.ts';
import {
  createIsolatedSelfProfileHandler,
  SELF_PROFILE_PATH,
} from '../../../packages/integration/src/ai0-w1-isolated-self-profile.ts';
import type {D1Database} from '../../../modules/starry-id-v1/src/d1-ports.ts';
import type {TrustedScope} from '../../../modules/starry-id-v1/src/index.ts';

export const LOCAL_WORKER_COMPOSITION_IS_DEPLOYED = false as const;

type LocalDependencies = Readonly<{
  /** Server-owned, never read from URL, client headers or request JSON. */
  serverScope: TrustedScope;
  /** Injected trusted Worker variables, not client-provided metadata. */
  runtimeEnv: Env;
  expectedOrigin: string;
  authDb: D1Database;
  getVerificationKey: (kid: string) => Promise<CryptoKey | null>;
  now: () => number;
  /** Only explicit in-process fixture activation; defaults OFF. */
  enabled?: boolean;
}>;

const deny = (status: number, code: string): Response =>
  new Response(JSON.stringify({error: {code}}), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'pragma': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  });

/**
 * In-process local dispatch only: this is deliberately NOT an export default
 * Worker fetch handler and is NOT connected to apps/api/src/index.ts.
 */
export function createLocalOnlyStarryWorkerComposition(deps: LocalDependencies) {
  const scope = deps?.serverScope;
  const env = deps?.runtimeEnv;
  if (scope?.brand_id !== 'starry' || scope.app_id !== 'starry-id'
    || (scope.environment !== 'development' && scope.environment !== 'staging')
    || env?.STARRY_APP_ID !== 'starry-id'
    || env.STARRY_ENVIRONMENT !== scope.environment) {
    throw new Error('LOCAL_WORKER_TRUSTED_SCOPE_DENIED');
  }

  let origin: URL;
  try {
    origin = new URL(deps.expectedOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash
      || origin.toString() !== origin.origin + '/') {
      throw new Error('UNTRUSTED_ORIGIN');
    }
  } catch {
    throw new Error('LOCAL_WORKER_TRUSTED_ORIGIN_DENIED');
  }

  // Delegate ALL profile verification + final snapshot reads to the original
  // AI-0 W1 handler. Default OFF is enforced by that handler as well.
  const member = createIsolatedSelfProfileHandler({
    serverScope: Object.freeze({...scope}),
    expectedOrigin: origin.origin,
    authDb: deps.authDb,
    getVerificationKey: deps.getVerificationKey,
    now: deps.now,
    enabled: deps.enabled === true,
  });
  const trustedEnv: Env = Object.freeze({
    STARRY_ENVIRONMENT: scope.environment,
    STARRY_APP_ID: 'starry-id',
  });

  return Object.freeze({
    local_only: true as const,
    deployed: LOCAL_WORKER_COMPOSITION_IS_DEPLOYED,
    profile_registered_in_public_worker: false as const,
    async dispatchLocal(request: Request): Promise<Response> {
      if (!(request instanceof Request)) return deny(400, 'REQUEST_DENIED');
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return deny(404, 'NOT_FOUND');
      }
      // Guard every path (including health) before evaluating a handler. Never
      // trust an arbitrary Host/Origin header as an identity or origin mapping.
      if (url.origin !== origin.origin || url.username || url.password
        || (request.headers.has('host') && request.headers.get('host') !== url.host)
        || (request.headers.has('origin') && request.headers.get('origin') !== origin.origin)) {
        return deny(404, 'NOT_FOUND');
      }
      if (url.pathname === SELF_PROFILE_PATH) return member.handle(request);
      // Preserve the exact existing Worker health and unknown-route behavior;
      // no alias, dynamic member routes, mutation or protected API exposure.
      return handleRequest(request, trustedEnv);
    },
  });
}
