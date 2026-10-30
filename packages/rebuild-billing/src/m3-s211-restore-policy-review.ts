/**
 * S2-11 / UP-14 AI-2 decision-support contract only.
 *
 * Compares evidence prerequisites for two UNAPPROVED account-rebind policies.
 * This is NOT an ownership verifier, entitlement grant, Store restore,
 * authorization response, Billing writer, legal approval, or runnable plan.
 * Input statuses are human review metadata, NOT trusted external evidence.
 * No read/write/network/credential/RevenueCat/Store SDK ports exist here.
 */
export const S211_RESTORE_REVIEW_LIVE_ENABLED = false as const;
export type RebindProposal = 'manual_review' | 'conditional_self_service';
export type ClaimedReviewEvidence = 'not_provided' | 'proposed' | 'externally_checked';
export type SharedEvidenceCode =
  | 'current_starry_principal'
  | 'same_app_brand_environment'
  | 'official_store_lineage'
  | 'store_purchase_lifecycle_freshness'
  | 'revenuecat_project_member_mapping'
  | 'revenuecat_restore_behavior'
  | 'original_first_claim_conflicts'
  | 'deleted_identity_tombstone'
  | 'lawful_minimal_retention'
  | 'independent_rollback_witness'
  | 'single_billing_writer_cas'
  | 'same_transaction_claim_entitlement_outbox'
  | 'durable_inbox_before_webhook_ack'
  | 'idempotent_refund_reconciliation'
  | 'user_notice_subscription_disclosure';
export type ManualEvidenceCode =
  | 'secure_case_and_requester_consent'
  | 'independent_reviewer_separation'
  | 'second_approver_high_risk'
  | 'audited_appeal_and_recovery';
export type SelfServiceEvidenceCode =
  | 'fresh_official_purchase_challenge'
  | 'one_time_authenticated_binding'
  | 'replay_limit_and_cooldown'
  | 'risk_escalation_to_human'
  | 'atomic_one_winner_transfer_protocol';
export type EvidenceCode = SharedEvidenceCode | ManualEvidenceCode | SelfServiceEvidenceCode;
export interface EvidenceReviewInput {
  readonly [evidenceCode: string]: ClaimedReviewEvidence | undefined;
}
export interface EvidenceGap {
  readonly code: EvidenceCode;
  readonly claimed: ClaimedReviewEvidence;
}
export interface RebindReviewProposal {
  readonly path: RebindProposal;
  readonly review_only: true;
  readonly evidence_metadata_complete: boolean;
  readonly missing_or_unverified: readonly EvidenceGap[];
  readonly required_evidence: readonly EvidenceCode[];
  readonly policy_selected: false;
  readonly may_grant: false;
  readonly may_transfer: false;
  readonly may_call_restore_purchases: false;
  readonly may_write_billing: false;
}
export interface M3S211Review {
  readonly schema: 'starry-m3-s211-review-v1';
  readonly brand: 'starry';
  readonly evidence_is_untrusted_metadata: true;
  readonly external_ownership_verified: false;
  readonly atomic_writer_authorized: false;
  readonly release_authorized: false;
  readonly proposals: readonly [RebindReviewProposal, RebindReviewProposal];
  readonly commit_and_outbox_requirements: readonly string[];
}
const SHARED = Object.freeze([
  'current_starry_principal',
  'same_app_brand_environment',
  'official_store_lineage',
  'store_purchase_lifecycle_freshness',
  'revenuecat_project_member_mapping',
  'revenuecat_restore_behavior',
  'original_first_claim_conflicts',
  'deleted_identity_tombstone',
  'lawful_minimal_retention',
  'independent_rollback_witness',
  'single_billing_writer_cas',
  'same_transaction_claim_entitlement_outbox',
  'durable_inbox_before_webhook_ack',
  'idempotent_refund_reconciliation',
  'user_notice_subscription_disclosure',
] as const satisfies readonly SharedEvidenceCode[]);
const MANUAL = Object.freeze([
  'secure_case_and_requester_consent',
  'independent_reviewer_separation',
  'second_approver_high_risk',
  'audited_appeal_and_recovery',
] as const satisfies readonly ManualEvidenceCode[]);
const SELF = Object.freeze([
  'fresh_official_purchase_challenge',
  'one_time_authenticated_binding',
  'replay_limit_and_cooldown',
  'risk_escalation_to_human',
  'atomic_one_winner_transfer_protocol',
] as const satisfies readonly SelfServiceEvidenceCode[]);
const ALL = Object.freeze([...SHARED,...MANUAL,...SELF]);
export const S211_RESTORE_ATOMIC_ADMISSION = Object.freeze([
  'pin Starry brand/app/environment/official Store/provider project and authenticated member from trusted server config',
  'verify authoritative Store/RevenueCat transaction lineage, lifecycle and transfer/alias behavior; never accept client flags, SDK restore result or email as ownership',
  'check independently retained lawful deleted-ID/tombstone and competing active original-first-claim; never infer identity from deleted PII or local PITR alone',
  'persist authenticated provider delivery to durable inbox before acknowledging; dedupe provider event separately from immutable original purchase first-claim',
  'single Billing writer: conditional original-lineage CAS, member/version fence, entitlement projection and committed outbox in ONE physical Billing transaction or abort all',
  'for cross-D1 boundaries never assume atomic commits; use explicit pending state, independent inbox/outbox, retries and compensation with no premature grant',
  'refund/revoke/chargeback, Store reassignment, member deletion or auth-version changes must defeat stale claim and queued grant; reconcile against authoritative source',
  'outbox dispatcher sends only committed events, deduplicates replay and retains narrowly lawful audit proof; no raw purchase token/PII in public logs',
  'AI-0/owner-selected S2-11 policy, legal retention Q104/Q119, real provider sandbox evidence and independent G04/G05 must precede any live writer/transfer',
] as const);

function snapshotStatuses(untrusted: unknown): Readonly<Record<string, ClaimedReviewEvidence>> {
  if (!untrusted || typeof untrusted!=='object' || Array.isArray(untrusted))
    throw Error('S211_REVIEW_METADATA_DENIED');
  try {
    const proto=Object.getPrototypeOf(untrusted);
    if(proto!==Object.prototype && proto!==null)
      throw Error('S211_REVIEW_METADATA_DENIED');
    const descriptors=Object.getOwnPropertyDescriptors(untrusted);
    const keys=Reflect.ownKeys(descriptors);
    if(keys.length>ALL.length)throw Error('S211_REVIEW_METADATA_DENIED');
    const out:Record<string,ClaimedReviewEvidence>=Object.create(null);
    for(const key of keys){
      if(typeof key!=='string'||!ALL.includes(key as EvidenceCode))
        throw Error('S211_REVIEW_METADATA_DENIED');
      const d=descriptors[key];
      if(!d||!Object.hasOwn(d,'value')||
        !['not_provided','proposed','externally_checked'].includes(d.value))
        throw Error('S211_REVIEW_METADATA_DENIED');
      out[key]=d.value as ClaimedReviewEvidence;
    }
    return Object.freeze(out);
  }catch{
    throw Error('S211_REVIEW_METADATA_DENIED');
  }
}
function proposal(
  path:RebindProposal,
  required:readonly EvidenceCode[],
  statuses:Readonly<Record<string, ClaimedReviewEvidence>>,
):RebindReviewProposal{
  const missing_or_unverified=Object.freeze(required
    .filter(code=>statuses[code]!=='externally_checked')
    .map(code=>Object.freeze({
      code,claimed:statuses[code]??'not_provided' as ClaimedReviewEvidence,
    })));
  return Object.freeze({
    path,review_only:true as const,
    evidence_metadata_complete:missing_or_unverified.length===0,
    missing_or_unverified,
    required_evidence:required,
    policy_selected:false as const,
    may_grant:false as const,may_transfer:false as const,
    may_call_restore_purchases:false as const,may_write_billing:false as const,
  });
}
/**
 * Human submission coverage comparison, NEVER server authority or a grant gate.
 * In particular, "externally_checked" is a claim by the review submitter and
 * cannot stand in for verified official Store evidence or signed approvals.
 */
export function compareS211RestoreProposals(
  untrustedReviewMetadata: unknown,
):M3S211Review{
  const statuses=snapshotStatuses(untrustedReviewMetadata);
  return Object.freeze({
    schema:'starry-m3-s211-review-v1' as const,
    brand:'starry' as const,
    evidence_is_untrusted_metadata:true as const,
    external_ownership_verified:false as const,
    atomic_writer_authorized:false as const,
    release_authorized:false as const,
    proposals:Object.freeze([
      proposal('manual_review',Object.freeze([...SHARED,...MANUAL]),statuses),
      proposal('conditional_self_service',Object.freeze([...SHARED,...SELF]),statuses),
    ]) as readonly [RebindReviewProposal,RebindReviewProposal],
    commit_and_outbox_requirements:S211_RESTORE_ATOMIC_ADMISSION,
  });
}
