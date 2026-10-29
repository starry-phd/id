/** Isolated integration client; not exported from the public SDK or wired to any app. */
export const SELF_PROFILE_CLIENT_PATH = '/v1/starry-id/members/me' as const;
export type IsolatedSelfProfile = Readonly<{
  s_user_id: string; display_name: string | null; directory_opt_in: boolean;
  display_name_public: boolean; profile_revision: number;
}>;
type Failure = 'FEATURE_DISABLED' | 'AUTH_REQUIRED' | 'CURRENT_RECORD_DENIED'
  | 'SERVICE_UNAVAILABLE' | 'PROTOCOL_DENIED';
export type SelfProfileReadResult = Readonly<
  {ok: true; profile: IsolatedSelfProfile} | {ok: false; code: Failure}
>;
const fail = (code: Failure): SelfProfileReadResult => Object.freeze({ok: false, code});
const keys = ['s_user_id','display_name','directory_opt_in','display_name_public','profile_revision'].sort();
function profile(value: unknown): IsolatedSelfProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== keys.join('|')
    || typeof row.s_user_id !== 'string' || !/^[A-Za-z0-9._:-]{1,180}$/.test(row.s_user_id)
    || typeof row.directory_opt_in !== 'boolean' || typeof row.display_name_public !== 'boolean'
    || typeof row.profile_revision !== 'number' || !Number.isSafeInteger(row.profile_revision)
    || row.profile_revision < 1 || row.profile_revision >= Number.MAX_SAFE_INTEGER
    || (row.display_name !== null && (typeof row.display_name !== 'string'
      || row.display_name.trim() !== row.display_name || row.display_name.length < 1
      || row.display_name.length > 80
      || [...row.display_name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)))) return null;
  return Object.freeze({
    s_user_id: row.s_user_id, display_name: row.display_name as string | null,
    directory_opt_in: row.directory_opt_in, display_name_public: row.display_name_public,
    profile_revision: row.profile_revision,
  });
}
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('NO_BODY');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 16384) throw new Error('BODY_LIMIT');
      chunks.push(next.value);
    }
  } catch {
    try { await reader.cancel(); } catch { /* cancellation must not disclose errors */ }
    throw new Error('BODY_DENIED');
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}
export function createIsolatedSelfProfileClient(deps: Readonly<{
  enabled?: boolean; environment: 'development' | 'staging'; origin: string;
  getBearer: () => Promise<string | null>;
  /** Explicit local transport required. No ambient fetch/default live URL. */
  fetchImpl: (request: Request) => Promise<Response>;
}>) {
  const origin = new URL(deps.origin);
  if (!['development','staging'].includes(deps.environment)
    || origin.protocol !== 'https:' || origin.username || origin.password
    || origin.search || origin.hash || origin.pathname !== '/'
    || typeof deps.getBearer !== 'function' || typeof deps.fetchImpl !== 'function')
    throw new Error('ISOLATED_CLIENT_CONFIG_DENIED');
  const endpoint = new URL(SELF_PROFILE_CLIENT_PATH, origin).toString();
  const enabled = deps.enabled === true;
  return Object.freeze({
    async readSelf(): Promise<SelfProfileReadResult> {
      if (!enabled) return fail('FEATURE_DISABLED');
      try {
        const bearer = await deps.getBearer();
        if (typeof bearer !== 'string' || !/^v1\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{43}$/.test(bearer))
          return fail('AUTH_REQUIRED');
        const response = await deps.fetchImpl(new Request(endpoint, {
          method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: {accept: 'application/json', authorization: 'Bearer ' + bearer},
        }));
        if (response.redirected || (response.url && response.url !== endpoint)) return fail('PROTOCOL_DENIED');
        if (response.status === 401) return fail('AUTH_REQUIRED');
        if (response.status === 403) return fail('CURRENT_RECORD_DENIED');
        if (response.status === 503) return fail('SERVICE_UNAVAILABLE');
        if (response.status !== 200
          || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
          || !(response.headers.get('cache-control') ?? '').split(',').some(x => x.trim().toLowerCase() === 'no-store'))
          return fail('PROTOCOL_DENIED');
        let decoded: unknown;
        try { decoded = await boundedJson(response); } catch { return fail('PROTOCOL_DENIED'); }
        const value = profile(decoded);
        return value ? Object.freeze({ok: true, profile: value}) : fail('PROTOCOL_DENIED');
      } catch { return fail('SERVICE_UNAVAILABLE'); }
    },
  });
}
