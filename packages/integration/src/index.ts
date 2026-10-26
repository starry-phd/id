/** AI-4 Gate 2 adapter candidate. Pure, UNROUTED, NOT DEPLOYED.
 * Server-only source callbacks are injected by a future verified Worker adapter.
 * Neither this package nor an HTTP request performs OIDC or store verification.
 */
import {
  assertStarryResourceScope, assertStarryEventForScope, isStarryEventEnvelope,
  type StarryEventEnvelope, type StarryResourceScope,
} from '../../contracts/src/index.ts';
import {
  authorizeAdmin, authorizeSession,
  type Grant, type Member, type Operation, type Session,
  type TrustedScope, type VerifiedPrincipal,
} from '../../../modules/starry-auth/src/guards.ts';
import {
  assertRefundReviewAuthorized, applyVerifiedEvent,
  type ApplyResult, type CatalogEntry, type Projection,
  type ProviderVerifiedEvent, type Store,
} from '../../billing-contracts/src/index.ts';
import {
  bindAi3TrustedOperations, idempotencyNamespace, isEventEnvelope,
} from '../../ai3/src/index.ts';

export interface TrustedBackendState {
  readonly scope: TrustedScope;
  /** Verified by actual backend OIDC/JWKS or session service, never request JSON. */
  readonly principal: VerifiedPrincipal | null;
  readonly session: Session | null;
  readonly member: Member | null;
  /** Authoritative, server-loaded grant only. */
  readonly grant: Grant | null;
  /** Backend-recorded recent step-up time in epoch seconds, NOT an HTTP flag. */
  readonly verified_step_up_at: number | null;
}
export type TrustedBackendSource = Readonly<{ loadTrustedState(): TrustedBackendState | null }>;
type Runtime = 'development' | 'staging';

/** This integration candidate never enables production Worker requests. */
function requireBackend(source: TrustedBackendSource, requestedScope: unknown, now: number): TrustedBackendState {
  const state = source.loadTrustedState();
  if (!state) throw new Error('TRUSTED_BACKEND_CONTEXT_REQUIRED');
  if (state.scope.environment !== 'development' && state.scope.environment !== 'staging')
    throw new Error('INTEGRATION_PRODUCTION_DISABLED');
  assertStarryResourceScope(state.scope as StarryResourceScope, requestedScope);
  const verdict = authorizeSession(state.scope, state.principal, state.session, state.member, now);
  if (!verdict.allowed) throw new Error(verdict.reason);
  return state;
}
function requirePermission(state: TrustedBackendState, operation: Operation, now: number): void {
  const result = authorizeAdmin(state.scope, state.principal, state.session, state.member, state.grant, operation, now);
  if (!result.allowed) throw new Error(result.reason);
}
/** Public client cannot grant an admin scope, even by passing adminVerified=true. */
export async function assertTrustedAuditRead(
  source: TrustedBackendSource, clientRequestedScope: unknown, now: number,
): Promise<void> {
  const state = requireBackend(source, clientRequestedScope, now);
  requirePermission(state, { resource: 'audit', action: 'read' }, now);
  if (state.verified_step_up_at === null || !Number.isSafeInteger(state.verified_step_up_at)
    || state.verified_step_up_at > now || now - state.verified_step_up_at > 300
    || state.session?.step_up_until === null || state.session?.step_up_until === undefined
    || state.session.step_up_until <= now) throw new Error('AUDIT_STEP_UP_REQUIRED');
  // AI-3's operation receives an internal policy decision AFTER server-side AI-1 authorization.
  const ai3 = bindAi3TrustedOperations(state.scope, {
    authorizeAdmin: async () => ({allowed:true}),
    authorizeSession: async () => ({allowed:true}),
    resolveNotificationDelivery: async () => null,
  });
  await ai3.assertAuditRead(clientRequestedScope);
}
export interface TrustedSandboxBillingState {
  readonly auth: TrustedBackendState;
  readonly store_environment: 'sandbox' | 'production';
  readonly store: Store;
  readonly store_app_id: string;
  readonly account_binding: string;
  readonly catalog: readonly CatalogEntry[];
  /** Produced ONLY by a future cryptographic provider-verification server boundary. */
  readonly provider_verified_event: ProviderVerifiedEvent | null;
  readonly current: Projection | null;
  /** Backend's transactional dedupe lookup, never a client flag. */
  readonly already_processed: boolean;
}
export type TrustedBillingSource = Readonly<{ loadTrustedBilling(): TrustedSandboxBillingState | null }>;
function requireSandbox(state: TrustedSandboxBillingState): Runtime {
  if (state.auth.scope.environment !== 'development' && state.auth.scope.environment !== 'staging')
    throw new Error('INTEGRATION_PRODUCTION_DISABLED');
  if (state.store_environment !== 'sandbox') throw new Error('STORE_ENVIRONMENT_DENIED');
  return state.auth.scope.environment;
}
/** Candidate-only reducer invocation: no backend signature verifier or DB is wired. */
export function projectServerVerifiedSandboxEvent(
  source: TrustedBillingSource, clientRequestedScope: unknown, now: number,
): ApplyResult {
  const candidate = source.loadTrustedBilling();
  if (!candidate) throw new Error('TRUSTED_BACKEND_CONTEXT_REQUIRED');
  requireSandbox(candidate);
  const state = requireBackend({ loadTrustedState: () => candidate.auth }, clientRequestedScope, now);
  if (!candidate.provider_verified_event) throw new Error('SERVER_PROVIDER_VERIFICATION_REQUIRED');
  return applyVerifiedEvent(candidate.current, candidate.provider_verified_event, {
    brandId: state.scope.brand_id,
    environment: state.scope.environment,
    storeEnvironment: 'sandbox',
    appId: state.scope.app_id,
    store: candidate.store,
    storeAppId: candidate.store_app_id,
    userId: state.principal!.s_user_id,
    accountBinding: candidate.account_binding,
    evaluatedAt: new Date(now * 1000).toISOString(),
  }, candidate.catalog, candidate.already_processed);
}
export interface TrustedRefundReviewState {
  readonly auth: TrustedBackendState;
  readonly store_environment: 'sandbox' | 'production';
  /** A server-generated approval reference, NOT an HTTP-supplied fake ID. */
  readonly server_approval_id: string | null;
}
export function assertTrustedRefundReview(
  source: Readonly<{ loadRefundContext(): TrustedRefundReviewState | null }>,
  clientRequestedScope: unknown, reason: string, now: number,
): void {
  const candidate = source.loadRefundContext();
  if (!candidate) throw new Error('TRUSTED_BACKEND_CONTEXT_REQUIRED');
  if (candidate.auth.scope.environment === 'production') throw new Error('INTEGRATION_PRODUCTION_DISABLED');
  if (candidate.store_environment !== 'sandbox') throw new Error('STORE_ENVIRONMENT_DENIED');
  const state = requireBackend({ loadTrustedState: () => candidate.auth }, clientRequestedScope, now);
  requirePermission(state, { resource: 'billing', action: 'refund' }, now);
  if (state.verified_step_up_at === null || !Number.isSafeInteger(state.verified_step_up_at)
    || state.verified_step_up_at > now || now - state.verified_step_up_at > 300)
    throw new Error('BILLING_STEP_UP_REQUIRED');
  if (!candidate.server_approval_id) throw new Error('SERVER_APPROVAL_REQUIRED');
  assertRefundReviewAuthorized({
    brandId: state.scope.brand_id,
    environment: state.scope.environment,
    storeEnvironment: candidate.store_environment,
    appIds: [state.scope.app_id],
    scopes: ['billing:refund:review'], // only minted after AI-1 scoped grant success
    stepUpAt: new Date(state.verified_step_up_at * 1000).toISOString(),
  }, {
    brandId: state.scope.brand_id,
    environment: state.scope.environment, storeEnvironment: 'sandbox', appId: state.scope.app_id,
    reason, approvalId: candidate.server_approval_id,
  }, new Date(now * 1000).toISOString());
}
/** Canonical #19 validates client-facing event shape BEFORE AI-3 audit/dedupe.
 * AI-3 now supports offsets too; canonical AI-0 validates timestamps before
 * normalizing to equivalent UTC for stable idempotency across representations.
 */
export function canonicalAuditIdempotencyKey(
  trustedScope: StarryResourceScope, candidate: unknown,
): string {
  if (!isStarryEventEnvelope(candidate)) throw new Error('CANONICAL_EVENT_DENIED');
  assertStarryEventForScope(trustedScope, candidate);
  const normalized: StarryEventEnvelope = {
    ...candidate, occurred_at: new Date(Date.parse(candidate.occurred_at)).toISOString(),
  };
  if (!isEventEnvelope(normalized)) throw new Error('AI3_EVENT_PARITY_DENIED');
  return idempotencyNamespace(normalized);
}
