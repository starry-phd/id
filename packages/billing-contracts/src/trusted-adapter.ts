/** AI-2 Gate 2 interface candidate. Internal Worker-side only; no real store/Auth/DB adapters. */
import { applyVerifiedEvent, assertRefundReviewAuthorized } from './index.ts';
import type { ApplyResult, CatalogEntry, Projection, ProviderVerifiedEvent,
  Scope, Store, WorkerEnvironment, StoreEnvironment } from './index.ts';

/** Output of AI-1 PR #22 v0.2 billingIdentityAdapter; NOT client-supplied JSON. */
export interface Ai1BillingIdentity {
  readonly brandId: 'starry';
  readonly appId: string;
  readonly runtimeEnvironment: WorkerEnvironment;
  readonly storeEnvironment: 'sandbox';
  readonly userId: string;
  readonly authVersion: number;
  readonly sessionId: string;
}

/** All values must be sourced from the Worker/server registry, NEVER HTTP claims. */
export interface TrustedBillingRegistry {
  readonly brand_id: 'starry';
  readonly app_id: string;
  readonly environment: WorkerEnvironment;
  readonly store_environment: StoreEnvironment;
  readonly store: Store;
  readonly store_app_id: string;
  readonly catalog: readonly CatalogEntry[];
}
export interface ServerRefundPermission {
  readonly appIds: readonly string[];
  readonly scopes: readonly string[];
  readonly stepUpAt: string | null; // persisted AI-1 verified step-up timestamp
}
/** Integration contract. AI-1 owns ALL authentication and grant checks. */
export interface Ai1AuthPort {
  /** The raw value is deliberately opaque; AI-1's WeakSet validates provenance. */
  resolveTrustedPrincipal(): unknown;
  /** Must call AI-1 billingIdentityAdapter on the module-issued principal. */
  billingIdentity(principal: unknown, trusted: TrustedBillingRegistry, nowSeconds: number): Ai1BillingIdentity;
  /** Must use AI-1 billingRefundReviewAdapter, enforce session/grant/step-up. */
  resolveRefundPermission(principal: unknown, trusted: TrustedBillingRegistry, nowSeconds: number): ServerRefundPermission | null;
  accountBindingFor(identity: Ai1BillingIdentity, trusted: TrustedBillingRegistry): string;
}
/** Stub ONLY until real Apple/Google server validation. Never use request.verifiedBy. */
export interface StoreVerifierPort {
  verifySandboxEvidence(store: Store, opaqueEvidence: unknown): ProviderVerifiedEvent;
}
/** Stub ONLY: not transactional, not a substitute for D1 UNIQUE/CAS/outbox. */
export interface BillingReadPort {
  previouslyProcessedEvent(event: ProviderVerifiedEvent): boolean;
  /** Read from Billing's own authoritative transaction-owner ledger. */
  resolveTransactionOwner(transactionRef: string, trusted: TrustedBillingRegistry): string | null;
}
export interface BillingPorts {
  readonly registry: TrustedBillingRegistry;
  readonly auth: Ai1AuthPort;
  readonly verifier: StoreVerifierPort;
  readonly read: BillingReadPort;
  readonly correlationId: () => string; // generated internally, not from client
}

const PURCHASE_KEYS = new Set(['store', 'evidence']);
const REVIEW_KEYS = new Set(['transaction_ref', 'reason', 'approval_id']);
function requireValid(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function exactObject(value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).every(key => keys.has(key));
}
function validId(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 256 && s.trim() === s
    && !/[\r\n]/.test(s);
}
function parseTimestamp(value: string): number {
  requireValid(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value), 'invalid timestamp');
  const n = Date.parse(value);
  requireValid(Number.isFinite(n), 'invalid timestamp');
  return n;
}
function checkedRegistry(c: TrustedBillingRegistry): void {
  requireValid(c.brand_id === 'starry' && validId(c.app_id) && validId(c.store_app_id), 'trusted registry invalid');
  requireValid((c.environment === 'development' || c.environment === 'staging')
    && c.store_environment === 'sandbox', 'environment mismatch');
  requireValid(c.store === 'apple' || c.store === 'google', 'store mismatch');
}
function requireUser(ports: BillingPorts, isoNow: string): {principal: unknown; identity: Ai1BillingIdentity} {
  const c = ports.registry;
  checkedRegistry(c);
  const nowSeconds = Math.floor(parseTimestamp(isoNow) / 1000);
  const principal = ports.auth.resolveTrustedPrincipal();
  requireValid(principal !== null && principal !== undefined, 'AUTH_REQUIRED');
  // The callback must invoke AI-1 billingIdentityAdapter with the exact trusted
  // server scope and store environment; its WeakSet rejects forged JSON.
  const identity = ports.auth.billingIdentity(principal, c, nowSeconds);
  requireValid(identity.brandId === c.brand_id && identity.appId === c.app_id
    && identity.runtimeEnvironment === c.environment && identity.storeEnvironment === c.store_environment
    && validId(identity.userId) && validId(identity.sessionId)
    && Number.isSafeInteger(identity.authVersion) && identity.authVersion > 0, 'SCOPE_DENIED');
  return {principal, identity};
}
/** P05 strict field mapping; call AI-0 canonical validator at AI-4 Gate 2 integration. */
export function toCanonicalBillingEnvelope(
  event: ProviderVerifiedEvent, c: TrustedBillingRegistry, correlationId: string,
) {
  checkedRegistry(c);
  requireValid(validId(correlationId) && validId(event.eventId) && validId(event.originalTransactionId), 'invalid event reference');
  requireValid(event.storeEnvironment === c.store_environment && event.store === c.store
    && event.appId === c.app_id && event.storeAppId === c.store_app_id, 'event scope denied');
  parseTimestamp(event.occurredAt);
  const eventType = event.lifecycle === 'RENEWED' ? 'billing.renewed'
    : event.lifecycle === 'REFUNDED' || event.lifecycle === 'REVOKED' ? 'billing.refund_recorded'
    : event.lifecycle === 'PURCHASED' ? 'billing.purchase_verified'
    : 'billing.entitlement_changed';
  return {
    event_id: event.eventId, event_type: eventType, schema_version: '0.1',
    brand_id: 'starry', app_id: c.app_id, environment: c.environment,
    occurred_at: event.occurredAt, correlation_id: correlationId,
    resource_type: 'billing_transaction', resource_id: event.originalTransactionId,
    result: 'accepted',
  };
}

/** Contract adapter -- never route to public HTTP without real ports and Gate approval. */
export function createSandboxBillingAdapter(ports: BillingPorts) {
  return {
    /** HTTP payload is untrusted: only store and opaque evidence may be supplied. */
    evaluatePurchase(request: unknown, current: Projection | null, now: string): {
      readonly application: ApplyResult;
      readonly event: ReturnType<typeof toCanonicalBillingEnvelope>;
    } {
      requireValid(exactObject(request, PURCHASE_KEYS)
        && Object.keys(request).length === 2 && request.store === ports.registry.store
        && Object.hasOwn(request, 'evidence'), 'CLIENT_CLAIMS_DENIED');
      const {identity, principal} = requireUser(ports, now);
      const event = ports.verifier.verifySandboxEvidence(ports.registry.store, request.evidence);
      // Assert all server-verified scope and store fields BEFORE projection or audit mapping.
      const accountBinding = ports.auth.accountBindingFor(identity, ports.registry);
      requireValid(validId(accountBinding), 'ACCOUNT_BINDING_REQUIRED');
      const scope: Scope = {
        brandId: ports.registry.brand_id, environment: ports.registry.environment,
        storeEnvironment: ports.registry.store_environment,
        appId: ports.registry.app_id, store: ports.registry.store,
        storeAppId: ports.registry.store_app_id, userId: identity.userId,
        accountBinding, evaluatedAt: now,
      };
      // This flag is read only through the server-owned port, never client input.
      const seen = ports.read.previouslyProcessedEvent(event);
      requireValid(typeof seen === 'boolean', 'LEDGER_UNAVAILABLE');
      const application = applyVerifiedEvent(current, event, scope, ports.registry.catalog, seen);
      return { application, event: toCanonicalBillingEnvelope(event, ports.registry, ports.correlationId()) };
    },
    /** Review case only. Does not grant rights, execute refund, or write any database. */
    checkRefundReview(request: unknown, now: string): {transactionRef: string; ownerUserId: string} {
      requireValid(exactObject(request, REVIEW_KEYS) && Object.keys(request).length === 3
        && validId(request.transaction_ref) && validId(request.approval_id)
        && validId(request.reason), 'CLIENT_CLAIMS_DENIED');
      const {identity, principal} = requireUser(ports, now);
      const nowSeconds = Math.floor(parseTimestamp(now) / 1000);
      const auth = ports.auth.resolveRefundPermission(principal, ports.registry, nowSeconds);
      requireValid(auth !== null, 'ADMIN_DENIED');
      assertRefundReviewAuthorized({brandId:identity.brandId, environment:ports.registry.environment,
        storeEnvironment:ports.registry.store_environment, appIds:auth.appIds,
        scopes:auth.scopes, stepUpAt:auth.stepUpAt},
      {brandId:ports.registry.brand_id, environment:ports.registry.environment,
        storeEnvironment:ports.registry.store_environment, appId:ports.registry.app_id,
        reason:request.reason, approvalId:request.approval_id}, now);
      const owner = ports.read.resolveTransactionOwner(request.transaction_ref, ports.registry);
      requireValid(validId(owner), 'TRANSACTION_OWNER_UNRESOLVED');
      return {transactionRef:request.transaction_ref, ownerUserId:owner};
    },
  };
}
