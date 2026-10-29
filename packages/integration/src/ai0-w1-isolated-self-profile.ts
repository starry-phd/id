/**
 * AI-0 W1 isolated read-only HTTP composition. NOT registered in any Worker.
 * Existing AI-1 signature/current-record verification remains authoritative.
 * No issuer, mutation, deployment binding or production capability is added.
 */
import {createOfflineStarryRequestAuthBoundary} from '../../../modules/starry-id-v1/src/r23-signed-session-d1-request-boundary.ts';
import {createVerifiedSignedSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import type {D1Database} from '../../../modules/starry-id-v1/src/d1-ports.ts';
import type {TrustedScope, SelfProfile} from '../../../modules/starry-id-v1/src/index.ts';

export const SELF_PROFILE_PATH = '/v1/starry-id/members/me' as const;
export const SELF_PROFILE_LIVE_ENABLED = false as const;
const validTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const response = (status: number, payload: object, allow?: string): Response => {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'pragma': 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  if (allow) headers.allow = allow;
  return new Response(JSON.stringify(payload), {status, headers});
};
const error = (status: number, code: string, allow?: string) => response(status, {error: {code}}, allow);
type Snapshot = {
  s_user_id: string; display_name: string | null; directory_opt_in: number;
  display_name_public: number; profile_revision: number;
};
function project(row: Snapshot, memberId: string): SelfProfile | null {
  if (row.s_user_id !== memberId || !Number.isSafeInteger(row.profile_revision)
    || row.profile_revision < 1 || row.profile_revision === Number.MAX_SAFE_INTEGER
    || ![0,1].includes(row.directory_opt_in) || ![0,1].includes(row.display_name_public)
    || (row.display_name !== null && (typeof row.display_name !== 'string'
      || row.display_name.length < 1 || row.display_name.length > 80
      || row.display_name.trim() !== row.display_name || [...row.display_name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)))) return null;
  // Never spread the database record: private or future columns cannot leak.
  return Object.freeze({
    s_user_id: row.s_user_id, display_name: row.display_name,
    directory_opt_in: row.directory_opt_in === 1, display_name_public: row.display_name_public === 1,
    profile_revision: row.profile_revision,
  });
}
export function createIsolatedSelfProfileHandler(deps: Readonly<{
  enabled?: boolean; serverScope: TrustedScope; expectedOrigin: string;
  authDb: D1Database; getVerificationKey: (kid: string) => Promise<CryptoKey | null>;
  /** Trusted server clock, seconds. Never obtain from query/header/body. */
  now: () => number;
}>) {
  if (deps.serverScope?.app_id !== 'starry-id' || typeof deps.now !== 'function')
    throw new Error('SELF_PROFILE_SCOPE_OR_CLOCK_DENIED');
  // This constructor also rejects production, foreign brands and unsafe origins.
  const auth = createOfflineStarryRequestAuthBoundary(deps);
  const scope = Object.freeze({...deps.serverScope});
  const expectedOrigin = new URL(deps.expectedOrigin).origin;
  const enabled = deps.enabled === true;
  // The sealed principal deliberately omits provider subject. Reuse the existing
  // crypto verifier to bind the final snapshot to that exact signed identity too.
  const verifyEvidence = createVerifiedSignedSession({scope, getKey: deps.getVerificationKey});
  return Object.freeze({
    live_enabled: SELF_PROFILE_LIVE_ENABLED,
    async handle(request: Request): Promise<Response> {
      if (!enabled) return error(503, 'FEATURE_DISABLED');
      try {
        const url = new URL(request.url);
        if (url.origin !== expectedOrigin || url.pathname !== SELF_PROFILE_PATH) return error(404, 'NOT_FOUND');
        if (request.method !== 'GET') return error(405, 'METHOD_NOT_ALLOWED', 'GET');
        // Do not accept a caller-selected member, cached login state or URL credentials.
        if (url.search || url.hash || url.username || url.password) return error(400, 'REQUEST_DENIED');
        const started = deps.now();
        if (!validTime(started)) return error(503, 'SERVICE_UNAVAILABLE');
        const principal = await auth.authenticate(request, started);
        if (!principal) return error(401, 'IDENTITY_DENIED');
        const evidence = await verifyEvidence(request.headers.get('authorization')?.slice(7), started);
        if (!evidence || evidence.s_user_id !== principal.s_user_id
          || evidence.session_id !== principal.session_id || evidence.auth_version !== principal.auth_version)
          return error(401, 'IDENTITY_DENIED');
        const checked = deps.now();
        // Recheck trusted time after key/DB awaits; no stale signed request survives expiry.
        if (!validTime(checked) || checked < started || checked - started > 5
          || checked >= principal.expires_at) return error(401, 'IDENTITY_DENIED');
        // One SELECT supplies the profile and rechecks member/session at one read snapshot.
        // This is a read fence, NOT a cross-D1 transaction or a write/Queue authority.
        const row = await deps.authDb.prepare(
          'SELECT m.s_user_id,m.display_name,m.directory_opt_in,m.display_name_public,m.profile_revision ' +
          'FROM starry_members m JOIN starry_sessions s ON s.s_user_id=m.s_user_id ' +
          "WHERE m.s_user_id=? AND m.status='active' AND m.auth_version=? " +
          'AND s.session_id=? AND s.app_id=? AND s.environment=? ' +
          'AND s.auth_version=m.auth_version AND s.revoked_at IS NULL AND s.expires_at>? ' +
          'AND EXISTS(SELECT 1 FROM starry_identities i WHERE i.s_user_id=m.s_user_id AND i.provider=? AND i.subject=?)'
        ).bind(principal.s_user_id, principal.auth_version, principal.session_id,
          scope.app_id, scope.environment, checked, evidence.provider, evidence.provider_subject).first<Snapshot>();
        if (!row) return error(403, 'CURRENT_RECORD_DENIED');
        const finished = deps.now();
        if (!validTime(finished) || finished < checked || finished - started > 5
          || finished >= principal.expires_at) return error(401, 'IDENTITY_DENIED');
        const profile = project(row, principal.s_user_id);
        return profile ? response(200, profile) : error(503, 'SERVICE_UNAVAILABLE');
      } catch {
        // Never return key-ring/SQL exceptions, tokens or internal identifiers.
        return error(503, 'SERVICE_UNAVAILABLE');
      }
    },
  });
}
