/**
 * W3 / AI-1: opt-in LOCAL vNext HTTP wrapper; never a Cloudflare Worker route.
 * No new verifier, principal issuer, SQL, profile projector, SDK or writer.
 * Old #244 HTTP wire remains unchanged. All dependency ports are injected.
 */
import {
  createOfflineW2CurrentAuthOutcomeAdapter, takeW2VerifiedPrincipal,
} from './w2-r23-auth-outcome-adapter.ts';
import {createIsolatedSelfProfileHandler, SELF_PROFILE_PATH}
  from '../../../packages/integration/src/ai0-w1-isolated-self-profile.ts';
import type {D1Database} from './d1-ports.ts';
import type {TrustedScope} from './index.ts';

export const W3_LOCAL_VNEXT_CONTRACT = 'starry.ai1.w3.self-profile.local-vnext' as const;
export const W3_LOCAL_VNEXT_LIVE_ENABLED = false as const;

type Deps = Readonly<{
  enabled?: boolean;
  serverScope: TrustedScope;
  expectedOrigin: string;
  authDb: D1Database;
  getVerificationKey: (kid: string) => Promise<CryptoKey | null>;
  now: () => number;
}>;

function deny(status: number, code: string, allow?: string): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'pragma': 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  if (allow) headers.allow = allow;
  return new Response(JSON.stringify({error: {code}}), {status, headers});
}

/** Intended for explicit in-process test dispatch only. Never export default. */
export function createLocalOnlyVNextTypedSelfProfileHandler(deps: Deps) {
  // Both original constructors enforce Starry-only, dev/staging and trusted
  // HTTPS origin even while disabled. Do not introduce a weaker config path.
  const auth = createOfflineW2CurrentAuthOutcomeAdapter(deps);
  const original = createIsolatedSelfProfileHandler(deps);
  const origin = new URL(deps.expectedOrigin).origin;
  const enabled = deps.enabled === true;
  return Object.freeze({
    contract: W3_LOCAL_VNEXT_CONTRACT,
    local_only: true as const,
    deployed: W3_LOCAL_VNEXT_LIVE_ENABLED,
    public_worker_route_registered: false as const,
    async handle(request: Request): Promise<Response> {
      if (!enabled) return deny(503, 'FEATURE_DISABLED');
      if (!(request instanceof Request)) return deny(400, 'REQUEST_DENIED');
      let url: URL;
      try { url = new URL(request.url); }
      catch { return deny(404, 'NOT_FOUND'); }
      // Match #244's path -> method -> query precedence before any Auth I/O.
      // These additional origin/host checks can only narrow local access.
      if (url.origin !== origin || url.pathname !== SELF_PROFILE_PATH ||
        url.username || url.password ||
        (request.headers.has('host') && request.headers.get('host') !== url.host) ||
        (request.headers.has('origin') && request.headers.get('origin') !== origin))
        return deny(404, 'NOT_FOUND');
      if (request.method !== 'GET') return deny(405, 'METHOD_NOT_ALLOWED', 'GET');
      if (url.search || url.hash) return deny(400, 'REQUEST_DENIED');
      // No cookie, proxy credential or client-provided login status accepted.
      if (request.headers.has('cookie') ||
        request.headers.has('proxy-authorization') ||
        request.headers.has('x-forwarded-authorization'))
        return deny(401, 'IDENTITY_DENIED');
      const outcome = await auth.authenticate(request);
      if (outcome.status === 'dependency_unavailable')
        return deny(503, 'SERVICE_UNAVAILABLE');
      if (outcome.status !== 'verified' || !takeW2VerifiedPrincipal(outcome))
        return deny(401, 'IDENTITY_DENIED');
      // Critical: successful W2 precheck is NOT a replacement for #244.
      // Original handler verifies HMAC/current Auth again and performs its
      // final single SELECT fence, preserving all five DTO fields/wire codes.
      return original.handle(request);
    },
  });
}
