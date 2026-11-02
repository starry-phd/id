import type { Env } from '../env';

export type Provider = 'apple' | 'google';
export type ProviderJwk = JsonWebKey & { kid?: string };

export const PROVIDERS: Readonly<Record<Provider, { issuers: readonly string[]; jwksUrl: string }>> = {
  apple: {
    issuers: ['https://appleid.apple.com'],
    jwksUrl: 'https://appleid.apple.com/auth/keys',
  },
  google: {
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  },
};

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<Provider, { keys: ProviderJwk[]; fetchedAt: number }>();

function parseKeys(value: unknown): ProviderJwk[] {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { keys?: unknown }).keys)) return [];
  return ((value as { keys: unknown[] }).keys).filter(
    (k): k is ProviderJwk => typeof k === 'object' && k !== null && (k as JsonWebKey).kty === 'RSA',
  );
}

/**
 * Public signing keys of Apple or Google. Cached per isolate for one hour;
 * `forceRefresh` is used once when a token names an unknown key id (rotation).
 * In development only, AUTH_TEST_JWKS replaces the network so tests never call Apple or Google.
 */
export async function getProviderKeys(env: Env, provider: Provider, now: number, forceRefresh = false): Promise<ProviderJwk[]> {
  if (env.STARRY_ENV === 'development' && env.AUTH_TEST_JWKS) {
    try {
      const all: unknown = JSON.parse(env.AUTH_TEST_JWKS);
      return typeof all === 'object' && all !== null ? parseKeys((all as Record<string, unknown>)[provider]) : [];
    } catch {
      return [];
    }
  }
  const cached = cache.get(provider);
  if (!forceRefresh && cached && now - cached.fetchedAt < CACHE_MS) return cached.keys;
  const res = await fetch(PROVIDERS[provider].jwksUrl, { headers: { accept: 'application/json' } });
  if (!res.ok) return cached?.keys ?? [];
  const keys = parseKeys(await res.json());
  if (keys.length > 0) cache.set(provider, { keys, fetchedAt: now });
  return keys;
}
