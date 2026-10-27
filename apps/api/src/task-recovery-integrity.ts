/**
 * AI-4 R10. OFFLINE-only deep task reconciliation before AI-3 isolated
 * recovery review. Hash equality is integrity comparison, NOT authenticity:
 * protected independently anchored source and real D1/R2 verification remain
 * unimplemented production Gates. Never authorizes physical restore.
 */
import {assessIsolatedRestore} from '../../../packages/rebuild-ai3/src/recovery-guard.ts';
import type {RecoveryBundle,TrustedRecoveryPorts} from '../../../packages/rebuild-ai3/src/recovery-guard.ts';

export const LIVE_TASK_RECOVERY_ENABLED=false as const;
export const TASK_RECOVERY_SCHEMA='starry.task-recovery.v0-draft' as const;
export const MAX_REVIEW_TASKS=256 as const;
export type TaskReviewScope=Readonly<{
 brand_id:'starry';environment:'isolated-test';dataset:'battery'|'audit'|'appeals';
}>;
export type CommittedTaskRow=Readonly<{
 task_ref:string;member_ref:string;app_id:string;task_type:string;
 policy_version:number;rate_version:number;price:number;proof_revision:number;
 completed_ms:number;outcome:'succeeded'|'failed';
}>;
export type TaskReviewPorts=Readonly<{
 readCurrentCommittedTasks:(scope:TaskReviewScope)=>Promise<unknown>;
 readPitrCommittedTasks:(scope:TaskReviewScope)=>Promise<unknown>;
 readIndependentCommittedTasks:(scope:TaskReviewScope)=>Promise<unknown>;
 /** Must validate external protected, authorized, monotonically current anchor. */
 verifyProtectedTaskAnchor:(scope:TaskReviewScope,sha256:string,count:number)=>Promise<boolean>;
}>;
export type TaskReviewResult=Readonly<{
 disposition:'blocked'|'review_only';reason:string;may_restore:false;
}>;

const ROW=['task_ref','member_ref','app_id','task_type','policy_version','rate_version',
 'price','proof_revision','completed_ms','outcome'] as const;
const SCOPE=['brand_id','environment','dataset'] as const;
const PORT=['readCurrentCommittedTasks','readPitrCommittedTasks',
 'readIndependentCommittedTasks','verifyProtectedTaskAnchor'] as const;
const TASK_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const safeNumber=(n:unknown,min=0):n is number=>
 typeof n==='number'&&Number.isSafeInteger(n)&&n>=min;
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 if(v===null||typeof v!=='object')return null;
 try{
  if(Array.isArray(v))return null;
  const prototype=Object.getPrototypeOf(v);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const found=Reflect.ownKeys(v);
  if(found.length!==keys.length||found.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const prop=Object.getOwnPropertyDescriptor(v,k);
   if(!prop||prop.enumerable!==true||!Object.prototype.hasOwnProperty.call(prop,'value'))
    return null;
   out[k]=prop.value;
  }
  return out;
 }catch{return null;}
}
function normalizeScope(v:unknown):TaskReviewScope|null{
 const x=exact(v,SCOPE);
 if(!x||x.brand_id!=='starry'||x.environment!=='isolated-test'||
  !['battery','audit','appeals'].includes(String(x.dataset)))return null;
 return Object.freeze({brand_id:'starry',environment:'isolated-test',
  dataset:x.dataset as TaskReviewScope['dataset']});
}
function normalizeRows(input:unknown):CommittedTaskRow[]|null{
 try{
  if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||
   input.length>MAX_REVIEW_TASKS)return null;
  if(Reflect.ownKeys(input).length!==input.length+1)return null;
  const rows:CommittedTaskRow[]=[];
  const ids=new Set<string>();
  for(let i=0;i<input.length;i++){
   const d=Object.getOwnPropertyDescriptor(input,String(i));
   if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))return null;
   const r=exact(d.value,ROW);
   if(!r||!ROW.slice(0,4).every(k=>typeof r[k]==='string'&&TASK_ID.test(r[k]))||
    !safeNumber(r.policy_version,1)||!safeNumber(r.rate_version,1)||
    !safeNumber(r.price,1)||!safeNumber(r.proof_revision,1)||
    !safeNumber(r.completed_ms)||!['succeeded','failed'].includes(String(r.outcome))||
    ids.has(r.task_ref as string))return null;
   ids.add(r.task_ref as string);
   rows.push({
    task_ref:r.task_ref as string,member_ref:r.member_ref as string,
    app_id:r.app_id as string,task_type:r.task_type as string,
    policy_version:r.policy_version as number,rate_version:r.rate_version as number,
    price:r.price as number,proof_revision:r.proof_revision as number,
    completed_ms:r.completed_ms as number,outcome:r.outcome as 'succeeded'|'failed'
   });
  }
  rows.sort((a,b)=>a.task_ref<b.task_ref?-1:a.task_ref>b.task_ref?1:0);
  return rows;
 }catch{return null;}
}
const blocked=(reason:string):TaskReviewResult=>Object.freeze({
 disposition:'blocked' as const,reason,may_restore:false as const
});
const review=():TaskReviewResult=>Object.freeze({
 disposition:'review_only' as const,reason:'DEEP_TASK_RECONCILIATION_REVIEW_ONLY',
 may_restore:false as const
});
/** Length-prefixed, version- and scope-domain-separated canonical encoding. */
function encode(scope:TaskReviewScope,rows:readonly CommittedTaskRow[]):string{
 const fields=(values:readonly string[])=>values.map(v=>v.length+':'+v).join('|');
 const header=fields([TASK_RECOVERY_SCHEMA,scope.brand_id,scope.environment,scope.dataset,
  String(rows.length)]);
 const data=rows.map(r=>fields([
  r.task_ref,r.member_ref,r.app_id,r.task_type,String(r.policy_version),
  String(r.rate_version),String(r.price),String(r.proof_revision),
  String(r.completed_ms),r.outcome
 ]));
 return [header,...data].map(x=>x.length+':'+x).join('|');
}
async function digest(scope:TaskReviewScope,rows:readonly CommittedTaskRow[]):Promise<string>{
 const bytes=new TextEncoder().encode(encode(scope,rows));
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
/** Read and compare current, PITR, independent backup then external anchor. */
export function createOfflineTaskRecoveryReview(ports:TaskReviewPorts){
 const p=exact(ports,PORT);
 if(!p||PORT.some(k=>typeof p[k]!=='function'))
  throw Error('AI4_TASK_RECOVERY_PORT_DENIED');
 return Object.freeze({
  async review(scopeInput:unknown):Promise<TaskReviewResult>{
   const scope=normalizeScope(scopeInput);
   if(!scope)return blocked('INVALID_SCOPE');
   try{
    // Sequential, bounded, independently sourced reads; NEVER client input.
    const current=normalizeRows(await ports.readCurrentCommittedTasks(scope));
    const pitr=normalizeRows(await ports.readPitrCommittedTasks(scope));
    const independent=normalizeRows(await ports.readIndependentCommittedTasks(scope));
    if(!current||!pitr||!independent)return blocked('TASK_SOURCE_UNAVAILABLE_OR_INVALID');
    const d0=await digest(scope,current);
    if(d0!==await digest(scope,pitr)||d0!==await digest(scope,independent))
     return blocked('TASK_RECORD_DRIFT_OR_REPLAY');
    if(await ports.verifyProtectedTaskAnchor(scope,d0,current.length)!==true)
     return blocked('PROTECTED_ANCHOR_UNVERIFIED');
    return review();
   }catch{return blocked('TASK_AUTHORITY_UNAVAILABLE');}
  }
 });
}
/**
 * Combines deep task row equality with AI-3 seven high-watermarks and PITR,
 * independently protected backup, legal hold, operator step-up and durable
 * review receipt. Results NEVER authorize restore or mutate storage.
 */
export function createOfflineTaskBoundRecovery(
 taskPorts:TaskReviewPorts,restorePorts:TrustedRecoveryPorts
){
 const taskReview=createOfflineTaskRecoveryReview(taskPorts);
 return Object.freeze({
  async review(bundleInput:unknown,now:unknown):Promise<TaskReviewResult>{
   const b=exact(bundleInput,['scope','artifacts','request_ref','requested_ms']);
   if(!b||!safeNumber(now))return blocked('INVALID_RECOVERY_REQUEST');
   const task=await taskReview.review(b.scope);
   if(task.disposition!=='review_only')return task;
   try{
    const ai3=await assessIsolatedRestore(bundleInput,restorePorts,now);
    if(ai3.disposition!=='review_only'||ai3.may_restore!==false)
     return blocked('AI3_RECOVERY_GATE_BLOCKED_'+ai3.reason);
    return review();
   }catch{return blocked('AI3_RECOVERY_GATE_UNAVAILABLE');}
  }
 });
}
