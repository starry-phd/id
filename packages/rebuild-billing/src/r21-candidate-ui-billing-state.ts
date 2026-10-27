/** AI-2 R21: Candidate Consumer-A READ-ONLY UI Billing projection.
 * Not a real product, signed Store authority, paid entitlement, SKU or purchase.
 * Inherits R20 namespace and R19 local refund/delete readback without changes.
 */
import type {R20Request,R20Outcome} from './r20-namespace-mapping-gate.ts';
export const R21_BILLING_LIVE=false as const;
export const R21_BILLING_IAP_ENABLED=false as const;
export const R21_BILLING_PURCHASE_ALLOWED=false as const;
export type R21Screen='HOME'|'TASK_REVIEW'|'ACCOUNT_SETTINGS';
export type R21State='official_store_unverified'|'entitlement_unknown'|
 'revoked'|'refund_review_only'|'iap_not_offered';
export type R21Result=Readonly<{
 version:1;kind:'starry_offline_candidate_billing_ui';screen:R21Screen;
 state:R21State;reason:string;product_approved:false;
 evidence:'none'|'local_only';battery:Readonly<{
  permanently_free:true;purchasable:false;redeemable_for_paid:false;
 }>;store:Readonly<{
  iap_available:false;purchase_enabled:false;subscription_active:false;
  verified_purchase:false;verified_refund:false;show_sku:false;show_price:false;
 }>;may_ack_queue:false;may_grant:false;may_regrant:false;
 may_restore:false;may_publish:false;live:false;
}>;
export type R21Input=Readonly<{screen:R21Screen;mapping:R20Request}>;
type ReadDb=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...args:(string|number)[])=>Readonly<{
 first:<T extends Record<string,unknown>>()=>Promise<T|null>;
 }>}>}>;
export type R21Ports=Readonly<{
 lawfulProcessingAndRetention:()=>Promise<boolean>;
 /** Read independent Auth stub; no raw member/IDs returned to UI. */
 readAuthCandidate:()=>Promise<unknown>;
 /** This is a stub, NOT an official Apple/Google Store verifier. */
 readStoreCandidate:()=>Promise<unknown>;
 /** Must be the actual R20 read-only namespace Gate. */
 inspectR20:(mapping:R20Request)=>Promise<R20Outcome>;
}>;
const REF=/^r_[a-f0-9]{64}$/,MEMBER=/^m_[a-f0-9]{64}$/;
const VERSION=['mapping_version','auth','auth_version','billing'] as const;
const BILL=['brand_id','environment','app_ref','store_app_ref','member_ref',
 'source_event_id','source_commit_ref','event_ref','event_digest',
 'auth_version','occurred_at_sec','store','transaction_ref','refund_event_ref',
 'refund_source_version','refund_kind'] as const;
const AUTH=['status','brand_id','environment','app_ref'] as const;
const STORE=['status','brand_id','environment','app_ref','store_app_ref'] as const;
const R20RESULT=['status','reason','candidate','may_ack_queue','may_regrant',
 'may_restore','may_publish','may_grant','live'] as const;
const R20CANDIDATE=['kind','mapping_version','auth_event_id','auth_member_ref',
 'billing_member_digest','billing_source_event_id','store','store_app_ref',
 'store_transaction_ref','store_refund_event_ref','store_source_version',
 'hmac_binding_approved','store_signature_verified',
 'external_pitr_witness_verified','publishable'] as const;
const SQL_FIELDS=['active_count','revoked_count','delete_inbox_count',
 'tombstone_count','refund_count','floor_source_version','battery_paid_count'] as const;
function exact(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return null;
  const d=Object.getOwnPropertyDescriptors(x);
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   if(!Object.hasOwn(d,k)||!d[k].enumerable||!('value'in d[k]))return null;
   out[k]=d[k].value;
  }return out;
 }catch{return null;}
}
const INT=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const REPORT_BATTERY=Object.freeze({permanently_free:true,purchasable:false,
 redeemable_for_paid:false});
const REPORT_STORE=Object.freeze({iap_available:false,purchase_enabled:false,
 subscription_active:false,verified_purchase:false,verified_refund:false,
 show_sku:false,show_price:false});
const show=(screen:R21Screen,state:R21State,reason:string,
 evidence:'none'|'local_only'='none'):R21Result=>Object.freeze({
 version:1,kind:'starry_offline_candidate_billing_ui',
 screen,state,reason,product_approved:false,evidence,
 battery:REPORT_BATTERY,store:REPORT_STORE,
 may_ack_queue:false,may_grant:false,may_regrant:false,
 may_restore:false,may_publish:false,live:false,
});
function r20LocalOnly(raw:unknown,m:R20Request):boolean{
 const x=exact(raw,R20RESULT);
 if(!x||x.status!=='review_only'||x.may_ack_queue!==false
  ||x.may_regrant!==false||x.may_restore!==false||x.may_publish!==false
  ||x.may_grant!==false||x.live!==false)return false;
 const c=exact(x.candidate,R20CANDIDATE),b=m.billing;
 return c!==null&&c.kind==='r20_unapproved_namespace_mapping_candidate'
  &&c.mapping_version===1&&c.auth_event_id===m.auth.event_id
  &&c.auth_member_ref===m.auth.member_ref
  &&c.billing_member_digest===b.member_ref
  &&c.billing_source_event_id===b.source_event_id
  &&c.store===b.store&&c.store_app_ref===b.store_app_ref
  &&c.store_transaction_ref===b.transaction_ref
  &&c.store_refund_event_ref===b.refund_event_ref
  &&c.store_source_version===b.refund_source_version
  &&c.hmac_binding_approved===false&&c.store_signature_verified===false
  &&c.external_pitr_witness_verified===false&&c.publishable===false;
}
function readLocal(raw:unknown,m:R20Request){
 const a=exact(raw,SQL_FIELDS),v=m.billing;
 if(!a||SQL_FIELDS.some(k=>a[k]!==null&&!INT(a[k])))return null;
 if(a.active_count!==0||a.battery_paid_count!==0)return 'CONFLICTING_PAID_RIGHTS';
 if(a.delete_inbox_count!==1||a.tombstone_count!==1)return 'DELETION_RECEIPT_MISSING';
 if(a.refund_count!==1||a.floor_source_version!==v.refund_source_version)
  return 'REFUND_VERSION_OR_PITR_MISMATCH';
 return a.revoked_count===0?'REFUND_ONLY':'LOCAL_REVOKED';
}
/** Exactly one local Billing connection. Reads existing R14/R16/R18 only.
 * No STORE authority, no rights grant; never run on real Cloudflare D1.
 */
export const R21_BILLING_UI_READ_SQL=[
 'WITH s AS (SELECT ? AS environment,? AS member_ref,? AS source_event_id,',
 '? AS refund_event_ref,? AS store_app_ref,? AS transaction_ref,',
 '? AS store,? AS auth_version) SELECT',
 "(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c WHERE c.environment=s.environment AND c.member_ref=s.member_ref AND c.candidate_state='candidate_active') AS active_count,",
 "(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c WHERE c.environment=s.environment AND c.member_ref=s.member_ref AND c.candidate_state='revoked') AS revoked_count,",
 "(SELECT COUNT(*) FROM billing_delete_inbox_R16_DRAFT i WHERE i.environment=s.environment AND i.member_ref=s.member_ref AND i.source_event_id=s.source_event_id AND i.auth_version=s.auth_version) AS delete_inbox_count,",
 "(SELECT COUNT(*) FROM billing_deletion_fence_DRAFT f WHERE f.environment=s.environment AND f.member_ref=s.member_ref AND f.deleted_version=s.auth_version) AS tombstone_count,",
 "(SELECT COUNT(*) FROM billing_r18_refund_inbox_DRAFT i WHERE i.environment=s.environment AND i.member_ref=s.member_ref AND i.store=s.store AND i.store_app_ref=s.store_app_ref AND i.transaction_ref=s.transaction_ref AND i.event_ref=s.refund_event_ref) AS refund_count,",
 "(SELECT MAX(source_version) FROM billing_r18_refund_floor_DRAFT f WHERE f.environment=s.environment AND f.store=s.store AND f.store_app_ref=s.store_app_ref AND f.transaction_ref=s.transaction_ref AND f.member_ref=s.member_ref) AS floor_source_version,",
 "(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c WHERE c.environment=s.environment AND c.member_ref=s.member_ref AND lower(c.offer_id) LIKE '%battery%') AS battery_paid_count FROM s"
].join(' ');

export function createOfflineR21BillingUiProjection(deps:Readonly<{
 enabled?:boolean;scope:Readonly<{brand_id:'starry';
 environment:'development'|'staging';app_ref:string;store_app_ref:string}>;
 db:ReadDb;ports:R21Ports;
}>){
 const s=exact(deps?.scope,['brand_id','environment','app_ref','store_app_ref']);
 if(!s||s.brand_id!=='starry'
  ||(s.environment!=='development'&&s.environment!=='staging')
  ||typeof s.app_ref!=='string'||!REF.test(s.app_ref)
  ||typeof s.store_app_ref!=='string'||!REF.test(s.store_app_ref)
  ||typeof deps.db?.prepare!=='function'
  ||typeof deps.ports?.lawfulProcessingAndRetention!=='function'
  ||typeof deps.ports?.readAuthCandidate!=='function'
  ||typeof deps.ports?.readStoreCandidate!=='function'
  ||typeof deps.ports?.inspectR20!=='function')
  throw Error('R21_BILLING_UI_CONFIG_DENIED');
 const scope=Object.freeze({...s});
 return Object.freeze({
  async project(input:unknown):Promise<R21Result>{
   const x=exact(input,['screen','mapping']);
   const screen: R21Screen=x?.screen==='TASK_REVIEW'?'TASK_REVIEW':
    x?.screen==='ACCOUNT_SETTINGS'?'ACCOUNT_SETTINGS':'HOME';
   if(!deps.enabled)return show(screen,'iap_not_offered','CANDIDATE_APP_NOT_APPROVED');
   if(!x||(x.screen!=='HOME'&&x.screen!=='TASK_REVIEW'&&x.screen!=='ACCOUNT_SETTINGS'))
    return show(screen,'entitlement_unknown','INVALID_SCREEN');
   // A free Battery task has NO STORE PURCHASE path, even when private ports fail.
   if(screen==='TASK_REVIEW')return show(screen,'iap_not_offered','FREE_BATTERY_NOT_PURCHASABLE');
   const map=exact(x.mapping,VERSION),bill=exact(map?.billing,BILL);
   if(!map||map.mapping_version!==1||!bill||bill.brand_id!=='starry'
    ||bill.environment!==scope.environment||bill.app_ref!==scope.app_ref
    ||bill.store_app_ref!==scope.store_app_ref
    ||typeof bill.member_ref!=='string'||!MEMBER.test(bill.member_ref)
    ||typeof bill.source_event_id!=='string'
    ||typeof bill.refund_event_ref!=='string'
    ||typeof bill.transaction_ref!=='string'
    ||typeof bill.store!=='string'
    ||!INT(bill.auth_version)||!INT(bill.refund_source_version))
    return show(screen,'entitlement_unknown','FOREIGN_OR_MALFORMED_INPUT');
   try{
    if(await deps.ports.lawfulProcessingAndRetention()!==true)
     return show(screen,'entitlement_unknown','POLICY_OR_LAW_UNAPPROVED');
    const a=exact(await deps.ports.readAuthCandidate(),AUTH);
    if(!a||a.status!=='offline_deleted_candidate'
     ||a.brand_id!=='starry'||a.environment!==scope.environment
     ||a.app_ref!==scope.app_ref)
     return show(screen,'entitlement_unknown','AUTH_SOURCE_UNVERIFIED');
    const store=exact(await deps.ports.readStoreCandidate(),STORE);
    if(!store||store.brand_id!=='starry'||store.environment!==scope.environment
     ||store.app_ref!==scope.app_ref||store.store_app_ref!==scope.store_app_ref)
     return show(screen,'official_store_unverified','STORE_SOURCE_UNAVAILABLE');
    if(store.status!=='offline_refund_candidate')
     return show(screen,'official_store_unverified','OFFICIAL_STORE_NOT_VERIFIED');
    if(!r20LocalOnly(await deps.ports.inspectR20(x.mapping as R20Request),
     x.mapping as R20Request))
     return show(screen,'entitlement_unknown','R20_NAMESPACE_OR_IDENTITY_UNVERIFIED');
    const m=x.mapping as R20Request,b=m.billing;
    const lookup=()=>deps.db.prepare(R21_BILLING_UI_READ_SQL).bind(
     b.environment,b.member_ref,b.source_event_id,b.refund_event_ref,
     b.store_app_ref,b.transaction_ref,b.store,b.auth_version)
     .first<Record<string,unknown>>();
    const first=readLocal(await lookup(),m);
    if(first!=='REFUND_ONLY'&&first!=='LOCAL_REVOKED')
     return show(screen,'entitlement_unknown',first??'BILLING_RECEIPT_MISSING');
    if(await deps.ports.lawfulProcessingAndRetention()!==true)
     return show(screen,'entitlement_unknown','POLICY_CHANGED_AFTER_READ');
    if(!r20LocalOnly(await deps.ports.inspectR20(m),m))
     return show(screen,'entitlement_unknown','R20_SOURCE_CHANGED');
    const second=readLocal(await lookup(),m);
    if(second!==first)
     return show(screen,'entitlement_unknown','BILLING_CHANGED_AFTER_READ');
    return first==='LOCAL_REVOKED'
     ?show(screen,'revoked','LOCAL_REVOKED_NOT_STORE_AUTHORITY','local_only')
     :show(screen,'refund_review_only','UNVERIFIED_REFUND_LOCAL_REVIEW','local_only');
   }catch{return show(screen,'entitlement_unknown','PRIVATE_READ_FAILED');}
  }
 });
}
