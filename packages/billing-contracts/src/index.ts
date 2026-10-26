/** Starry-only Billing Sandbox contract helpers. NOT a store receipt verifier. */
export type Store = 'apple' | 'google';
export type Kind = 'subscription' | 'non_consumable';
export type Lifecycle = 'PURCHASED' | 'RENEWED' | 'GRACE_PERIOD' | 'ON_HOLD' | 'EXPIRED' | 'REFUNDED' | 'REVOKED';
export type Entitlement = 'active' | 'inactive';
/** Two independent trust axes: Worker runtime vs Apple/Google store. */
export type WorkerEnvironment = 'development' | 'staging' | 'production';
export type StoreEnvironment = 'sandbox' | 'production';

export interface Scope {
  brandId: string;
  environment: WorkerEnvironment; // server-controlled Worker environment
  storeEnvironment: StoreEnvironment; // separate, server-controlled store environment
  appId: string;
  store: Store;
  storeAppId: string;
  userId: string; // Starry s_user_id from trusted AI-1 authentication
  accountBinding: string; // server-owned binding matched to store verified reference
  evaluatedAt: string;
}
export interface CatalogEntry {
  appId: string; store: Store; storeAppId: string;
  productId: string; kind: Kind; entitlementKey: string;
}
/** Internal ONLY: produced after separate authoritative Apple/Google server validation. */
export interface ProviderVerifiedEvent {
  verifiedBy: 'apple-app-store-server-api' | 'google-play-developer-api';
  store: Store; storeEnvironment: StoreEnvironment; storeAppId: string; appId: string;
  productId: string; transactionId: string; originalTransactionId: string;
  eventId: string; occurredAt: string; expiresAt?: string | null;
  accountBinding?: string | null;
  lifecycle: Lifecycle;
}
export interface Projection {
  brandId: 'starry'; environment: WorkerEnvironment; storeEnvironment: 'sandbox'; appId: string; userId: string;
  store: Store; storeAppId: string; productId: string; entitlementKey: string;
  originalTransactionId: string; lastTransactionId: string;
  lastEventId: string; lastEventAt: string; expiresAt: string | null;
  lifecycle: Lifecycle; entitlement: Entitlement;
}
export interface ApplyResult {
  applied: boolean; reason: 'applied' | 'duplicate' | 'stale';
  projection: Projection | null;
}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n]/.test(value);
}
function stamp(value: unknown): number {
  ensure(typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value), 'invalid timestamp');
  const parsed = Date.parse(value);
  ensure(Number.isFinite(parsed), 'invalid timestamp');
  return parsed;
}
/** Pure reducer; DB transactional uniqueness, signature validation and notification replay are separate. */
export function applyVerifiedEvent(
  current: Projection | null,
  event: ProviderVerifiedEvent,
  scope: Scope,
  catalog: readonly CatalogEntry[],
  previouslyProcessedEventId: boolean = false,
): ApplyResult {
  ensure(scope.brandId === 'starry', 'brand mismatch');
  ensure((scope.environment === 'development' || scope.environment === 'staging')
    && scope.storeEnvironment === 'sandbox' && event.storeEnvironment === scope.storeEnvironment,
    'environment mismatch');
  for (const value of [scope.appId, scope.storeAppId, scope.userId, scope.accountBinding,
    event.storeAppId, event.appId, event.productId, event.transactionId,
    event.originalTransactionId, event.eventId]) ensure(validId(value), 'invalid identifier');
  ensure(event.appId === scope.appId && event.storeAppId === scope.storeAppId, 'app mismatch');
  ensure(event.store === scope.store, 'store mismatch');
  ensure(event.verifiedBy === (event.store === 'apple' ? 'apple-app-store-server-api' : 'google-play-developer-api'), 'not provider verified');
  ensure(!/battery/i.test(event.productId), 'free Battery is not billable');
  const item = catalog.find(p => p.appId === scope.appId && p.store === scope.store &&
    p.storeAppId === scope.storeAppId && p.productId === event.productId);
  ensure(item && validId(item.entitlementKey), 'unknown SKU');
  const eventMs = stamp(event.occurredAt);
  const nowMs = stamp(scope.evaluatedAt);
  const expiryMs = event.expiresAt == null ? null : stamp(event.expiresAt);
  if (item.kind === 'subscription' && (event.lifecycle === 'PURCHASED' || event.lifecycle === 'RENEWED')) {
    ensure(expiryMs !== null, 'subscription must have verified expiration');
  }
  ensure(item.kind === 'subscription' || event.lifecycle !== 'RENEWED', 'non-consumable cannot renew');
  if (current) {
    ensure(current.brandId === 'starry' && current.environment === scope.environment &&
      current.storeEnvironment === scope.storeEnvironment &&
      current.appId === scope.appId && current.userId === scope.userId &&
      current.store === scope.store && current.storeAppId === scope.storeAppId &&
      current.productId === event.productId &&
      current.originalTransactionId === event.originalTransactionId,
      'ownership or transaction mismatch');
  } else {
    ensure(event.accountBinding === scope.accountBinding, 'unbound transaction');
  }
  if (previouslyProcessedEventId) return {applied: false, reason: 'duplicate', projection: current};
  if (current && eventMs <= stamp(current.lastEventAt))
    return {applied: false, reason: 'stale', projection: current};
  // Unknown grace / hold policy fails closed. No payment-authority from UI flags.
  const entitlement: Entitlement =
    (event.lifecycle === 'PURCHASED' || event.lifecycle === 'RENEWED') &&
    (item.kind === 'non_consumable' || (expiryMs !== null && expiryMs > nowMs))
    ? 'active' : 'inactive';
  return {
    applied: true, reason: 'applied',
    projection: {
      brandId: 'starry', environment: scope.environment, storeEnvironment: 'sandbox', appId: scope.appId,
      userId: scope.userId, store: scope.store, storeAppId: scope.storeAppId,
      productId: event.productId, entitlementKey: item.entitlementKey,
      originalTransactionId: event.originalTransactionId,
      lastTransactionId: event.transactionId, lastEventId: event.eventId,
      lastEventAt: event.occurredAt, expiresAt: event.expiresAt ?? null,
      lifecycle: event.lifecycle, entitlement,
    },
  };
}
export interface RefundReviewPrincipal {
  brandId: string; environment: WorkerEnvironment; storeEnvironment: StoreEnvironment; appIds: readonly string[];
  scopes: readonly string[]; stepUpAt: string | null;
}
/** Sandbox REVIEW authorization only, never an actual Apple/Google refund operation. */
export function assertRefundReviewAuthorized(
  principal: RefundReviewPrincipal,
  target: { brandId: string; environment: WorkerEnvironment; storeEnvironment: StoreEnvironment; appId: string; reason: string; approvalId: string },
  at: string,
): void {
  ensure(principal.brandId === 'starry' && target.brandId === 'starry', 'brand mismatch');
  ensure((principal.environment === 'development' || principal.environment === 'staging')
    && target.environment === principal.environment &&
    principal.storeEnvironment === 'sandbox' && target.storeEnvironment === 'sandbox', 'environment mismatch');
  ensure(principal.appIds.includes(target.appId), 'app scope denied');
  ensure(principal.scopes.includes('billing:refund:review'), 'refund scope denied');
  ensure(validId(target.reason.trim()) && validId(target.approvalId), 'reason and approval required');
  ensure(principal.stepUpAt !== null, 'step-up required');
  const age = stamp(at) - stamp(principal.stepUpAt);
  ensure(age >= 0 && age <= 300_000, 'step-up expired');
}
