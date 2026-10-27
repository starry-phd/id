/** AI-3 R20: offline-only, fail-closed mapping of Task source to R19 Wallet receipt.
 * AI-1 account_deleted is NOT a Task commit event. P05/signature/floor absent.
 * No actual cross-D1 atomicity, live write, Task release or Queue ACK.
 */
import type {StarryDeletionScope} from './auth-deletion-battery-consumer.ts';
import type {R19Decision} from './r19-task-wallet-receipt-gate.ts';
export const LIVE_AI3_R20_SOURCE_MAPPING_ENABLED=false as const;
export const R20_DTO_KIND='OFFLINE_UNVERIFIED_TASK_WALLET_MAPPING' as const;
export type R20TaskSource=Readonly<{
 brand_id:'starry';environment:'development'|'staging';member_ref:string;
 task_ref:string;event_ref:string;event_type:'task_committed';
 auth_version:number;attempt_no:1;policy_version:number;committed_at_ms:number;
}>;
export type R20TaskReceipt=Readonly<{
 brand_id:'starry';environment:'development'|'staging';member_ref:string;
 task_ref:string;source_event_ref:string;status:'committed';
 attempt_no:1;policy_version:number;committed_at_ms:number;
}>;
export type R20Candidate=Readonly<{
 kind:typeof R20_DTO_KIND;brand_id:'starry';environment:'development'|'staging';
 member_ref:string;task_ref:string;source_event_ref:string;task_attempt:1;
 policy_version:number;wallet_revision:number;
 signed_source_approved:false;member_mapping_approved:false;independent_floor_approved:false;
}>;
export type R20Decision=Readonly<{
 status:'blocked'|'review_only';reason:string;candidate:R20Candidate|null;
 may_settle:false;may_release_task:false;may_ack_queue:false;may_regrant:false;
 may_restore:false;may_publish:false;may_sell_battery:false;live:false;
}>;
const SF=['brand_id','environment','member_ref','task_ref','event_ref','event_type',
 'auth_version','attempt_no','policy_version','committed_at_ms'];
const TF=['brand_id','environment','member_ref','task_ref','source_event_ref','status',
 'attempt_no','policy_version','committed_at_ms'];
const RF=['brand_id','environment','task_ref','source_event_ref',
 'policy_version','wallet_revision','task_attempt','kind'];
const DF=['status','reason','candidate_receipt','may_settle','may_release',
 'may_ack_queue','may_regrant','may_restore','may_sell_battery','live'];
const safe=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const IDENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return null;
  const names=Reflect.ownKeys(v);
  if(names.length!==keys.length||names.some(x=>typeof x!=='string'||!keys.includes(x)))
   return null;
  const q:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   q[k]=d.value;
  }return q;
 }catch{return null;}
}
const denied=(reason:string):R20Decision=>Object.freeze({
 status:'blocked',reason,candidate:null,may_settle:false,may_release_task:false,
 may_ack_queue:false,may_regrant:false,may_restore:false,may_publish:false,
 may_sell_battery:false,live:false
});
export function createOfflineR20TaskWalletBinding(cfg:Readonly<{
 enabled?:boolean;scope:StarryDeletionScope;
 /** Offline test candidate; NOT AI-1 signed/approved Task publisher. */
 source:Readonly<{readTaskSource:(member:string,task:string,
  scope:StarryDeletionScope)=>Promise<unknown>}>;
 /** Independent Task DB, read-only. */
 task:Readonly<{readTaskReceipt:(member:string,task:string,
  scope:StarryDeletionScope)=>Promise<unknown>}>;
 /** Existing genuine AI-3 R19 read-only Wallet/Hold/Journal review. */
 battery:Readonly<{inspect:(member:unknown,task:unknown,now:unknown)=>Promise<R19Decision>}>;
 legalNow:(s:StarryDeletionScope)=>Promise<boolean>;
 retentionNow:(s:StarryDeletionScope)=>Promise<boolean>;
 policyNow:(s:StarryDeletionScope)=>Promise<number|null>;
}>){
 const s=exact(cfg?.scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(s.environment as string))
  throw Error('AI3_R20_SCOPE_DENIED');
 if(typeof cfg.source?.readTaskSource!=='function'||
  typeof cfg.task?.readTaskReceipt!=='function'||
  typeof cfg.battery?.inspect!=='function'||typeof cfg.legalNow!=='function'||
  typeof cfg.retentionNow!=='function'||typeof cfg.policyNow!=='function')
  throw Error('AI3_R20_PRIVATE_READ_PORTS_REQUIRED');
 const scope:StarryDeletionScope=Object.freeze({brand_id:'starry',
  environment:s.environment as StarryDeletionScope['environment']});
 const legal=async()=>await cfg.legalNow(scope)===true&&
  await cfg.retentionNow(scope)===true;
 const source=async(m:string,t:string)=>exact(await cfg.source.readTaskSource(m,t,scope),SF);
 const task=async(m:string,t:string)=>exact(await cfg.task.readTaskReceipt(m,t,scope),TF);
 const battery=async(m:string,t:string,n:number)=>{
  const q=exact(await cfg.battery.inspect(m,t,n),DF);
  if(!q||q.status!=='review_only'||
   q.reason!=='OFFLINE_UNTRUSTED_RECEIPT_NOT_AUTHORIZED'||
   DF.slice(3).some(k=>q[k]!==false))return null;
  const v=exact(q.candidate_receipt,RF);
  return v&&v.kind==='OFFLINE_UNTRUSTED_LOCAL_RECEIPT'?v:null;
 };
 return Object.freeze({
  async inspect(member:unknown,ref:unknown,now:unknown):Promise<R20Decision>{
   if(cfg.enabled!==true)return denied('DISABLED');
   if(typeof member!=='string'||!IDENT.test(member)||typeof ref!=='string'||
    !IDENT.test(ref)||!safe(now))return denied('INVALID_REF_OR_TIME');
   try{
    if(!await legal())return denied('LAWFUL_PURPOSE_OR_RETENTION_MISSING');
    const policy=await cfg.policyNow(scope);
    if(!safe(policy)||policy<1)return denied('APPROVED_POLICY_UNAVAILABLE');
    const a=await source(member,ref);
    if(!a||a.brand_id!=='starry'||a.environment!==scope.environment||
     a.member_ref!==member||a.task_ref!==ref||
     a.event_type!=='task_committed'||typeof a.event_ref!=='string'||
     !EVENT.test(a.event_ref)||!safe(a.auth_version)||a.auth_version<1||
     a.attempt_no!==1||a.policy_version!==policy||
     !safe(a.committed_at_ms)||a.committed_at_ms>now)
     return denied('TASK_SOURCE_UNAPPROVED_OR_WRONG_EVENT_NAMESPACE');
    const t=await task(member,ref);
    if(!t||t.brand_id!=='starry'||t.environment!==scope.environment||
     t.member_ref!==member||t.task_ref!==ref||t.status!=='committed'||
     t.source_event_ref!==a.event_ref||t.attempt_no!==1||
     t.policy_version!==policy||t.committed_at_ms!==a.committed_at_ms)
     return denied('TASK_SOURCE_SINK_MAPPING_MISMATCH');
    const w=await battery(member,ref,now);
    if(!w||w.brand_id!=='starry'||w.environment!==scope.environment||
     w.task_ref!==ref||w.source_event_ref!==a.event_ref||
     w.policy_version!==policy||w.task_attempt!==1||
     !safe(w.wallet_revision)||w.wallet_revision===0)
     return denied('BATTERY_SOURCE_OR_REVISION_UNVERIFIED');
    const a2=await source(member,ref),t2=await task(member,ref);
    if(!a2||!t2||JSON.stringify(a2)!==JSON.stringify(a)||
     JSON.stringify(t2)!==JSON.stringify(t))
     return denied('SOURCE_OR_TASK_CHANGED_DURING_REPLAY');
    const w2=await battery(member,ref,now);
    if(!w2||JSON.stringify(w)!==JSON.stringify(w2))
     return denied('BATTERY_WALLET_CHANGED_OR_PITR');
    if(!await legal()||await cfg.policyNow(scope)!==policy)
     return denied('LAW_OR_POLICY_CHANGED_DURING_MAPPING');
    const candidate:R20Candidate=Object.freeze({
     kind:R20_DTO_KIND,brand_id:'starry',environment:scope.environment,
     member_ref:member,task_ref:ref,source_event_ref:a.event_ref as string,
     task_attempt:1,policy_version:policy,wallet_revision:w.wallet_revision as number,
     signed_source_approved:false,member_mapping_approved:false,
     independent_floor_approved:false
    });
    return Object.freeze({...denied('LOCAL_MAPPING_NOT_AUTHORIZED'),
     status:'review_only' as const,candidate});
   }catch{return denied('AUTH_TASK_WALLET_UNAVAILABLE');}
  }
 });
}
