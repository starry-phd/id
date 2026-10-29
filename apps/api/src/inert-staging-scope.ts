// Local review-only contract for AI-1 M1. NEVER imported by the deployed Worker.
// It registers the shape of a future staging route but never calls Auth, DB or issuer.
export type InertDecision =
  | Readonly<{kind: 'reserved_inert'; dispatchable: false; auth: 'starry-session'; port: 'STARRY_SESSION_DB'}>
  | Readonly<{kind: 'not_found'; dispatchable: false}>;

export function resolveInertStagingCandidate(
  request: Request,
  environment: string,
): InertDecision {
  let path: string;
  try { path = new URL(request.url).pathname; }
  catch { return {kind: 'not_found', dispatchable: false}; }
  if (environment !== 'staging' ||
      request.method !== 'GET' ||
      path !== '/v1/starry-id/members/me' ||
      new URL(request.url).search !== '' ||
      request.headers.has('authorization') ||
      request.headers.has('cookie')) {
    return {kind: 'not_found', dispatchable: false};
  }
  // A route reservation is NOT an authenticated API response or a deployable binding.
  return Object.freeze({
    kind: 'reserved_inert' as const,
    dispatchable: false as const,
    auth: 'starry-session' as const,
    port: 'STARRY_SESSION_DB' as const,
  });
}
