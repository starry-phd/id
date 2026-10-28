/**
 * AI-3 R24 G07: executable SAFETY PLAN for a future explicitly approved,
 * isolated, synthetic-only Cloudflare D1/Queues/DLQ staging exercise.
 *
 * This program is incapable of performing that exercise. No API, fetch,
 * Wrangler, DB, Queue, timer or secret access. It only generates a bounded
 * evidence/checklist contract and tests the current offline blocker state.
 */
import {inspectCheckout} from './r23-g07-readiness-preflight.mjs';
export const G07_TRIAL_PLAN_VERSION='starry.ai3.g07.synthetic-trial-plan.v1';
export const G07_EXPERIMENT_EXECUTION_ENABLED=false;
const shared=Object.freeze([
 'AI0_APPROVED_ADR87_ARCHITECTURE_AND_OWNER_WRITERS',
 'EXPLICIT_HUMAN_TEST_ENVIRONMENT_AND_BUDGET_APPROVAL',
 'AI4_ISOLATED_CLOUDFLARE_ACCOUNT_WORKER_AND_D1_QUEUE_DLQ_PROOF',
 'AI1_LAWFUL_SYNTHETIC_AUTH_AND_REGISTRATION_ISSUER',
 'AI0_AI4_UNIQUE_SIGNED_P05_AND_VERSIONED_SCHEMA',
 'AI0_AI3_Q104_Q119_RETENTION_HMAC_KMS_APPROVAL',
 'INDEPENDENT_NONROLLBACK_RECOVERY_WITNESS',
 'PRECAPTURED_ROLLBACK_AND_ABORT_AUTHORITY',
]);
const cases=[
 ['G07-01','all','isolation',
  'Create synthetic-only Starry dev/staging scope; verify no prod, H-Global, public Preview or real member data',
  'Deny wrong brand, app, worker, env and every live identity fixture',
  'AI4_ISOLATED_RESOURCE_INVENTORY_AND_ACCESS_REVIEW'],
 ['G07-02','all','first_claim',
  'Two authorized synthetic registration requests with identical unique claim ID arrive concurrently',
  'Exactly one durable claim and at most one gift; unknown partial outcome is not spendable',
  'AI1_CLAIM_UNIQUENESS_AND_AI3_WALLET_COMMIT_RECEIPTS'],
 ['G07-03','all','revocation_race',
  'Revoke a synthetic member after Task read but before Wallet/Queue commit',
  'Reject stale auth; do not release, settle, regrant or ACK from revoked snapshot',
  'AI1_NEWEST_AUTH_VERSION_AND_AI3_DENIAL_RECEIPT'],
 ['G07-04','all','signed_event',
  'Send a synthetic invalid-signer P05, wrong brand/env/schema, duplicate idempotency key and delayed event',
  'Zero trusted state mutation or ACK for unverified issuer; duplicates never grant twice',
  'CANONICAL_P05_SIGNATURE_VERIFICATION_AND_DEDUPE_LOG'],
 ['G07-05','all','ack_after_commit',
  'Inject Queue delivery immediately before the durable audit-inbox commit boundary',
  'ACK only after authoritative durable commit; before it failure must retry/nack',
  'PROVIDER_QUEUE_DELIVERY_AND_D1_COMMIT_ORDERED_TRACE'],
 ['G07-06','all','lost_ack_replay',
  'Drop an ACK after durable commit then redeliver the same synthetic event to a second Worker',
  'One journal/outbox effect; replay is idempotent, second delivery ACK only after readback',
  'TWO_WORKER_MESSAGE_IDS_AND_DURABLE_JOURNAL_UNIQUE_EVIDENCE'],
 ['G07-07','all','d1_failure',
  'Force a D1 transaction rollback/timeout before Queue consumer completes',
  'No ACK, no phantom success, queue retry reflects uncommitted state',
  'PROVIDER_ROLLBACK_PROOF_AND_QUEUE_REDELIVERY_TRACE'],
 ['G07-08','all','poison_dlq',
  'Poison a synthetic message beyond bounded retries in an isolated DLQ',
  'No unlimited replay; record DLQ and deny human restore until separately authorized',
  'QUEUE_RETRY_COUNTS_AND_DLQ_ISOLATION_PROOF'],
 ['G07-09','all','hold_expiry',
  'Deliver Task success after a synthetic Wallet hold expires and after policy revision rotates',
  'No late settlement, no FEFO/overdraft or invented paid Battery entitlement',
  'TASK_HOLD_STATUS_SERVER_TIME_AND_POLICY_VERSION_TRACE'],
 ['G07-10','all','pitr_rollback',
  'Recover synthetic D1 to a prior point missing a committed deletion/gift/Task tombstone',
  'Older D1 must not supersede independent newer witness; block restoration and regrant',
  'PROVIDER_PITR_RESTORE_ID_AND_SEPARATE_SIGNED_WITNESS_FLOOR'],
 ['G07-11','all','legal_retention',
  'Simulate lawful hold, revoked consent and retention-window conflict with synthetic audit metadata',
  'No premature purge, secret log, raw member profile, or automatic restore',
  'AI0_LEGAL_DECISION_VERSION_AND_REDACTED_AUDIT_PROOF'],
 ['G07-12','all','rollback',
  'Stop trial on any mismatch and follow documented isolated-resource rollback',
  'No production change; prove cleanup/credential revocation/cost accounting',
  'ISOLATED_CLEANUP_AND_ROLLBACK_ATTESTATION'],
 ['G07-A1','A','atomic_claim_wallet',
  'In proposed single Starry authority run claim UNIQUE + Wallet grant + outbox in one verified D1 transaction',
  'Crash between steps must commit all or none; no phantom gift',
  'SAME_PHYSICAL_D1_TRANSACTION_AND_OUTBOX_COMMIT_RECEIPT'],
 ['G07-B1','B','claim_before_wallet',
  'In proposed separated D1 Saga commit claim/outbox then make Wallet DB unavailable',
  'Pending/unknown gift cannot be spent; retry resumes from durable outbox without a second grant',
  'TWO_D1_COMMIT_TIMESTAMPS_AND_SAGA_STATE_TRANSITION'],
 ['G07-B2','B','wallet_before_reply',
  'In proposed Saga commit Wallet exactly once but lose source response/Queue ACK',
  'Dedup recovery checks durable Wallet journal; no compensating double grant',
  'INDEPENDENT_WALLET_VERSION_AND_IDEMPOTENT_REPLAY_RECEIPT'],
 ['G07-B3','B','out_of_order',
  'In proposed Saga deliver signed outbox messages out of order from separate services',
  'Monotonic policy/auth/revision fence; unknown state cannot be settled',
  'SIGNED_OUTBOX_ORDER_AND_SOURCE_OF_TRUTH_VERSIONS'],
];
export const G07_TRIAL_DEFINITIONS=Object.freeze(cases.map(([id,architecture,kind,injection,expected,evidence])=>
 Object.freeze({id,architecture,kind,injection,expected,
  required_proof:evidence,execution_mode:'authorized_isolated_staging_only',
  member_data:'synthetic_only',result:'NOT_EXECUTED'})));
export function buildG07TrialPlan({architecture='undecided',repositoryInspection=null}={}){
 if(!['undecided','A','B'].includes(architecture))
  throw Error('AI3_G07_ARCHITECTURE_UNRECOGNIZED');
 const inspection=repositoryInspection??inspectCheckout();
 if(!inspection||inspection.gate_id!=='G07-AUDIT-QUEUE'||
  inspection.status!=='blocked'||inspection.verified_live!==false)
  throw Error('AI3_G07_STATIC_PREFLIGHT_NOT_FAIL_CLOSED');
 const scenarios=G07_TRIAL_DEFINITIONS.filter(s=>architecture==='undecided'||
  s.architecture==='all'||s.architecture===architecture);
 return Object.freeze({
  schema_version:G07_TRIAL_PLAN_VERSION,system:'starry',environment:'isolated_staging_proposal',
  architecture_candidate:architecture,architecture_approved:false,
  status:'BLOCKED_AWAITING_EXTERNAL_AUTHORIZATION',
  prerequisites:shared,scenarios,
  evidence_requirements:Object.freeze([
   'AI0_APPROVAL_URL_AND_APPROVER_AUTHORITY_CHECKED_OUT_OF_BAND',
   'AI4_REAL_RESOURCE_IDS_VERIFIED_SEPARATELY_NOT_STORED_IN_PUBLIC_REPO',
   'PROVIDER_D1_TRANSACTION_LOGS_AND_QUEUE_ACK_DLQ_TRACE_REDACTED',
   'AI0_SIGNED_P05_TEST_ISSUER_AND_LAWFUL_RETENTION_PROOF',
   'NONROLLBACK_WITNESS_FROM_INDEPENDENT_TRUST_DOMAIN',
   'ROLLBACK_COST_AND_ISOLATION_SIGNOFF',
  ]),
  stop_on:Object.freeze([
   'ANY_NON_SYNTHETIC_OR_CROSS_BRAND_DATA',
   'UNAPPROVED_ACCOUNT_OR_COST',
   'UNEXPECTED_PUBLIC_PREVIEW_OR_PRODUCTION_BINDING',
   'UNVERIFIED_P05_ISSUER_OR_REVOKED_MEMBER',
   'DUPLICATE_GRANT_OR_ACK_BEFORE_COMMIT',
   'PITR_REVISION_BELOW_INDEPENDENT_WITNESS',
  ]),
  repository_preflight_missing:Object.freeze([...(inspection.missing??[])]),
  candidate_actions_enabled:false,may_execute:false,may_ack_queue:false,
  may_write_d1:false,may_restore:false,may_approve_release:false,may_sell_battery:false,
  real_cloudflare_test_performed:false,verified_live:false,
 });
}
export function renderG07Plan(root){
 return buildG07TrialPlan({repositoryInspection:inspectCheckout(root)});
}
const mode=process.argv[2];
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 if(process.argv.length!==3||!['--plan','--assert-blocked','--execute'].includes(mode)){
  process.stderr.write('usage: node r24-g07-staging-trial-plan.mjs --plan|--assert-blocked|--execute\n');
  process.exitCode=2;
 }else if(mode==='--execute'){
  process.stderr.write('BLOCKED: no approved live authority; this tool NEVER opens D1/Queue/Cloudflare\n');
  process.exitCode=2;
 }else try{
  const plan=buildG07TrialPlan();
  if(mode==='--plan')process.stdout.write(JSON.stringify(plan,null,2)+'\n');
  else if(plan.status!=='BLOCKED_AWAITING_EXTERNAL_AUTHORIZATION'||plan.may_execute!==false)
   process.exitCode=2;
  else process.stdout.write('G07 staging experiment correctly BLOCKED; dry-run checklist only\n');
 }catch(e){
  process.stderr.write('AI3_R24_PLAN_FAILED: '+String(e?.message??'unknown')+'\n');
  process.exitCode=2;
 }
}
