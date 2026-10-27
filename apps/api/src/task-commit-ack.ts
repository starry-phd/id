/**
 * AI-4 R11 OFFLINE-only Task -> free Battery delivery/ACK proof candidate.
 * Never a live Cloudflare queue handler, D1 transaction, Store or public SDK.
 * A source read + wallet read across different D1s CANNOT prove atomicity.
 */
import {TASK_EVIDENCE_SCHEMA} from './task-evidence.ts';
export const TASK_COMMIT_ACK_LIVE=false as const;
export const TASK_DELIVERY_PROTOCOL='starry.task-delivery.v0-draft' as const;
export type TaskRef=Readonly<{task_ref:string}>;
export type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
export type CommittedTask=Readonly<{
 schema_version:typeof TASK_EVIDENCE_SCHEMA;brand_id:'starry';member_ref:string;
 task_ref:string;app_id:string;task_type:string;policy_version:number;
 rate_version:number;price:number;request_state:'succeeded'|'failed';
 proof_state:'committed';proof_source:'server_task_engine';
 proof_revision:number;completed_at:number;
}>;
export type MemberState=Readonly<{
 brand_id:'starry';member_ref:string;status:'active'|'suspended'|'deleted';
 auth_version:number;revision:number;
}>;
export type BatteryPersisted=Readonly<{
 brand_id:'starry';member_ref:string;task_ref:string;task_proof_revision:number;
 policy_version:number;rate_version:number;price:number;
 result:'committed'|'released';wallet_revision:number;
 durable:true;
}>;
export type DeliveryMessage=Readonly<{
 body:unknown;attempts:number;ack:()=>void;retry:(options:{delaySeconds:number})=>void;
}>;
export type DeadLetterReceipt=Readonly<{
 task_ref:string;outcome:'durably_written'|'already_written';
}>;
export type DeliveryPorts=Readonly<{
 /** Must read from OFFICIAL task authority AFTER durable commit. */
 readCommittedTask:(ref:string)=>Promise<unknown>;
 /** AI-1 trusted backend current member/session, never supplied by a client. */
 readCurrentMember:(memberRef:string)=>Promise<unknown>;
 /** AI-3 single-DB CAS, unique journal, held TTL & policy validation. */
 settleBattery:(task:CommittedTask,member:MemberState)=>Promise<unknown>;
 /** Must read from AI-3 authoritative COMMITTED wallet/journal source. */
 readCommittedBattery:(ref:string)=>Promise<unknown>;
 /** Store same limited error metadata durably before terminal ACK. */
 persistDeadLetter:(ref:string,reason:'AUTHORITY_RETRY_EXHAUSTED',
  attempt:number)=>Promise<unknown>;
}>;
export type DeliveryOutcome='acked'|'retried'|'dead_letter_acked';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const taskKeys=['schema_version','brand_id','member_ref','task_ref','app_id','task_type',
 'policy_version','rate_version','price','request_state','proof_state',
 'proof_source','proof_revision','completed_at'] as const;
const memberKeys=['brand_id','member_ref','status','auth_version','revision'] as const;
const batteryKeys=['brand_id','member_ref','task_ref','task_proof_revision',
 'policy_version','rate_version','price','result','wallet_revision','durable'] as const;
const portKeys=['readCommittedTask','readCurrentMember','settleBattery',
 'readCommittedBattery','persistDeadLetter'] as const;
const num=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const id=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
function own(x:unknown,keys:readonly string[]):Record<string,unknown>|null {
 if(!x||typeof x!=='object')return null;
 try{
  if(Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const all=Reflect.ownKeys(x);
  if(all.length!==keys.length||all.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const r:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(x,k);
   if(!d||d.enumerable!==true||!('value' in d))return null;
   r[k]=d.value;
  }
  return r;
 }catch{return null;}
}
function task(v:unknown):CommittedTask|null {
 const t=own(v,taskKeys);
 if(!t||t.schema_version!==TASK_EVIDENCE_SCHEMA||t.brand_id!=='starry'||
  !id(t.member_ref)||!id(t.task_ref)||!id(t.app_id)||!id(t.task_type)||
  !num(t.policy_version,1)||!num(t.rate_version,1)||!num(t.price,1)||
  !num(t.proof_revision,1)||!num(t.completed_at)||
  !['succeeded','failed'].includes(String(t.request_state))||
  t.proof_state!=='committed'||t.proof_source!=='server_task_engine')return null;
 return Object.freeze({...t}) as CommittedTask;
}
function member(v:unknown):MemberState|null{
 const m=own(v,memberKeys);
 if(!m||m.brand_id!=='starry'||!id(m.member_ref)||m.status!=='active'||
  !num(m.auth_version,1)||!num(m.revision,1))return null;
 return Object.freeze({...m}) as MemberState;
}
function battery(v:unknown):BatteryPersisted|null{
 const b=own(v,batteryKeys);
 if(!b||b.brand_id!=='starry'||!id(b.member_ref)||!id(b.task_ref)||
  !num(b.task_proof_revision,1)||!num(b.policy_version,1)||
  !num(b.rate_version,1)||!num(b.price,1)||!num(b.wallet_revision,1)||
  !['committed','released'].includes(String(b.result))||b.durable!==true)
  return null;
 return Object.freeze({...b}) as BatteryPersisted;
}
function matches(t:CommittedTask,b:BatteryPersisted):boolean{
 return t.brand_id===b.brand_id&&t.member_ref===b.member_ref&&
  t.task_ref===b.task_ref&&t.proof_revision===b.task_proof_revision&&
  t.policy_version===b.policy_version&&t.rate_version===b.rate_version&&
  t.price===b.price&&b.result===(t.request_state==='succeeded'?'committed':'released');
}
function equalTask(a:CommittedTask,b:CommittedTask):boolean {
 return taskKeys.every(k=>a[k]===b[k]);
}
function equalMember(a:MemberState,b:MemberState):boolean{
 return memberKeys.every(k=>a[k]===b[k]);
}
/**
 * Queue-safe ONLY if trusted ports implement durable independent authority.
 * Client message contains ONLY opaque task_ref, never source success/amount.
 * Explicit retry on ALL failures; never return without retry/ACK.
 */
export function createOfflineCommittedTaskDelivery(scope:Scope,ports:DeliveryPorts) {
 const s=own(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||
  (s.environment!=='development'&&s.environment!=='staging'))
  throw Error('AI4_TASK_DELIVERY_SCOPE_DENIED');
 const p=own(ports,portKeys);
 if(!p||portKeys.some(k=>typeof p[k]!=='function'))
  throw Error('AI4_TASK_DELIVERY_PORT_DENIED');
 return Object.freeze({
  async dispatch(message:DeliveryMessage):Promise<DeliveryOutcome>{
   const retry=():DeliveryOutcome=>{
    // retry() failure must propagate: Cloudflare queue must NOT default-ACK.
    message.retry({delaySeconds:1});
    return 'retried';
   };
   let ref:string|null=null;
   try{
    const body=own(message.body,['task_ref']);
    if(body&&id(body.task_ref))ref=body.task_ref;
   }catch{/* malformed input -> retry */}
   if(!ref||!num(message.attempts,1))return retry();
   // Untrusted/failed source: no ACK; after bounded retries only durable DLQ.
   const fail=async():Promise<DeliveryOutcome>=>{
    if(message.attempts<5)return retry();
    try{
     const receipt=own(await ports.persistDeadLetter(ref,
      'AUTHORITY_RETRY_EXHAUSTED',message.attempts),['task_ref','outcome']);
     if(receipt&&receipt.task_ref===ref&&
      ['durably_written','already_written'].includes(String(receipt.outcome))){
      message.ack();return 'dead_letter_acked';
     }
    }catch{/* persist failure is NOT an ACK */}
    return retry();
   };
   try{
    const before=task(await ports.readCommittedTask(ref));
    if(!before||before.task_ref!==ref)return await fail();
    const auth=member(await ports.readCurrentMember(before.member_ref));
    if(!auth||auth.member_ref!==before.member_ref)return await fail();
    let stored=battery(await ports.readCommittedBattery(ref));
    if(stored&&!matches(before,stored))return await fail();
    if(!stored){
     // This is NOT a receipt. Only authoritative POST-COMMIT reader can allow ACK.
     await ports.settleBattery(before,auth);
    }
    const after=task(await ports.readCommittedTask(ref));
    const authAfter=member(await ports.readCurrentMember(before.member_ref));
    stored=battery(await ports.readCommittedBattery(ref));
    if(!after||!equalTask(before,after)||!authAfter||!equalMember(auth,authAfter)||
     !stored||!matches(after,stored))return await fail();
    message.ack();
    return 'acked';
   }catch{return await fail();}
  }
 });
}
