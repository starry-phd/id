/**
 * AI-1 REBUILD round 2: trusted Starry ID -> AI-2 Billing contract bridge.
 * DRAFT ONLY. No live OIDC/JWKS/PKCE, store receipt verification or D1.
 *
 * A backend request verifier MUST first mint the module-private WeakSet principal
 * using createServerIdentityResolver() and authoritative member/session records.
 * The per-request binding loader MUST read the Starry ID-owned DB, NEVER user JSON.
 * Billing separately verifies Apple/Google store receipts and transaction owner.
 */
import { isTrustedPrincipal } from './index.ts';
import type { TrustedPrincipal, TrustedScope } from './index.ts';

export const STARRY_BILLING_BRIDGE_VERSION = '1.1.0-draft' as const;
export type Store = 'apple' | 'google';
export type StoreEnvironment = 'sandbox' | 'production';

/** Structural compatibility with AI-2 #29 VerifiedStarryIdentity. Not an HTTP DTO. */
export type VerifiedStarryIdentity = Readonly<{
  brandId: 'starry';
  appId: string;
  environment: 'development' | 'staging' | 'production';
  userId: string;
  accountBinding: string;
}>;
/** Structural compatibility with AI-2 #29 StarryAuthPort. */
export type StarryBillingAuthPort = Readonly<{
  verifyCurrentIdentity(): VerifiedStarryIdentity | null;
}>;
export type TrustedStoreScope = TrustedScope & Readonly<{
  store: Store;
  store_app_id: string;
  store_environment: StoreEnvironment;
}>;
/**
 * Starry ID-only account binding:
 * - issued by trusted backend after provider association, NOT a client claim;
 * - must match BOTH current Starry subject and expected app + runtime + store;
 * - Apple appAccountToken is a UUID (backend minted); Google uses a server-issued
 *   opaque obfuscatedAccountId. No derivation from email/phone/name.
 * - Billing owns transaction's immutable first-purchase attribution separately.
 */
export type StoredStoreBinding = Readonly<{
  brand_id: 'starry';
  s_user_id: string;
  app_id: string;
  environment: TrustedScope['environment'];
  store: Store;
  store_app_id: string;
  store_environment: StoreEnvironment;
  account_binding: string;
  revoked_at: number | null;
  expires_at: number | null;
}>;

export type TrustedBillingBridgeDependencies = Readonly<{
  scope: TrustedStoreScope; // trusted Starry AppRegistry / Store registry
  /** Unique entry: AI-4 Worker verified request -> AI-1 resolver; NO client identity. */
  resolvePrincipal: (opaqueRequest: unknown, now: number) => Promise<TrustedPrincipal | null>;
  /** Trusted Starry ID data owner, not HTTP or Billing mutable request data. */
  readCurrentBinding: (key: Readonly<{
    s_user_id: string; app_id: string; environment: TrustedScope['environment'];
    store: Store; store_app_id: string; store_environment: 'sandbox';
  }>) => Promise<StoredStoreBinding | null>;
  nowSeconds: () => number; // clock from trusted server
}>;

const issuedPorts = new WeakSet<object>();
const safeEpoch = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const identifier = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(v);
const appleUuid = (v: string): boolean =>
  /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$/.test(v);
function validBinding(value: unknown, key: TrustedStoreScope & {s_user_id: string}, now: number):
    value is StoredStoreBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Partial<StoredStoreBinding>;
  return b.brand_id === 'starry'
    && b.s_user_id === key.s_user_id && b.app_id === key.app_id
    && b.environment === key.environment
    && b.store === key.store && b.store_app_id === key.store_app_id
    && b.store_environment === 'sandbox' && b.revoked_at === null
    && (b.expires_at === null || (safeEpoch(b.expires_at) && b.expires_at > now))
    && identifier(b.account_binding)
    && (key.store !== 'apple' || appleUuid(b.account_binding));
}
function safeRegistry(scope: TrustedStoreScope): boolean {
  return scope.brand_id === 'starry'
    && identifier(scope.app_id) && identifier(scope.store_app_id)
    && (scope.environment === 'development' || scope.environment === 'staging')
    && (scope.store === 'apple' || scope.store === 'google')
    && scope.store_environment === 'sandbox';
}
export function isServerIssuedStarryBillingPort(value: unknown): value is StarryBillingAuthPort {
  return typeof value === 'object' && value !== null && issuedPorts.has(value);
}

/**
 * Async trust establishment => sync AI-2 port valid for this request only.
 * Returns null if no server-verified active subject or owned binding exists.
 *
 * This port is ephemeral (<=30s) and always expires with the verified Session.
 * Construct a NEW port for every request. NEVER persist/cache this port and
 * NEVER export the returned identity to a mobile/browser HTTP response.
 */
export async function createStarryBillingAuthPortForRequest(
  deps: TrustedBillingBridgeDependencies, opaqueRequest: unknown,
): Promise<StarryBillingAuthPort | null> {
  const scope = Object.freeze({ ...deps.scope });
  if (!safeRegistry(scope)) throw new Error('TRUSTED_STORE_REGISTRY_DENIED');
  const issuedAt = deps.nowSeconds();
  if (!safeEpoch(issuedAt)) return null;
  const principal = await deps.resolvePrincipal(opaqueRequest, issuedAt);
  if (!isTrustedPrincipal(principal)
      || principal.brand_id !== 'starry'
      || principal.app_id !== scope.app_id
      || principal.environment !== scope.environment
      || principal.member_status !== 'active'
      || !identifier(principal.s_user_id)
      || !safeEpoch(principal.auth_version)
      || !safeEpoch(principal.checked_at)
      || principal.checked_at !== issuedAt
      || !safeEpoch(principal.expires_at) || principal.expires_at <= issuedAt) return null;
  const binding = await deps.readCurrentBinding(Object.freeze({
    s_user_id: principal.s_user_id, app_id: scope.app_id,
    environment: scope.environment, store: scope.store,
    store_app_id: scope.store_app_id, store_environment: 'sandbox' as const,
  }));
  // Recheck clock after potentially slow backend DB read; never trust stale snapshot.
  const boundAt = deps.nowSeconds();
  if (!safeEpoch(boundAt) || boundAt < issuedAt || boundAt - issuedAt > 30
      || boundAt >= principal.expires_at
      || !validBinding(binding, { ...scope, s_user_id: principal.s_user_id }, boundAt)) return null;
  const verifiedIdentity = Object.freeze({
    brandId: 'starry' as const,
    appId: principal.app_id,
    environment: principal.environment,
    userId: principal.s_user_id,
    accountBinding: binding.account_binding,
  });
  const port: StarryBillingAuthPort = Object.freeze({
    verifyCurrentIdentity: (): VerifiedStarryIdentity | null => {
      const current = deps.nowSeconds();
      if (!safeEpoch(current) || current < issuedAt || current - issuedAt > 30
          || current >= principal.expires_at
          || (binding.expires_at !== null && current >= binding.expires_at)) return null;
      return verifiedIdentity;
    },
  });
  issuedPorts.add(port);
  return port;
}
