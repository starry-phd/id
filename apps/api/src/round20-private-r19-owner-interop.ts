/**
 * AI-4 R20 private-only R19 owner adapter interop, NOT a Queue/Worker route.
 * This contract intentionally cannot issue an ACK even if all three owners
 * report matching local candidate observations. No external signer, approved
 * account_deleted <-> Store identity mapping, or physical cross-D1 authority.
 */
import {createOfflineAuthCrossDomainDTO} from '../../../modules/starry-id-v1/src/round19-auth-cross-domain-dto.ts';
import type {R19OfflineSourceDTO} from '../../../modules/starry-id-v1/src/round19-auth-cross-domain-dto.ts';
import {createOfflineBillingR19ReceiptReview} from '../../../packages/rebuild-billing/src/r19-saga-receipt.ts';
import type {R19Outcome as BillingReview} from '../../../packages/rebuild-billing/src/r19-saga-receipt.ts';
import {createOfflineR19TaskWalletReview} from '../../../packages/rebuild-ai3/src/r19-task-wallet-receipt-gate.ts';
import type {R19Decision as TaskWalletReview} from '../../../packages/rebuild-ai3/src/r19-task-wallet-receipt-gate.ts';
import {createR19OfflineFourDomainWire} from './round19-offline-four-domain-wiring.ts';

export const R20_LIVE_OWNER_FANOUT_ENABLED=false as const;
export const R20_TRUSTED_IDENTITY_MAPPING_APPROVED=false as const;
export const R20_SIGNED_EXTERNAL_AUTH_SOURCE_APPROVED=false as const;
export const R20_PHYSICAL_QUEUE_ACK_APPROVED=false as const;
export const R20_WIRING_CONTRACT='starry.r20.owner-r19-adapters.private-offline.v0' as const;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const POLICY=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$/;
const AUTH_FIELDS=['disposition','reader','scope','event','auth_version','source_attempt_no','policy_revision',
 'may_publish','may_ack_queue','may_grant','may_restore','may_regrant','live'] as const;
const BILL_FIELDS=['status','reason','receipt','may_ack_queue','may_regrant','may_restore','may_publish','live'] as const;
const TASK_FIELDS=['status','reason','candidate_receipt','may_settle','may_release','may_ack_queue',
 'may_regrant','may_restore','may_sell_battery','live'] as const;
const LAW_FIELDS=['revision','processing_approved','retention_approved'] as const;
const FIXED_MISSING=Object.freeze([
 'OFFICIAL_P05_SIGNED_AUTH_ISSUER_AND_LEASE',
 'Q104_Q119_APPROVED_CROSS_DOMAIN_IDENTITY_MAPPING',
 'OFFICIAL_STORE_REFUND_AUTHORITY',
 'TRUSTED_NONROLLBACKABLE_EXTERNAL_WITNESS',
 'APPROVED_PHYSICAL_CROSS_D1_ACK_AFTER_COMMIT'
] as const);
type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
type AuthAdapter=Pick<ReturnType<typeof createOfflineAuthCrossDomainDTO>,'readForOfflineConsumer'>;
type BillingAdapter=Pick<ReturnType<typeof createOfflineBillingR19ReceiptReview>,'inspect'>;
type BatteryAdapter=Pick<ReturnType<typeof createOfflineR19TaskWalletReview>,'inspect'>;
type SagaAdapter=Pick<ReturnType<typeof createR19OfflineFourDomainWire>,'inspect'>;
export type R20OwnerPorts=Readonly<{
 auth:AuthAdapter;
 billing:BillingAdapter;
 battery:BatteryAdapter;
 saga:SagaAdapter;
 readLaw:()=>Promise<unknown>;
}>;
export type R20OwnerReview=Readonly<{
 status:'blocked'|'review_only';reason:string;
 owner_observation:Readonly<{
  auth:'blocked'|'offline_candidate_only';
  billing:'not_checked'|'blocked'|'retry'|'review_only';
  battery:'not_checked'|'blocked'|'review_only';
  saga:'not_checked'|'blocked'|'retry'|'review_only';
 }>;
 missing_authorities:typeof FIXED_MISSING;
 may_ack_queue:false;may_dlq:false;may_release_task:false;
 may_settle_task:false;may_regrant:false;may_restore:false;
 may_publish:false;may_sell_battery:false;publishable:false;live:false;
}>;
const safeInt=(v:unknown,min=0):v is number=>typeof v==='number'&&
 Number.isSafeInteger(v)&&v>=min;
function exact(value:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of fields){
   const d=Object.getOwnPropertyDescriptor(value,key);
   if(!d||!d.enumerable||!('value' in d))return null;
   o[key]=d.value;
  }
  return o;
 }catch{return null;}
}
function observed(status:R20OwnerReview['status'],reason:string,
 auth:R20OwnerReview['owner_observation']['auth']='blocked',
 billing:R20OwnerReview['owner_observation']['billing']='not_checked',
 battery:R20OwnerReview['owner_observation']['battery']='not_checked',
 saga:R20OwnerReview['owner_observation']['saga']='not_checked'):R20OwnerReview{
 return Object.freeze({status,reason,owner_observation:Object.freeze({auth,billing,battery,saga}),
  missing_authorities:FIXED_MISSING,may_ack_queue:false,may_dlq:false,
  may_release_task:false,may_settle_task:false,may_regrant:false,
  may_restore:false,may_publish:false,may_sell_battery:false,publishable:false,live:false});
}
function law(value:unknown,pinned:string):boolean{
 const row=exact(value,LAW_FIELDS);
 return !!row&&row.revision===pinned&&row.processing_approved===true&&
 row.retention_approved===true;
}
function authDTO(value:unknown,scope:Scope,rev:string):R19OfflineSourceDTO|null{
 const a=exact(value,AUTH_FIELDS);
 if(!a||a.disposition!=='offline_untrusted_cross_domain_auth_projection'||
  a.reader!=='saga'||a.policy_revision!==rev||!safeInt(a.auth_version,2)||
  !safeInt(a.source_attempt_no,1)||!['may_publish','may_ack_queue','may_grant',
  'may_restore','may_regrant','live'].every(k=>a[k]===false))return null;
 const sc=exact(a.scope,['brand_id','environment']);
 const ev=exact(a.event,['event_id','member_ref','occurred_at_sec','event_type']);
 if(!sc||sc.brand_id!=='starry'||sc.environment!==scope.environment||
  !ev||typeof ev.event_id!=='string'||!EVENT.test(ev.event_id)||
  typeof ev.member_ref!=='string'||!TOKEN.test(ev.member_ref)||
  !safeInt(ev.occurred_at_sec,1)||ev.event_type!=='account_deleted')return null;
 return value as R19OfflineSourceDTO;
}
function billingReview(value:unknown):BillingReview|null{
 const b=exact(value,BILL_FIELDS);
 if(!b||!['blocked','retry','review_only','disabled'].includes(String(b.status))||
  typeof b.reason!=='string'||!['may_ack_queue','may_regrant','may_restore',
  'may_publish','live'].every(k=>b[k]===false))return null;
 if(b.status==='review_only'){
  const r=exact(b.receipt,['kind','brand_id','environment','member_ref','app_ref',
   'source_event_id','auth_version','refund_event_ref','refund_source_version',
   'locally_matched','official_store_verified','independent_witness_verified']);
  if(!r||r.kind!=='offline_candidate_only'||r.brand_id!=='starry'||
   r.locally_matched!==true||r.official_store_verified!==false||
   r.independent_witness_verified!==false)return null;
 }else if(b.receipt!==null)return null;
 return value as BillingReview;
}
function taskReview(value:unknown):TaskWalletReview|null{
 const t=exact(value,TASK_FIELDS);
 if(!t||!['blocked','review_only'].includes(String(t.status))||
  typeof t.reason!=='string'||!['may_settle','may_release','may_ack_queue',
  'may_regrant','may_restore','may_sell_battery','live'].every(k=>t[k]===false))return null;
 if(t.status==='review_only'){
  const r=exact(t.candidate_receipt,['brand_id','environment','task_ref','source_event_ref',
   'policy_version','wallet_revision','task_attempt','kind']);
  if(!r||r.brand_id!=='starry'||r.kind!=='OFFLINE_UNTRUSTED_LOCAL_RECEIPT'||
   r.task_attempt!==1)return null;
 }else if(t.candidate_receipt!==null)return null;
 return value as TaskWalletReview;
}
function sameAuth(a:R19OfflineSourceDTO,b:R19OfflineSourceDTO|null):boolean{
 return !!b&&a.reader===b.reader&&a.source_attempt_no===b.source_attempt_no&&
 a.auth_version===b.auth_version&&a.policy_revision===b.policy_revision&&
 a.event.event_id===b.event.event_id&&a.event.member_ref===b.event.member_ref&&
 a.event.occurred_at_sec===b.event.occurred_at_sec;
}
export function createR20PrivateOwnerInterop(scope:Scope,pinnedRevision:string,ports:R20OwnerPorts){
 const s=exact(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(String(s.environment)))
  throw Error('AI4_R20_SCOPE_DENIED');
 if(typeof pinnedRevision!=='string'||!POLICY.test(pinnedRevision))
  throw Error('AI4_R20_REVISION_REQUIRED');
 if(!ports||typeof ports.auth?.readForOfflineConsumer!=='function'||
  typeof ports.billing?.inspect!=='function'||typeof ports.battery?.inspect!=='function'||
  typeof ports.saga?.inspect!=='function'||typeof ports.readLaw!=='function')
  throw Error('AI4_R20_OWNER_ADAPTERS_REQUIRED');
 const stable:Scope=Object.freeze({brand_id:'starry',
  environment:s.environment as Scope['environment']});
 const readAuth=async(claim:unknown):Promise<R19OfflineSourceDTO|null>=>
  authDTO(await ports.auth.readForOfflineConsumer(claim,'saga',stable),stable,pinnedRevision);
 return Object.freeze({
  async review(claim:unknown,billingRequest:unknown,taskMemberRef:unknown,
   taskRef:unknown,nowSec:unknown):Promise<R20OwnerReview>{
   if(typeof taskMemberRef!=='string'||!TOKEN.test(taskMemberRef)||
    typeof taskRef!=='string'||!TOKEN.test(taskRef)||
    !safeInt(nowSec,1)||!safeInt(nowSec*1000))
    return observed('blocked','INVALID_LOCATORS_OR_CLOCK');
   try{
    if(!law(await ports.readLaw(),pinnedRevision))
     return observed('blocked','LAWFUL_PURPOSE_RETENTION_OR_POLICY_MISSING');
    const source=await readAuth(claim);
    if(!source)return observed('blocked','ACTUAL_AI1_AUTH_R19_DTO_MISSING');
    if(source.event.occurred_at_sec>nowSec)
     return observed('blocked','FUTURE_AUTH_EVENT_DENIED');
    const billing=billingReview(await ports.billing.inspect(billingRequest));
    const battery=taskReview(await ports.battery.inspect(taskMemberRef,taskRef,nowSec*1000));
    const bs=billing?.status==='review_only'?'review_only':billing?.status==='retry'?'retry':'blocked';
    const ts=battery?.status==='review_only'?'review_only':'blocked';
    if(!billing||!battery||bs!=='review_only'||ts!=='review_only')
     return observed('blocked','OWNER_R19_RECEIPT_NOT_CURRENT_OR_LOCALLY_COMMITTED',
      'offline_candidate_only',bs,ts);
    if(!billing.receipt||!battery.candidate_receipt||
     billing.receipt.environment!==stable.environment||
     battery.candidate_receipt.environment!==stable.environment||
     billing.receipt.source_event_id!==source.event.event_id||
     billing.receipt.auth_version!==source.auth_version||
     battery.candidate_receipt.task_ref!==taskRef)
     return observed('blocked','EVENT_VERSION_OR_ENVIRONMENT_MISMATCH',
      'offline_candidate_only','review_only','review_only');
    // Auth deletion and AI-3 active Task source are semantically different.
    // AI-1 s_user_id and Billing opaque m_hash MUST NOT be equated by format.
    // Task source_event_ref is not the account_deleted outbox event.
    // No officially approved mapper exists: never invoke the Saga writer
    // merely because three local mock/same-shape receipts happen to match.
    const later=await readAuth(claim);
    if(!sameAuth(source,later))
     return observed('blocked','AUTH_SOURCE_CHANGED_AFTER_OWNER_READS',
      'offline_candidate_only','review_only','review_only');
    if(!law(await ports.readLaw(),pinnedRevision))
     return observed('blocked','LEGAL_OR_POLICY_CHANGED_AFTER_OWNER_READS',
      'offline_candidate_only','review_only','review_only');
    return observed('review_only','OFFLINE_OWNER_R19_LOCAL_RECEIPTS_NOT_AN_APPROVED_MAPPING',
     'offline_candidate_only','review_only','review_only');
   }catch{
    return observed('blocked','OWNER_ADAPTER_OR_DATABASE_UNAVAILABLE');
   }
  }
 });
}
