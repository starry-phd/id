/**
 * AI-4 R19 PRIVATE offline wiring of four R18 owners and R18 Saga.
 * All ports are read-only except the PRE-EXISTING AI-4 local Saga journal.
 * No queue, second publisher, public API, owner DB write, grant or release.
 */
import type {AuthR18SourceReview} from '../../../modules/starry-id-v1/src/round18-auth-committed-saga-preflight.ts';
import type {R18RecoveryResult} from '../../../packages/rebuild-ai3/src/r18-cross-d1-recovery-review.ts';
import type {R18SagaResult} from './round18-offline-outbox-saga-transport.ts';

export const LIVE_R19_FOUR_DOMAIN_TRANSPORT=false as const;
export const R19_CONTRACT='starry.private-four-domain-wire.v0-draft' as const;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const REV=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/;
const AUTH_FIELDS=['disposition','event_id','attempt_no','auth_version','may_ack_queue','may_mark_delivered','may_regrant','may_restore','may_publish','live'] as const;
const BILL_FIELDS=['event_id','member_ref','environment','auth_version','deletion_inbox_committed','tombstone_revoked','active_entitlements','refund_floor_current'] as const;
const TASK_FIELDS=['task_ref','member_ref','environment','status','wallet_hold_status'] as const;
const POLICY_FIELDS=['revision','processing_approved','retention_approved'] as const;
const SAGA_FIELDS=['status','reason','attempt_count','may_ack_queue','may_dlq','may_release_task','may_regrant','may_restore','publishable','live'] as const;
const BATTERY_FIELDS=['status','reason','may_ack_queue','may_restore','may_regrant','may_settle_task','may_release_task','live'] as const;
type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
const safeInt=(x:unknown,min=0):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min;
function exact(raw:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  const names=Reflect.ownKeys(raw);
  if(names.length!==fields.length||names.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const x:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const f of fields){
   const d=Object.getOwnPropertyDescriptor(raw,f);
   if(!d||!d.enumerable||!('value' in d))return null;
   x[f]=d.value;
  }
  return x;
 }catch{return null;}
}
export type R19BillingReadback=Readonly<{
 event_id:string;member_ref:string;environment:'development'|'staging';
 auth_version:number;deletion_inbox_committed:true;tombstone_revoked:true;
 active_entitlements:0;refund_floor_current:true;
}>;
export type R19TaskReadback=Readonly<{
 task_ref:string;member_ref:string;environment:'development'|'staging';
 status:'cancelled'|'committed';
 wallet_hold_status:'revoked'|'released'|'expired'|'committed';
}>;
export type R19WiringPorts=Readonly<{
 readPolicy:()=>Promise<unknown>;
 inspectAuth:(ref:string)=>Promise<AuthR18SourceReview|null>;
 readBilling:(ref:string)=>Promise<unknown>;
 inspectBattery:(ref:string,nowMs:number)=>Promise<R18RecoveryResult>;
 readTask:(ref:string)=>Promise<unknown>;
 inspectExistingSaga:(ref:string,nowSec:number)=>Promise<R18SagaResult>;
}>;
export type R19Result=Readonly<{
 status:'blocked'|'retry'|'local_consistent_review_only';reason:string;
 may_ack_queue:false;may_dlq:false;may_release_task:false;may_settle_task:false;
 may_regrant:false;may_restore:false;may_publish:false;publishable:false;live:false;
}>;
const result=(status:R19Result['status'],reason:string):R19Result=>Object.freeze({
 status,reason,may_ack_queue:false,may_dlq:false,may_release_task:false,
 may_settle_task:false,may_regrant:false,may_restore:false,may_publish:false,
 publishable:false,live:false
});
function validatePolicy(raw:unknown,pinned:string):boolean{
 const p=exact(raw,POLICY_FIELDS);
 return !!p&&p.revision===pinned&&p.processing_approved===true&&p.retention_approved===true;
}
function validateAuth(raw:unknown,event:string):Record<string,unknown>|null{
 const a=exact(raw,AUTH_FIELDS);
 if(!a||a.disposition!=='offline_auth_source_review_only'||a.event_id!==event||
  !safeInt(a.auth_version,2)||!safeInt(a.attempt_no,1)||
  ['may_ack_queue','may_mark_delivered','may_regrant','may_restore','may_publish','live']
   .some(k=>a[k]!==false))return null;
 return a;
}
function validateBilling(raw:unknown,event:string,env:string):Record<string,unknown>|null{
 const b=exact(raw,BILL_FIELDS);
 if(!b||b.event_id!==event||b.environment!==env||
  typeof b.member_ref!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(b.member_ref)||
  !safeInt(b.auth_version,2)||b.deletion_inbox_committed!==true||
  b.tombstone_revoked!==true||b.active_entitlements!==0||
  b.refund_floor_current!==true)return null;
 return b;
}
function validateBattery(raw:unknown):boolean{
 const b=exact(raw,BATTERY_FIELDS);
 return !!b&&b.status==='review_only'&&
  b.reason==='OFFLINE_CONSISTENT_NOT_AUTHORIZED_FOR_RECOVERY'&&
  ['may_ack_queue','may_restore','may_regrant','may_settle_task','may_release_task','live']
   .every(k=>b[k]===false);
}
function validateTask(raw:unknown,env:string,member:string):Record<string,unknown>|null{
 const t=exact(raw,TASK_FIELDS);
 if(!t||t.environment!==env||t.member_ref!==member||
  typeof t.task_ref!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(t.task_ref)||
  !['committed','cancelled'].includes(String(t.status))||
  (t.status==='committed'&&t.wallet_hold_status!=='committed')||
  (t.status==='cancelled'&&!['revoked','released','expired'].includes(String(t.wallet_hold_status))))
  return null;
 return t;
}
function validateSaga(raw:unknown):boolean{
 const s=exact(raw,SAGA_FIELDS);
 return !!s&&['observed_local','duplicate_local'].includes(String(s.status))&&
  safeInt(s.attempt_count,1)&&
  ['may_ack_queue','may_dlq','may_release_task','may_regrant','may_restore','publishable','live']
   .every(k=>s[k]===false);
}
function equal(a:Record<string,unknown>,b:Record<string,unknown>,keys:readonly string[]):boolean{
 return keys.every(k=>a[k]===b[k]);
}
/**
 * This is a consistency REVIEW, not an authority.
 * The typed Auth/Battery ports accept only their actual owner R18 observations.
 * Billing and Task still lack a shared approved canonical cross-D1 DTO; their
 * strictly read-only local projections MUST be replaced following AI-0 decision.
 */
export function createR19OfflineFourDomainWire(scope:Scope,pinnedRevision:string,ports:R19WiringPorts){
 const s=exact(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(String(s.environment)))
  throw Error('AI4_R19_SCOPE_DENIED');
 if(typeof pinnedRevision!=='string'||!REV.test(pinnedRevision))
  throw Error('AI4_R19_POLICY_REQUIRED');
 if(!ports||typeof ports.readPolicy!=='function'||typeof ports.inspectAuth!=='function'||
  typeof ports.readBilling!=='function'||typeof ports.inspectBattery!=='function'||
  typeof ports.readTask!=='function'||typeof ports.inspectExistingSaga!=='function')
  throw Error('AI4_R19_PORTS_REQUIRED');
 const env=s.environment as Scope['environment'];
 const observed=async(ref:string,nowMs:number)=>{
  const a=validateAuth(await ports.inspectAuth(ref),ref);
  if(!a)return null;
  const b=validateBilling(await ports.readBilling(ref),ref,env);
  if(!b||a.auth_version!==b.auth_version)return null;
  if(!validateBattery(await ports.inspectBattery(ref,nowMs)))return null;
  const t=validateTask(await ports.readTask(ref),env,b.member_ref as string);
  if(!t)return null;
  return {a,b,t};
 };
 return Object.freeze({
  async inspect(eventRef:unknown,nowSec:unknown):Promise<R19Result>{
   if(typeof eventRef!=='string'||!ID.test(eventRef)||!safeInt(nowSec,1)||
    !safeInt(nowSec*1000))return result('blocked','INVALID_REF_OR_CLOCK');
   try{
    if(!validatePolicy(await ports.readPolicy(),pinnedRevision))
     return result('blocked','LEGAL_PROCESSING_OR_RETENTION_UNAPPROVED');
    const first=await observed(eventRef,nowSec*1000);
    if(!first)return result('blocked','OWNER_READBACK_MISSING_OR_DIVERGED');
    if(!validatePolicy(await ports.readPolicy(),pinnedRevision))
     return result('blocked','POLICY_DRIFT_BEFORE_SAGA');
    const saga=await ports.inspectExistingSaga(eventRef,nowSec);
    if(!validateSaga(saga))return result('retry','SAGA_COMMIT_UNVERIFIED_NO_ACK');
    const second=await observed(eventRef,nowSec*1000);
    if(!second||!equal(first.a,second.a,AUTH_FIELDS)||
      !equal(first.b,second.b,BILL_FIELDS)||
      !equal(first.t,second.t,TASK_FIELDS))
     return result('blocked','OWNER_SOURCE_OR_PITR_CHANGED_AFTER_LOCAL_SAGA');
    if(!validatePolicy(await ports.readPolicy(),pinnedRevision))
     return result('blocked','LEGAL_OR_POLICY_CHANGED_AFTER_SAGA');
    return result('local_consistent_review_only','OFFLINE_FOUR_DOMAIN_CONSISTENCY_NOT_AUTHORITY');
   }catch{return result('retry','OWNER_DB_OR_SAGA_UNAVAILABLE');}
  }
 });
}
