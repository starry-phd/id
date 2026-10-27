/**
 * AI-4 R14: OFFLINE-ONLY authoritative Task-store transaction/outbox planner.
 * A real SQLite test adapter demonstrates SAME-DB atomic commit and rollback.
 * It is NOT a live Task issuer, a Worker/Queue route or cross-D1 atomicity.
 */
import {TASK_EVIDENCE_SCHEMA} from './task-evidence.ts';
import type {TaskEvidence} from './task-evidence.ts';
export const TASK_DURABLE_OUTBOX_LIVE=false as const;
export const TASK_OUTBOX_VERSION='starry.task-outbox.v0-draft' as const;
export type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
export type TaskCommitReceipt=Readonly<{
 outcome:'committed'|'duplicate'|'blocked';task_ref:string;proof_revision:number;
}>;
export type TaskOutboxRecord=Readonly<{
 task_ref:string;member_ref:string;proof_revision:number;
 request_state:'succeeded'|'failed';price:number;policy_version:number;
 rate_version:number;event_ref:string;
}>;
export type CommittedPair=Readonly<{task:TaskEvidence;outbox:TaskOutboxRecord}>;
export type TaskStorePort=Readonly<{
 /** Must use single Task DB transaction: CAS Task finalization + UNIQUE outbox. */
 commitTaskAndOutbox:(candidate:TaskEvidence,eventRef:string)=>Promise<unknown>;
 /** After-commit only, from the SAME authoritative Task database. */
 readCommittedPair:(ref:string)=>Promise<unknown>;
}>;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const TASK=['schema_version','brand_id','member_ref','task_ref','app_id',
 'task_type','policy_version','rate_version','price','request_state',
 'proof_state','proof_source','proof_revision','completed_at'] as const;
const OUT=['task_ref','member_ref','proof_revision','request_state','price',
 'policy_version','rate_version','event_ref'] as const;
const PORT=['commitTaskAndOutbox','readCommittedPair'] as const;
const ident=(x:unknown):x is string=>typeof x==='string'&&ID.test(x);
const num=(x:unknown,n=0):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=n;
function own(x:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return null;
  const keys=Reflect.ownKeys(x);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))
   return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of fields){
   const d=Object.getOwnPropertyDescriptor(x,k);
   if(!d||d.enumerable!==true||!('value' in d))return null;
   out[k]=d.value;
  }
  return out;
 }catch{return null;}
}
function task(v:unknown):TaskEvidence|null{
 const x=own(v,TASK);
 if(!x||x.schema_version!==TASK_EVIDENCE_SCHEMA||x.brand_id!=='starry'||
  !ident(x.member_ref)||!ident(x.task_ref)||!ident(x.app_id)||!ident(x.task_type)||
  !num(x.policy_version,1)||!num(x.rate_version,1)||!num(x.price,1)||
  !num(x.proof_revision,2)||!num(x.completed_at)||
  !['succeeded','failed'].includes(String(x.request_state))||
  x.proof_state!=='committed'||x.proof_source!=='server_task_engine')return null;
 return Object.freeze({...x}) as TaskEvidence;
}
function outbox(v:unknown):TaskOutboxRecord|null{
 const x=own(v,OUT);
 if(!x||!ident(x.task_ref)||!ident(x.member_ref)||!num(x.proof_revision,2)||
  !['succeeded','failed'].includes(String(x.request_state))||
  !num(x.price,1)||!num(x.policy_version,1)||!num(x.rate_version,1)||
  !ident(x.event_ref))return null;
 return Object.freeze({...x}) as TaskOutboxRecord;
}
function pair(v:unknown):CommittedPair|null{
 const x=own(v,['task','outbox']);
 const t=task(x?.task),o=outbox(x?.outbox);
 if(!t||!o)return null;
 if(t.task_ref!==o.task_ref||t.member_ref!==o.member_ref||
  t.proof_revision!==o.proof_revision||
  t.request_state!==o.request_state||t.price!==o.price||
  t.policy_version!==o.policy_version||t.rate_version!==o.rate_version)return null;
 return Object.freeze({task:t,outbox:o});
}
function equals(a:CommittedPair,b:CommittedPair):boolean{
 return TASK.every(k=>a.task[k]===b.task[k])&&
  OUT.every(k=>a.outbox[k]===b.outbox[k]);
}
const blocked=()=>Object.freeze({outcome:'blocked' as const,ack_safe:false as const,
 wallet_grant_allowed:false as const,live:false as const});
/** Readback MUST follow durable Task + outbox commit and match entire canonical tuple. */
export function createOfflineTaskTransactionalOutbox(scope:Scope,port:TaskStorePort){
 const s=own(scope,['brand_id','environment']),p=own(port,PORT);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(String(s.environment)))
  throw Error('AI4_R14_SCOPE_DENIED');
 if(!p||PORT.some(k=>typeof p[k]!=='function'))
  throw Error('AI4_R14_TRUSTED_DB_PORT_REQUIRED');
 return Object.freeze({
  async commit(raw:unknown,eventRef:unknown):
   Promise<Readonly<{outcome:'recorded_offline'|'unchanged_offline'|'blocked';
    ack_safe:false;wallet_grant_allowed:false;live:false}>>{
   const t=task(raw);
   if(!t||!ident(eventRef))return blocked();
   try{
    const receipt=own(await port.commitTaskAndOutbox(t,eventRef),
     ['outcome','task_ref','proof_revision']);
    if(!receipt||
     !['committed','duplicate'].includes(String(receipt.outcome))||
     receipt.task_ref!==t.task_ref||receipt.proof_revision!==t.proof_revision)
     return blocked();
    const first=pair(await port.readCommittedPair(t.task_ref));
    const second=pair(await port.readCommittedPair(t.task_ref));
    if(!first||!second||!equals(first,second)||first.outbox.event_ref!==eventRef||
     TASK.some(k=>first.task[k]!==t[k]))return blocked();
    return Object.freeze({
     outcome:receipt.outcome==='committed'?'recorded_offline':'unchanged_offline',
     ack_safe:false as const,wallet_grant_allowed:false as const,live:false as const
    });
   }catch{return blocked();}
  }
 });
}
