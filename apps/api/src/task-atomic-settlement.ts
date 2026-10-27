/**
 * AI-4 R9: backend-only, OFFLINE transaction-bound Task -> free Battery planner.
 * NOT a live Worker handler or an authorization credential. Actual D1 transaction,
 * serializable cross-service proof, verified AI-1 principal and rate/X/Y approval
 * all remain Release Gate BLOCKED. No real Store, OAuth, D1 or Queue call here.
 */
import {finishTask,expireTask} from '../../../packages/rebuild-ai3/src/free-battery.ts';
import type {Wallet,Policy,Scope,TrustedAuthority} from '../../../packages/rebuild-ai3/src/free-battery.ts';
import {createOfflineServerTaskAuthority} from './task-evidence.ts';
export const ATOMIC_TASK_SETTLEMENT_LIVE=false as const;
export const ATOMIC_SETTLEMENT_DRAFT_VERSION='starry.task-settlement.v0-draft' as const;
export type MemberSnapshot=Readonly<{
 brand_id:'starry';member_ref:string;status:'active'|'suspended'|'deleted';
 auth_version:number;revision:number;
}>;
/** Supplied ONLY inside an authoritative server DB transaction (not JSON/HTTP). */
export type AtomicSnapshot=Readonly<{
 wallet:Wallet;policy:Policy;task:unknown;
 first_successful_task_ref:string|null;member:MemberSnapshot;
}>;
export type AtomicProposal=Readonly<{
 decision:'apply'|'deny'|'unchanged';
 wallet:Wallet|null;
 expected_wallet_revision:number|null;
 expected_task_revision:number|null;
 expected_policy_version:number|null;
}>;
export type AtomicReceipt=Readonly<{
 status:'committed'|'denied'|'unchanged';
 wallet_revision:number|null;
}>;
export type TaskAtomicTransactionPort=Readonly<{
 /**
  * MUST acquire a true single-writer/fenced transaction, read one consistent
  * snapshot, then verify all expected revisions/current Member before writing
  * the entire wallet + immutable ledger. Roll back on ANY exception.
  * Do NOT implement with separate D1 SELECT, Promise.all, KV or R2 writes.
  */
 transact:(scope:Scope,taskRef:string,at:number,
  evaluate:(snapshot:AtomicSnapshot)=>Promise<AtomicProposal>)=>Promise<AtomicReceipt>;
}>;
export type SettlementDecision=Readonly<{
 outcome:'committed'|'unchanged'|'blocked';
 wallet_revision:number|null;live:false;
}>;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SHAPE=['wallet','policy','task','first_successful_task_ref','member'] as const;
const MEMBER=['brand_id','member_ref','status','auth_version','revision'] as const;
const SCOPE=['brand_id','member_ref'] as const;
const PORT=['transact'] as const;
const own=(v:unknown,keys:readonly string[]):Record<string,unknown>|null=>{
 if(!v||typeof v!=='object')return null;
 try{
  if(Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const found=Reflect.ownKeys(v);
  if(found.length!==keys.length||found.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of keys){
   const d=Object.getOwnPropertyDescriptor(v,key);
   if(!d||d.enumerable!==true||!('value' in d))return null;
   result[key]=d.value;
  }
  return result;
 }catch{return null;}
};
const integer=(x:unknown,min=0):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min;
const id=(x:unknown):x is string=>typeof x==='string'&&ID.test(x);
const blocked=():SettlementDecision=>Object.freeze({outcome:'blocked' as const,
 wallet_revision:null,live:false as const});
const deny=():AtomicProposal=>Object.freeze({decision:'deny' as const,wallet:null,
 expected_wallet_revision:null,expected_task_revision:null,expected_policy_version:null});
function normalizedScope(v:unknown):Scope|null{
 const s=own(v,SCOPE);
 return s?.brand_id==='starry'&&id(s.member_ref)?Object.freeze({
  brand_id:'starry' as const,member_ref:s.member_ref}):null;
}
function validate(s:unknown,scope:Scope,taskRef:string):AtomicSnapshot|null{
 const x=own(s,SHAPE);
 if(!x||!x.wallet||!x.policy||!x.task||!x.member)return null;
 const m=own(x.member,MEMBER);
 const w=x.wallet as Wallet;
 const p=x.policy as Policy;
 const t=x.task as Record<string,unknown>;
 try {
  if(!m||m.brand_id!=='starry'||m.member_ref!==scope.member_ref||
   m.status!=='active'||!integer(m.auth_version,1)||!integer(m.revision,1)||
   !normalizedScope(w.scope)||w.scope.member_ref!==scope.member_ref||
   w.revoked!==false||!integer(w.revision)||
   p.brand_id!=='starry'||!integer(p.version,1)||
   !t||typeof t!=='object'||t.task_ref!==taskRef||
   !integer(t.proof_revision,1)||
   (x.first_successful_task_ref!==null&&!id(x.first_successful_task_ref)))return null;
  return x as unknown as AtomicSnapshot;
 }catch{return null;}
}
function proposal(wallet:Wallet,source:AtomicSnapshot):AtomicProposal{
 const t=source.task as {proof_revision:number};
 return Object.freeze({
  decision:'apply' as const,wallet,
  expected_wallet_revision:source.wallet.revision,
  expected_task_revision:t.proof_revision,
  expected_policy_version:source.policy.version
 });
}
/**
 * Only executed by an AI-4 trusted SERVER composition. This function NEVER
 * accepts user-supplied outcome/price/identity, NEVER writes by itself, and
 * NEVER returns a bearer proof or a release-ready entitlement.
 */
export function createOfflineAtomicTaskSettlement(port:TaskAtomicTransactionPort){
 const p=own(port,PORT);
 if(!p||typeof p.transact!=='function')throw Error('AI4_ATOMIC_PORT_REQUIRED');
 return Object.freeze({
  async settle(scopeInput:unknown,ref:unknown,serverNow:unknown):Promise<SettlementDecision>{
   const scope=normalizedScope(scopeInput);
   if(!scope||!id(ref)||!integer(serverNow))return blocked();
   let calls=0;
   let actual:AtomicProposal|null=null;
   try{
    const receipt=await port.transact(scope,ref,serverNow,async raw=>{
     // A misbehaving port cannot ask the same evaluation to write twice.
     calls++;
     if(calls!==1)return deny();
     const snapshot=validate(raw,scope,ref);
     if(!snapshot)return deny();
     const {wallet,policy,task,first_successful_task_ref}=snapshot;
     const taskValue=own(task,[
      'schema_version','brand_id','member_ref','task_ref','app_id','task_type',
      'policy_version','rate_version','price','request_state','proof_state',
      'proof_source','proof_revision','completed_at'
     ]);
     const source=createOfflineServerTaskAuthority({
      readTask:async()=>task,
      readPolicy:async()=>policy,
      readFirstSuccessfulTask:async()=>first_successful_task_ref
     });
     if(!await source.authorizePolicy(policy))return deny();
     const hold=wallet.holds.find(h=>h.task_ref===ref);
     if(!hold||hold.status==='revoked')return deny();
     if(hold.status!=='held'){
      const r:AtomicProposal=Object.freeze({decision:'unchanged' as const,wallet:null,
       expected_wallet_revision:wallet.revision,expected_task_revision:null,
       expected_policy_version:policy.version});
      actual=r;
      return r;
     }
     const a:TrustedAuthority={
      ...source,
      verifyMemberActive:async(s)=>s.brand_id==='starry'&&s.member_ref===scope.member_ref,
      // These actions are NEVER used by finishTask/expireTask.
      verifyRegistrationGrant:async()=>false,verifyAdminStepUp:async()=>false,
      verifyDeletion:async()=>false
     };
     let next:Wallet;
     if(serverNow>=hold.expires_at){
      next=await expireTask(wallet,policy,a,ref,serverNow);
     }else{
      if(!taskValue||
       (taskValue.request_state!=='succeeded'&&taskValue.request_state!=='failed'))
       return deny();
      const result=taskValue.request_state==='succeeded'?'success':'failure';
      if(!await source.verifyTaskOutcome(scope,ref,result))return deny();
      next=await finishTask(wallet,policy,a,ref,result,serverNow);
     }
     // A transaction MUST validate versions and CAS when applying this proposal.
     const q=proposal(next,snapshot);
     actual=q;
     return q;
    });
    if(calls!==1||actual===null)return blocked();
    const x=own(receipt,['status','wallet_revision']);
    if(!x)return blocked();
    if(actual.decision==='apply'&&x.status==='committed'&&
     x.wallet_revision===actual.wallet?.revision)return Object.freeze({
      outcome:'committed' as const,wallet_revision:x.wallet_revision as number,live:false as const});
    if(actual.decision==='unchanged'&&x.status==='unchanged'&&
     x.wallet_revision===actual.expected_wallet_revision)return Object.freeze({
      outcome:'unchanged' as const,wallet_revision:x.wallet_revision as number,live:false as const});
    return blocked();
   }catch{return blocked();}
  }
 });
}
