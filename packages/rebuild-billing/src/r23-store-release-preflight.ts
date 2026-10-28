/**
 * AI-2 R23 pre-deployment Store readiness scanner.
 * Repository-local files can prove ONLY code/config presence or absence.
 * A GitHub green CI and self-declared manifest evidence are NEVER Apple/Google
 * Store cryptographic proof, verified D1 behavior, or publish authority.
 *
 * This helper deliberately has no paid-entitlement success branch. External
 * signed Store verification and human release Gate MUST be implemented and
 * approved separately; no receipt, token, secret or personal data is accepted.
 */
export const R23_STORE_PREFLIGHT_VERSION =
 'starry.billing.r23.store-preflight.v1' as const;
export const R23_STORE_PREFLIGHT_LIVE = false as const;
export type R23Blocker = Readonly<{
 id:string;
 gate:'G04-STORE'|'G05-BILLING-D1'|'CROSS_OWNER'|'R23_RELEASE';
 owner:'AI-2'|'AI-0'|'AI-1'|'AI-4';
 required:string;
 observed:'repo_missing'|'repo_candidate_only'|'unverified_live'|
 'owner_approval_missing'|'manifest_inconsistent';
}>;
export type R23StorePreflightReport=Readonly<{
 schema_version:typeof R23_STORE_PREFLIGHT_VERSION;
 status:'blocked';source:'local_repo_static_only';
 observed_g04:'blocked'|'invalid_or_unverified';
 observed_g05:'blocked'|'invalid_or_unverified';
 central_release_blocked:true;
 code_exists:boolean;
 verified_offline_by_this_scan:false;
 verified_live:false;
 can_sell:false;can_grant:false;can_restore:false;
 can_ack_queue:false;can_remove_ads:false;can_deploy:false;
 no_store_or_member_data_processed:true;
 blockers:readonly R23Blocker[];
}>;
type Input=Readonly<{
 releaseReadiness:unknown;
 workerToml:string;
 billingSource:string;
}>;
const b=(id:string,gate:R23Blocker['gate'],owner:R23Blocker['owner'],
 required:string,observed:R23Blocker['observed']):R23Blocker=>
 Object.freeze({id,gate,owner,required,observed});
function inspectGate(raw:unknown,id:string,expectedOwner:string):boolean{
 if(!Array.isArray(raw))return false;
 const matching=raw.filter(v=>{
  try{return !!v&&typeof v==='object'&&
    Object.getOwnPropertyDescriptor(v,'id')?.value===id;}catch{return false;}
 });
 if(matching.length!==1)return false;
 try{
  const x=matching[0] as Record<string,unknown>;
  return Object.getOwnPropertyDescriptor(x,'status')?.value==='blocked'
   &&Object.getOwnPropertyDescriptor(x,'owner')?.value===expectedOwner;
 }catch{return false;}
}
function prop(v:unknown,key:string):unknown{
 try{return v&&typeof v==='object'?
  Object.getOwnPropertyDescriptor(v,key)?.value:undefined;}catch{return undefined;}
}
/** Parse only active TOML lines, never comments; not a Cloudflare API check. */
function activeToml(text:string):string{
 return text.split(/\r?\n/).map(s=>s.split('#',1)[0].trim())
  .filter(Boolean).join('\n');
}
export function inspectR23StoreReadiness(input:Input):R23StorePreflightReport{
 const blockers:R23Blocker[]=[];
 const release=input?.releaseReadiness;
 const gates=prop(release,'gates');
 const g04=inspectGate(gates,'G04-STORE','AI-2');
 const g05=inspectGate(gates,'G05-BILLING-D1','AI-2');
 const auth=prop(release,'release_authorization');
 const automation=prop(release,'deployment_automation');
 const policyBlocked=prop(auth,'granted')===false
  &&prop(automation,'can_auto_deploy')===false
  &&prop(automation,'enabled')===false;
 const uniqueGates=Array.isArray(gates)
  &&gates.length===11
  &&new Set(gates.map(g=>prop(g,'id'))).size===11;
 if(!g04||!g05||!uniqueGates||!policyBlocked)
  blockers.push(b('GATE_MANIFEST_INVALID_OR_UNSAFE','R23_RELEASE','AI-0',
   'Authoritatively review the 11 official G00-G10 gates and release authorization',
   'manifest_inconsistent'));
 const source=typeof input?.billingSource==='string'?input.billingSource:'';
 const codeExists=source.includes("SBASE_BILLING_CONTRACT='starry.billing-client.v0-candidate'")
  &&source.includes('SBASE_STORE_PAYMENTS_ENABLED=false')
  &&source.includes('SBASE_BILLING_LIVE=false');
 if(!codeExists)
  blockers.push(b('BILLING_CANDIDATE_CODE_NOT_FOUND','G05-BILLING-D1','AI-2',
   'Trace the real source and existing disabled BillingClient candidate',
   'repo_missing'));
 const toml=typeof input?.workerToml==='string'
  ?activeToml(input.workerToml):'';
 const hasD1=/^\[\[d1_databases\]\]$/m.test(toml)
  ||/^\[\[env\.staging\.d1_databases\]\]$/m.test(toml);
 if(!hasD1)
  blockers.push(b('BILLING_D1_BINDING_NOT_CONFIGURED','G05-BILLING-D1','AI-4',
   'Approved isolated staging Billing D1 binding, CAS and real migration readback',
   'repo_missing'));
 else blockers.push(b('BILLING_D1_REAL_CAS_UNVERIFIED','G05-BILLING-D1','AI-2',
  'Real Cloudflare D1 first-claim, idempotent entitlement CAS, rollback',
  'unverified_live'));
 blockers.push(
  b('APPLE_OFFICIAL_X5C_SANDBOX_MISSING','G04-STORE','AI-2',
   'Official Apple x5c-trust-chain server verifier and signed sandbox refund/restore evidence',
   'unverified_live'),
  b('GOOGLE_PLAY_API_RTDN_SANDBOX_MISSING','G04-STORE','AI-2',
   'Official Google Play API+RTDN verified transaction/renewal/refund source',
   'unverified_live'),
  b('CANONICAL_PER_APP_PRODUCT_APPROVAL_MISSING','G04-STORE','AI-2',
   'Human approved App Store/Play app identity, product mapping, environment and one entitlement writer',
   'owner_approval_missing'),
  b('R23_AUTH_LAWFUL_IDENTITY_BINDING_MISSING','CROSS_OWNER','AI-1',
   'Q104/Q119 lawful processing, member HMAC mapping, deleted/revoked Session evidence',
   'owner_approval_missing'),
  b('REFUND_EVENT_ORDER_AND_RESTORE_LIVE_PROOF_MISSING','G05-BILLING-D1','AI-2',
   'Store-authoritative refund/chargeback vs renewal, replay, restore, deletion and anti-PITR floor tests',
   'unverified_live'),
  b('P05_SIGNED_OUTBOX_ACK_SOURCE_MISSING','CROSS_OWNER','AI-0',
   'Single approved signed P05 publisher, committed outbox, independent durable witness and Queue ACK',
   'owner_approval_missing'),
  b('D03_PROVIDER_AND_PAID_COST_APPROVAL_MISSING','R23_RELEASE','AI-0',
   'RevenueCat vs self-managed Store authority, native sandbox and cost approval',
   'owner_approval_missing'),
  b('OWNER_RELEASE_GATE_BLOCKED','R23_RELEASE','AI-0',
   'Independent official G00-G10 release evidence and explicit authorized approval',
   'owner_approval_missing')
 );
 return Object.freeze({
  schema_version:R23_STORE_PREFLIGHT_VERSION,
  status:'blocked' as const,source:'local_repo_static_only' as const,
  observed_g04:g04?'blocked':'invalid_or_unverified',
  observed_g05:g05?'blocked':'invalid_or_unverified',
  central_release_blocked:true as const,code_exists:codeExists,
  verified_offline_by_this_scan:false as const,verified_live:false as const,
  can_sell:false as const,can_grant:false as const,can_restore:false as const,
  can_ack_queue:false as const,can_remove_ads:false as const,
  can_deploy:false as const,no_store_or_member_data_processed:true as const,
  blockers:Object.freeze(blockers)
 });
}
