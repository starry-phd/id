/**
 * AI-1 TrustedStarryPrincipal contract v0.2 (DRAFT, not a live OIDC/session adapter).
 *
 * Each request MUST be authenticated by a server verifier (OIDC/JWKS/PKCE or a
 * cryptographically validated session) and rehydrated with current backend
 * member/session/grants. Neither client JSON nor client "adminVerified" flags
 * are accepted as authority. The verification adapter is NOT implemented here.
 */
import { authorizeAdmin, authorizeSession } from './guards.ts';
import type { Grant, Member, Session, TrustedScope, VerifiedPrincipal } from './guards.ts';

export const STARRY_PRINCIPAL_CONTRACT_VERSION = '0.2.0-draft' as const;
export type AdminPermission = 'billing:refund:review' | 'audit:read';
export type ScopedGrant = Grant & Readonly<{ permission: string }>;
export type PersistedStarrySession = Session & Readonly<{ step_up_at?: number | null }>;
export type StepUpProof = Readonly<{
  source: 'verified-backend-session';
  verified_at: number;  // Unix epoch seconds; set only by trusted server auth
  expires_at: number;
}>;
const principalBrand: unique symbol = Symbol('TrustedStarryPrincipal/AI-1');
const issued = new WeakSet<object>();
const permissionExpiry = new WeakMap<object, ReadonlyMap<AdminPermission, number>>();

export type TrustedStarryPrincipal = Readonly<{
  [principalBrand]: true;
  brand_id: 'starry';
  app_id: string;
  environment: TrustedScope['environment'];
  s_user_id: string;
  session_id: string;
  auth_version: number;
  member_status: 'active';
  session_expires_at: number;
  checked_at: number;
  admin_scopes: readonly AdminPermission[];
  step_up: StepUpProof | null;
}>;

/** Explicit security boundary: only backend adapters may supply these dependencies. */
export type TrustedPrincipalDependencies = Readonly<{
  trustedScope: TrustedScope; // server-side App Registry, never HTTP request input
  auth: Readonly<{
    verifyAfterOidcOrSession: (untrustedRequest: unknown) => Promise<VerifiedPrincipal | null>;
  }>; // MUST perform full cryptographic checks outside this module
  records: Readonly<{
    loadMember: (sUserId: string) => Promise<Member | null>;
    loadSession: (sessionId: string) => Promise<PersistedStarrySession | null>;
    loadGrants: (sUserId: string) => Promise<readonly ScopedGrant[]>;
  }>; // MUST read current authoritative Starry backend state on each request
}>;
const safeTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const safeId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v;

const OPERATIONS: Readonly<Record<AdminPermission, Readonly<{ resource: Grant['resource']; action: Grant['action'] }>>> = {
  'billing:refund:review': { resource: 'billing', action: 'refund' },
  'audit:read': { resource: 'audit', action: 'read' },
};
const PERMISSIONS = Object.keys(OPERATIONS) as AdminPermission[];
const MAX_STEP_UP_AGE_SECONDS = 300;
const MAX_REQUEST_CONTEXT_AGE_SECONDS = 60;

function currentStepUp(s: PersistedStarrySession, now: number): StepUpProof | null {
  if (!safeTime(s.step_up_at) || !safeTime(s.step_up_until)
      || s.step_up_at > now || now - s.step_up_at > MAX_STEP_UP_AGE_SECONDS
      || s.step_up_until <= now) return null;
  return Object.freeze({
    source: 'verified-backend-session' as const,
    verified_at: s.step_up_at,
    expires_at: s.step_up_until,
  });
}

/**
 * Factory only. No publicly exported "trust JSON"/"from client claims" shortcut.
 * Call once per request AFTER a real server verifier is wired in by AI-4.
 * Returning null is a fail-closed refusal, not a valid anonymous principal.
 */
export function createTrustedPrincipalResolver(deps: TrustedPrincipalDependencies):
    (untrustedRequest: unknown, now: number) => Promise<TrustedStarryPrincipal | null> {
  const scope = Object.freeze({ ...deps.trustedScope });
  if (scope.brand_id !== 'starry' || !safeId(scope.app_id)
      || !['development', 'staging', 'production'].includes(scope.environment)) {
    throw new Error('UNTRUSTED_SERVER_SCOPE');
  }
  return async (request, now) => {
    if (!safeTime(now)) return null;
    // The entire request is opaque to this module. The server verifier decides.
    const verified = await deps.auth.verifyAfterOidcOrSession(request);
    if (!verified) return null;
    const [member, session, grants] = await Promise.all([
      deps.records.loadMember(verified.s_user_id),
      deps.records.loadSession(verified.session_id),
      deps.records.loadGrants(verified.s_user_id),
    ]);
    if (!authorizeSession(scope, verified, session, member, now).allowed) return null;
    if (!session || !member) return null;
    const stepUp = currentStepUp(session, now);
    const expiries = new Map<AdminPermission, number>();
    // A grant must be explicitly scoped AND match its canonical resource/action.
    for (const permission of PERMISSIONS) {
      const operation = OPERATIONS[permission];
      for (const grant of grants) {
        if (grant.permission !== permission || !safeTime(grant.expires_at)) continue;
        if (!authorizeAdmin(scope, verified, session, member, grant, operation, now).allowed) continue;
        if (permission === 'billing:refund:review' && !stepUp) continue;
        expiries.set(permission, Math.max(expiries.get(permission) ?? 0, grant.expires_at));
      }
    }
    const result = Object.freeze({
      [principalBrand]: true as const,
      brand_id: 'starry' as const,
      app_id: scope.app_id,
      environment: scope.environment,
      s_user_id: verified.s_user_id,
      session_id: verified.session_id,
      auth_version: verified.auth_version,
      member_status: 'active' as const,
      session_expires_at: Math.min(verified.expires_at, session.expires_at),
      checked_at: now,
      admin_scopes: Object.freeze(Array.from(expiries.keys())),
      step_up: stepUp,
    });
    issued.add(result);
    permissionExpiry.set(result, expiries);
    return result;
  };
}
export function isTrustedStarryPrincipal(value: unknown): value is TrustedStarryPrincipal {
  return typeof value === 'object' && value !== null && issued.has(value);
}
function requirePrincipal(value: unknown, serverScope: TrustedScope, now: number): TrustedStarryPrincipal {
  if (!isTrustedStarryPrincipal(value) || serverScope.brand_id !== 'starry'
      || value.app_id !== serverScope.app_id || value.environment !== serverScope.environment
      || !safeTime(now) || now < value.checked_at
      || now - value.checked_at > MAX_REQUEST_CONTEXT_AGE_SECONDS
      || now >= value.session_expires_at) throw new Error('AUTH_PRINCIPAL_DENIED');
  return value;
}
function requirePermission(p: TrustedStarryPrincipal, permission: AdminPermission, now: number): void {
  const expiresAt = permissionExpiry.get(p)?.get(permission);
  if (!safeTime(expiresAt) || expiresAt <= now || !p.admin_scopes.includes(permission))
    throw new Error('ADMIN_SCOPE_DENIED');
}

/**
 * Adapter to AI-2 Sandbox. Runtime env remains a separate Starry dimension.
 * Store binding, SKU and provider verification MUST be supplied separately
 * by server-owned records; a client-provided account binding is never trusted.
 */
export function billingIdentityAdapter(value: unknown, serverScope: TrustedScope, now: number,
    storeEnvironment: 'sandbox' | 'production'): Readonly<{
      brandId: 'starry'; appId: string; runtimeEnvironment: TrustedScope['environment'];
      storeEnvironment: 'sandbox'; userId: string; authVersion: number; sessionId: string;
    }> {
  const p = requirePrincipal(value, serverScope, now);
  if (storeEnvironment !== 'sandbox') throw new Error('STORE_ENVIRONMENT_DENIED');
  return Object.freeze({
    brandId: 'starry' as const, appId: p.app_id,
    runtimeEnvironment: p.environment, storeEnvironment: 'sandbox' as const,
    userId: p.s_user_id, authVersion: p.auth_version, sessionId: p.session_id,
  });
}

/** Shape compatible with AI-2 RefundReviewPrincipal. REVIEW only; no refund API. */
export function billingRefundReviewAdapter(value: unknown, serverScope: TrustedScope, now: number,
    storeEnvironment: 'sandbox' | 'production'): Readonly<{
      brandId: 'starry'; environment: 'sandbox'; appIds: readonly string[];
      scopes: readonly ['billing:refund:review']; stepUpAt: string;
    }> {
  const p = requirePrincipal(value, serverScope, now);
  if (storeEnvironment !== 'sandbox') throw new Error('STORE_ENVIRONMENT_DENIED');
  requirePermission(p, 'billing:refund:review', now);
  if (!p.step_up || p.step_up.verified_at > now
      || now - p.step_up.verified_at > MAX_STEP_UP_AGE_SECONDS
      || p.step_up.expires_at <= now) throw new Error('STEP_UP_REQUIRED');
  return Object.freeze({
    brandId: 'starry' as const, environment: 'sandbox' as const,
    appIds: Object.freeze([p.app_id]),
    scopes: Object.freeze(['billing:refund:review'] as const),
    stepUpAt: new Date(p.step_up.verified_at * 1000).toISOString(),
  });
}

/** AI-3 audit metadata only; canonical P05 EventEnvelope belongs to AI-0. */
export function auditReadActorAdapter(value: unknown, serverScope: TrustedScope, now: number):
    Readonly<{ actor_kind: 'user'; actor_id: string; permission: 'audit:read'; action: 'audit:read' }> {
  const p = requirePrincipal(value, serverScope, now);
  requirePermission(p, 'audit:read', now);
  return Object.freeze({
    actor_kind: 'user' as const, actor_id: p.s_user_id,
    permission: 'audit:read' as const, action: 'audit:read' as const,
  });
}
