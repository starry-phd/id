/** Public liveness client only. Not an authentication, readiness or admin SDK. */
export type StarryEnvironment = 'development' | 'staging';
export interface StarryLiveness {
  readonly status: 'ok';
  readonly brand_id: 'starry';
  readonly app_id: 'starry-id';
  readonly environment: StarryEnvironment;
  readonly service: 'id-api';
  readonly kind: 'liveness-only';
}
export interface StarryHealthClient {
  check(): Promise<StarryLiveness>;
}
export function createStarryHealthClient(baseUrl: string, fetchImpl: typeof fetch = fetch): StarryHealthClient {
  const origin = new URL(baseUrl);
  if (origin.username || origin.password || origin.search || origin.hash) throw new Error('INVALID_API_ORIGIN');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname))) {
    throw new Error('INSECURE_API_ORIGIN');
  }
  const endpoint = new URL('/v1/health', origin);
  return {
    async check() {
      const response = await fetchImpl(endpoint.toString(), {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        headers: {accept: 'application/json'},
      });
      if (!response.ok) throw new Error('STARRY_HEALTH_UNAVAILABLE');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('STARRY_HEALTH_RESPONSE_INVALID');
      const data = value as Record<string, unknown>;
      if (data.status !== 'ok' || data.brand_id !== 'starry' || data.app_id !== 'starry-id'
        || (data.environment !== 'development' && data.environment !== 'staging')
        || data.service !== 'id-api' || data.kind !== 'liveness-only') {
        throw new Error('STARRY_HEALTH_RESPONSE_INVALID');
      }
      return data as unknown as StarryLiveness;
    },
  };
}
/** Cross-brand communication is intentionally absent until both-brand Gate approval. */
export const CROSS_BRAND_SYNC_STATUS = 'FEATURE_DISABLED' as const;
export interface DisabledMemberSyncPort {
  sync(): Promise<{ readonly ok: false; readonly code: typeof CROSS_BRAND_SYNC_STATUS }>;
}
export const disabledMemberSyncPort: DisabledMemberSyncPort = Object.freeze({
  async sync() { return {ok: false as const, code: CROSS_BRAND_SYNC_STATUS}; },
});
