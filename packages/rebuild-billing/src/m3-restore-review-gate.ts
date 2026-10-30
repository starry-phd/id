/**
 * M3 S2-11: local-only, read-only restore safety gate.
 *
 * Neither a RevenueCat/Store verifier nor an entitlement writer. Even a
 * same-member candidate NEVER grants/changes ownership. Future M3 must add
 * official evidence, central Billing CAS/outbox, legal policy and live gates.
 * All ports MUST be backend-owned; NEVER connect these to client JSON/SDK.
 */
import type {StoreNamespaceKeys} from './trusted-store-namespace.ts';

export type RestoreEnvironment = 'development' | 'staging';
export type OriginalPurchaseState = 'valid' | 'refunded' | 'revoked' | 'expired' | 'unknown';
export interface RestoreServerScope {
  readonly brandId: 'starry';
  readonly appId: string;
  readonly starryEnvironment: RestoreEnvironment;
}
export interface RestoreMember {
  readonly memberId: string;
  readonly appId: string;
  readonly starryEnvironment: RestoreEnvironment;
  readonly status: 'active' | 'suspended' | 'deleted';
  readonly authVersion: number;
}
export interface VerifiedPurchaseCandidate {
  readonly receiptTransactionRef: string;
  readonly originalTransactionRef: string;
  readonly providerEventRef: string;
  readonly state: OriginalPurchaseState;
}
export interface OriginalFirstClaim {
  readonly namespace: string;
  readonly originalLineageIdentity: string;
  readonly ownerMemberId: string;
}
export interface OfflineNamespaceBuilder {
  build(receipt: string, original: string, event: string): Promise<StoreNamespaceKeys>;
}
export interface OfflineRestoreReviewPorts {
  /** Trusted server current-identity check; called AGAIN after async reads. */
  readCurrentMember(): Promise<RestoreMember | null>;
  /** Test-only provider evidence port; not an actual RC/Store verifier. */
  readVerifiedPurchaseCandidate(): Promise<VerifiedPurchaseCandidate | null>;
  /** Central Billing-owned immutable first-claim lookup, never client input. */
  readOriginalFirstClaim(identity: string): Promise<OriginalFirstClaim | null>;
}
export type RestoreReviewReason =
  | 'disabled' | 'identity_denied' | 'evidence_unavailable'
  | 'purchase_not_valid' | 'original_claim_unavailable'
  | 'claim_scope_denied' | 'ownership_conflict'
  | 'same_member_needs_reconciliation';
export interface RestoreReviewOutcome {
  readonly decision: 'hold' | 'same_member_review';
  readonly reason: RestoreReviewReason;
  readonly local_only: true;
  readonly may_grant: false;
  readonly may_transfer: false;
}
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9._:-]{1,180}$/u.test(v);

function dataCopy(value: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const proto = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (proto !== Object.prototype && proto !== null ||
      Reflect.ownKeys(descriptors).length !== names.length) return null;
    const copy: Record<string, unknown> = Object.create(null);
    for (const name of names) {
      const d = descriptors[name];
      if (!d || !Object.hasOwn(d, 'value')) return null;
      copy[name] = d.value;
    }
    return Object.freeze(copy);
  } catch { return null; }
}
const SCOPE = ['brandId','appId','starryEnvironment'] as const;
const MEMBER = ['memberId','appId','starryEnvironment','status','authVersion'] as const;
const PURCHASE = ['receiptTransactionRef','originalTransactionRef','providerEventRef','state'] as const;
const CLAIM = ['namespace','originalLineageIdentity','ownerMemberId'] as const;
function validMember(v: Record<string, unknown> | null, scope: Record<string, unknown>):
    v is Record<string, unknown> {
  return v !== null && id(v.memberId) && v.appId === scope.appId &&
    v.starryEnvironment === scope.starryEnvironment && v.status === 'active' &&
    typeof v.authVersion === 'number' && Number.isSafeInteger(v.authVersion) &&
    v.authVersion >= 1;
}
const result = (decision: RestoreReviewOutcome['decision'],
  reason: RestoreReviewReason): RestoreReviewOutcome =>
  Object.freeze({decision,reason,local_only:true as const,
    may_grant:false as const,may_transfer:false as const});
const hold = (reason: RestoreReviewReason) => result('hold',reason);

/** All asynchronous ports are test-only. There is NO write, grant or HTTP API. */
export function createOfflineM3RestoreReviewGate(
  serverScope: RestoreServerScope,
  namespaceBuilder: OfflineNamespaceBuilder,
  ports: OfflineRestoreReviewPorts,
  enabled = false,
) {
  const scope = dataCopy(serverScope, SCOPE);
  if (!scope || scope.brandId !== 'starry' || !id(scope.appId) ||
      !['development','staging'].includes(scope.starryEnvironment as string))
    throw Error('M3_RESTORE_SCOPE_DENIED');
  if (!namespaceBuilder || typeof namespaceBuilder.build !== 'function' ||
      !ports || typeof ports.readCurrentMember !== 'function' ||
      typeof ports.readVerifiedPurchaseCandidate !== 'function' ||
      typeof ports.readOriginalFirstClaim !== 'function')
    throw Error('M3_RESTORE_PORT_DENIED');
  const build = namespaceBuilder.build.bind(namespaceBuilder);
  const readMember = ports.readCurrentMember.bind(ports);
  const readPurchase = ports.readVerifiedPurchaseCandidate.bind(ports);
  const readClaim = ports.readOriginalFirstClaim.bind(ports);
  return Object.freeze({
    local_only: true as const,
    live_enabled: false as const,
    async assess(): Promise<RestoreReviewOutcome> {
      if (!enabled) return hold('disabled');
      try {
        const start = dataCopy(await readMember(), MEMBER);
        if (!validMember(start,scope)) return hold('identity_denied');
        const purchase = dataCopy(await readPurchase(), PURCHASE);
        if (!purchase || !['valid','refunded','revoked','expired','unknown'].includes(purchase.state as string))
          return hold('evidence_unavailable');
        if (purchase.state !== 'valid') return hold('purchase_not_valid');
        if (![purchase.receiptTransactionRef,purchase.originalTransactionRef,
              purchase.providerEventRef].every(id)) return hold('evidence_unavailable');
        const keys = await build(purchase.receiptTransactionRef as string,
          purchase.originalTransactionRef as string,purchase.providerEventRef as string);
        // Only the original immutable first-claim key identifies ownership.
        if (!keys || typeof keys.namespace !== 'string' ||
            typeof keys.originalLineageIdentity !== 'string' ||
            !keys.namespace.length || !keys.originalLineageIdentity.length)
          return hold('claim_scope_denied');
        const claim = dataCopy(await readClaim(keys.originalLineageIdentity), CLAIM);
        if (!claim) return hold('original_claim_unavailable');
        if (claim.namespace !== keys.namespace ||
            claim.originalLineageIdentity !== keys.originalLineageIdentity ||
            !id(claim.ownerMemberId)) return hold('claim_scope_denied');
        // Re-check the same authenticated principal AFTER every awaited read.
        const current = dataCopy(await readMember(), MEMBER);
        if (!validMember(current,scope) ||
            current.memberId !== start.memberId ||
            current.authVersion !== start.authVersion)
          return hold('identity_denied');
        if (claim.ownerMemberId !== current.memberId)
          return hold('ownership_conflict'); // Never auto-transfer deleted/other ID.
        // Valid same-member evidence is NOT an entitlement grant or approval.
        return result('same_member_review','same_member_needs_reconciliation');
      } catch {
        // Missing/offline/unavailable sources NEVER grant, transfer or leak PII.
        return hold('evidence_unavailable');
      }
    },
  });
}
