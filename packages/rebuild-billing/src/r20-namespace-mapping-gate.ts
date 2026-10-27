/** AI-2 R20. Explicit cross-namespace mapping is an UNAPPROVED offline observation.
 * Auth account_deleted/event_id, Billing member digest and Store refund/transaction
 * are NEVER interchangeable. No approved HMAC, P05, KMS, Store or PITR attestation.
 */
import type {R19Request,R19Outcome,R19Scope} from './r19-saga-receipt.ts';
export const R20_BILLING_LIVE=false as const;
export const R20_BILLING_ACK_ALLOWED=false as const;
export const R20_BILLING_BINDING_APPROVED=false as const;
export const R20_BILLING_STORE_SIGNER_APPROVED=false as const;
export type R20AuthEvent=Readonly<{
 event_id:string;event_type:'account_deleted';member_ref:string;occurred_at_sec:number;
}>;
export type R20Request=Readonly<{
 mapping_version:1;auth:R20AuthEvent;auth_version:number;billing:R19Request;
}>;
export type R20Candidate=Readonly<{
 kind:'r20_unapproved_namespace_mapping_candidate';
 mapping_version:1;auth_event_id:string;auth_member_ref:string;
 billing_member_digest:string;billing_source_event_id:string;
 store:'apple'|'google';store_app_ref:string;store_transaction_ref:string;
 store_refund_event_ref:string;store_source_version:number;
 hmac_binding_approved:false;store_signature_verified:false;
 external_pitr_witness_verified:false;publishable:false;
}>;
export type R20Outcome=Readonly<{
 status:'disabled'|'blocked'|'retry'|'review_only';reason:string;
 candidate:R20Candidate|null;may_ack_queue:false;may_regrant:false;
 may_restore:false;may_publish:false;may_grant:false;live:false;
}>;
type Ports=Readonly<{
 lawfulProcessingAndRetention:()=>Promise<boolean>;
 /** Read exact AI-1 original four-field outbox from independent Auth DB. */
 readAuthOriginal:(eventId:string)=>Promise<unknown>;
 /** Read from separate unapproved test witness, never treat as lawful HMAC. */
 readBindingCandidate:(eventId:string)=>Promise<unknown>;
 readFloorCandidate:(eventId:string)=>Promise<unknown>;
 /** Invoke original AI-2 R19 READ-ONLY adapter (actual Billing SQLite). */
 inspectBillingR19:(candidate:R19Request)=>Promise<R19Outcome>;
}>;
const REF=/^r_[a-f0-9]{64}$/,MEMBER=/^m_[a-f0-9]{64}$/,
 EVENT=/^[A-Za-z0-9._:-]{20,180}$/,HEX=/^[a-f0-9]{64}$/;
const int=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const AUTH=['event_id','event_type','member_ref','occurred_at_sec'] as const;
const REQUEST=['mapping_version','auth','auth_version','billing'] as const;
const BILLING=['brand_id','environment','app_ref','store_app_ref','member_ref',
 'source_event_id','source_commit_ref','event_ref','event_digest','auth_version',
 'occurred_at_sec','store','transaction_ref','refund_event_ref',
 'refund_source_version','refund_kind'] as const;
const BIND=['status','mapping_version','brand_id','environment',
 'auth_event_id','auth_member_ref','billing_member_digest',
 'billing_source_event_id','auth_version','store_app_ref',
 'store_transaction_ref','store_refund_event_ref','store_source_version'] as const;
const FLOOR=['status','mapping_version','brand_id','environment',
 'auth_event_id','billing_member_digest','billing_source_event_id',
 'store_refund_event_ref','store_source_version'] as const;
const R19RECEIPT=['kind','brand_id','environment','member_ref','app_ref',
 'source_event_id','auth_version','refund_event_ref','refund_source_version',
 'locally_matched','official_store_verified','independent_witness_verified'] as const;
const R19RESULT=['status','reason','receipt','may_ack_queue','may_regrant',
 'may_restore','may_publish','live'] as const;
function exact(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const d=Object.getOwnPropertyDescriptors(x);
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   if(!Object.hasOwn(d,k)||!d[k].enumerable||!('value' in d[k]))return null;
   out[k]=d[k].value;
  }
  return out;
 }catch{return null;}
}
const result=(status:R20Outcome['status'],reason:string,
 candidate:R20Candidate|null=null):R20Outcome=>Object.freeze({
 status,reason,candidate,may_ack_queue:false,may_regrant:false,
 may_restore:false,may_publish:false,may_grant:false,live:false,
});
function request(input:unknown,s:R19Scope):R20Request|null{
 const v=exact(input,REQUEST);
 if(!v||v.mapping_version!==1||!int(v.auth_version)||v.auth_version<2)return null;
 const a=exact(v.auth,AUTH),b=exact(v.billing,BILLING);
 if(!a||!b||a.event_type!=='account_deleted'
  ||typeof a.event_id!=='string'||!EVENT.test(a.event_id)
  ||typeof a.member_ref!=='string'||!MEMBER.test(a.member_ref)
  ||!int(a.occurred_at_sec)
  ||b.brand_id!=='starry'||b.environment!==s.environment
  ||b.app_ref!==s.app_ref||b.store_app_ref!==s.store_app_ref
  ||typeof b.member_ref!=='string'||!MEMBER.test(b.member_ref)
  ||typeof b.source_event_id!=='string'||!EVENT.test(b.source_event_id)
  ||typeof b.source_commit_ref!=='string'||!REF.test(b.source_commit_ref)
  ||typeof b.event_ref!=='string'||!REF.test(b.event_ref)
  ||typeof b.event_digest!=='string'||!HEX.test(b.event_digest)
  ||!int(b.auth_version)||b.auth_version!==v.auth_version
  ||!int(b.occurred_at_sec)
  ||(b.store!=='apple'&&b.store!=='google')
  ||typeof b.transaction_ref!=='string'||!REF.test(b.transaction_ref)
  ||typeof b.refund_event_ref!=='string'||!REF.test(b.refund_event_ref)
  ||!int(b.refund_source_version)
  ||(b.refund_kind!=='REFUNDED'&&b.refund_kind!=='CHARGEBACK'
   &&b.refund_kind!=='REVOKED')
  // Never reinterpret same-looking Auth Member as Billing HMAC proof.
  ||a.member_ref===b.member_ref
  ||a.event_id===b.source_event_id
  ||a.event_id===b.refund_event_ref
  ||b.event_ref===b.refund_event_ref
  ||b.transaction_ref===b.refund_event_ref)return null;
 return Object.freeze({mapping_version:1,auth:Object.freeze({...a}) as R20AuthEvent,
  auth_version:v.auth_version,billing:Object.freeze({...b}) as R19Request});
}
const sourceOK=(a:unknown,v:R20Request)=>{
 const o=exact(a,AUTH);
 return o!==null&&AUTH.every(k=>o[k]===v.auth[k]);
};
function bindingOK(a:unknown,v:R20Request){
 const o=exact(a,BIND),b=v.billing,t=v.auth;
 return o!==null&&o.status==='unapproved_local_mapping_candidate'
  &&o.mapping_version===1&&o.brand_id==='starry'
  &&o.environment===b.environment
  &&o.auth_event_id===t.event_id&&o.auth_member_ref===t.member_ref
  &&o.billing_member_digest===b.member_ref
  &&o.billing_source_event_id===b.source_event_id
  &&o.auth_version===v.auth_version
  &&o.store_app_ref===b.store_app_ref
  &&o.store_transaction_ref===b.transaction_ref
  &&o.store_refund_event_ref===b.refund_event_ref
  &&o.store_source_version===b.refund_source_version;
}
function floorOK(x:unknown,v:R20Request){
 const o=exact(x,FLOOR),b=v.billing;
 return o!==null&&o.status==='unapproved_local_test_floor'
  &&o.mapping_version===1&&o.brand_id==='starry'
  &&o.environment===b.environment
  &&o.auth_event_id===v.auth.event_id
  &&o.billing_member_digest===b.member_ref
  &&o.billing_source_event_id===b.source_event_id
  &&o.store_refund_event_ref===b.refund_event_ref
  &&o.store_source_version===b.refund_source_version;
}
function r19OK(x:unknown,v:R20Request){
 const a=exact(x,R19RESULT);
 if(!a||a.status!=='review_only'||a.may_ack_queue!==false
  ||a.may_regrant!==false||a.may_restore!==false
  ||a.may_publish!==false||a.live!==false)return false;
 const o=exact(a.receipt,R19RECEIPT),b=v.billing;
 return o!==null&&o.kind==='offline_candidate_only'
  &&o.brand_id==='starry'&&o.environment===b.environment
  &&o.member_ref===b.member_ref&&o.app_ref===b.app_ref
  &&o.source_event_id===b.source_event_id&&o.auth_version===b.auth_version
  &&o.refund_event_ref===b.refund_event_ref
  &&o.refund_source_version===b.refund_source_version
  &&o.locally_matched===true&&o.official_store_verified===false
  &&o.independent_witness_verified===false;
}
export function createOfflineBillingR20NamespaceGate(deps:Readonly<{
 enabled?:boolean;scope:R19Scope;ports:Ports;
}>){
 const s=exact(deps?.scope,['brand_id','environment','app_ref','store_app_ref']);
 if(!s||s.brand_id!=='starry'
  ||(s.environment!=='development'&&s.environment!=='staging')
  ||typeof s.app_ref!=='string'||!REF.test(s.app_ref)
  ||typeof s.store_app_ref!=='string'||!REF.test(s.store_app_ref)
  ||typeof deps?.ports?.lawfulProcessingAndRetention!=='function'
  ||typeof deps?.ports?.readAuthOriginal!=='function'
  ||typeof deps?.ports?.readBindingCandidate!=='function'
  ||typeof deps?.ports?.readFloorCandidate!=='function'
  ||typeof deps?.ports?.inspectBillingR19!=='function')
  throw Error('R20_BILLING_NAMESPACE_CONFIG_DENIED');
 const scope=Object.freeze({...s}) as R19Scope;
 return Object.freeze({
  async inspect(input:unknown):Promise<R20Outcome>{
   if(deps.enabled!==true)return result('disabled','DISABLED');
   const v=request(input,scope);
   if(!v)return result('blocked','NAMESPACE_OR_VERSION_INVALID');
   try{
    if(await deps.ports.lawfulProcessingAndRetention()!==true)
     return result('blocked','Q104_Q119_LEGAL_MISSING');
    const source=await deps.ports.readAuthOriginal(v.auth.event_id);
    if(!sourceOK(source,v))return result('blocked','AUTH_ORIGINAL_FOUR_FIELDS_MISMATCH');
    if(!bindingOK(await deps.ports.readBindingCandidate(v.auth.event_id),v))
     return result('blocked','UNAPPROVED_HMAC_MEMBER_MAPPING_MISSING');
    if(!floorOK(await deps.ports.readFloorCandidate(v.auth.event_id),v))
     return result('retry','INDEPENDENT_FLOOR_NOT_ATTESTED');
    const billing=await deps.ports.inspectBillingR19(v.billing);
    if(!r19OK(billing,v))
     return result('blocked','BILLING_R19_NOT_CONSISTENT_OR_NOT_READONLY');
    if(await deps.ports.lawfulProcessingAndRetention()!==true)
     return result('blocked','LAW_CHANGED_AFTER_RECEIPT');
    if(!sourceOK(await deps.ports.readAuthOriginal(v.auth.event_id),v))
     return result('blocked','AUTH_CHANGED_AFTER_RECEIPT');
    if(!bindingOK(await deps.ports.readBindingCandidate(v.auth.event_id),v))
     return result('blocked','BINDING_CHANGED_AFTER_RECEIPT');
    if(!floorOK(await deps.ports.readFloorCandidate(v.auth.event_id),v))
     return result('retry','FLOOR_CHANGED_AFTER_RECEIPT');
    if(!r19OK(await deps.ports.inspectBillingR19(v.billing),v))
     return result('blocked','BILLING_CHANGED_AFTER_RECEIPT');
    const b=v.billing;
    const candidate:R20Candidate=Object.freeze({
     kind:'r20_unapproved_namespace_mapping_candidate',mapping_version:1,
     auth_event_id:v.auth.event_id,auth_member_ref:v.auth.member_ref,
     billing_member_digest:b.member_ref,billing_source_event_id:b.source_event_id,
     store:b.store,store_app_ref:b.store_app_ref,
     store_transaction_ref:b.transaction_ref,store_refund_event_ref:b.refund_event_ref,
     store_source_version:b.refund_source_version,
     hmac_binding_approved:false,store_signature_verified:false,
     external_pitr_witness_verified:false,publishable:false,
    });
    return result('review_only','LOCAL_NAMESPACE_CANDIDATE_ONLY',candidate);
   }catch{return result('retry','SOURCE_DB_OR_TRUST_PORT_UNAVAILABLE');}
  },
 });
}
