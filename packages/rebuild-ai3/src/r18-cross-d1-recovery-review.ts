/**
 * AI-3 R18 OFFLINE ONLY. Independently read Battery's *existing* R14 durable
 * inbox/wallet/journal/hold, current R15 Auth, a separate Task projection
 * and a hypothetical nonrollbackable witness. A projection is NOT proof.
 *
 * This function is strictly read-only. Even matching mock evidence can only
 * request human review, never ACK, settle Task, restore or regrant Battery.
 */
import {BATTERY_R16_RECEIPT_SQL,R16_CANDIDATE_SINGLE_PUBLISHER} from './r16-battery-publisher-receipt.ts';
import {VERIFIED_AUTH_OUTBOX_SQL} from './auth-deletion-battery-bridge.ts';
import type {StarryDeletionScope} from './auth-deletion-battery-consumer.ts';

export const LIVE_R18_BATTERY_RECOVERY_ENABLED=false as const;
export const R18_BATTERY_HOLDS_SQL=[
 'SELECT task_ref,member_ref,status FROM ai3_battery_hold',
 "WHERE brand_id='starry' AND member_ref=? ORDER BY task_ref"
].join(' ');
/** Fixture projection in a SEPARATE disposable Task SQLite DB, never a migration. */
export const R18_OFFLINE_TASK_SQL=[
 'SELECT task_ref,member_ref,environment,status FROM ai3_r18_offline_task_projection',
 'WHERE member_ref=? AND environment=? ORDER BY task_ref'
].join(' ');

export type R18ReadDb=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...params:(string|number)[])=>Readonly<{
  first:<T extends object>()=>Promise<T|null>;
  all:<T extends object>()=>Promise<T[]>;
 }>;
}>}>;
export type R18RecoveryResult=Readonly<{
 status:'blocked'|'review_only';reason:string;
 may_ack_queue:false;may_restore:false;may_regrant:false;
 may_settle_task:false;may_release_task:false;live:false;
}>;
const int=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const MEMBER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const TASK=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const RAW=['event_id','s_user_id','occurred_at','event_type'] as const;
const AUTH=[...RAW,'status','auth_version','deleted_at','unrevoked_sessions'] as const;
const RECEIPT=['event_id','member_ref','event_type','occurred_at_ms','policy_version',
 'applied','revoked','balance','wallet_version','journal_revision','kind','delta',
 'balance_after','reason_code','pending_holds'] as const;
const FLOOR=['event_id','member_ref','environment','occurred_at_ms','policy_version',
 'minimum_wallet_revision','revoked','recorded_at_ms','witness_revision'] as const;
const HOLD=['task_ref','member_ref','status'] as const;
const TASK_ROW=['task_ref','member_ref','environment','status'] as const;
const result=(status:R18RecoveryResult['status'],reason:string):R18RecoveryResult=>
 Object.freeze({status,reason,may_ack_queue:false,may_restore:false,
  may_regrant:false,may_settle_task:false,may_release_task:false,live:false});
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(v===null||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return null;
  const names=Reflect.ownKeys(v);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||d.enumerable!==true||!('value' in d))return null;
   out[k]=d.value;
  }
  return out;
 }catch{return null;}
}
function stableArrays(a:unknown,b:unknown):boolean{
 return JSON.stringify(a)===JSON.stringify(b);
}
export function createOfflineR18BatteryRecoveryReview(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionScope;
 publisher_id:typeof R16_CANDIDATE_SINGLE_PUBLISHER;
 publisher:Readonly<{readCommittedOriginal:(eventId:string,scope:StarryDeletionScope)=>Promise<unknown>}>;
 authDb:R18ReadDb;batteryDb:R18ReadDb;taskDb:R18ReadDb;
 /** Separate, test-only witness; NOT certified KMS/nonrollback evidence. */
 independentFloor:Readonly<{read:(scope:StarryDeletionScope,eventId:string)=>Promise<unknown>}>;
 lawfulPurposeNow:(scope:StarryDeletionScope)=>Promise<boolean>;
 lawfulRetentionNow:(scope:StarryDeletionScope)=>Promise<boolean>;
 approvedPolicyVersionNow:(scope:StarryDeletionScope)=>Promise<number|null>;
}>){
 const sc=exact(deps?.scope,['brand_id','environment']);
 if(!sc||sc.brand_id!=='starry'||
  (sc.environment!=='development'&&sc.environment!=='staging')||
  deps.publisher_id!==R16_CANDIDATE_SINGLE_PUBLISHER)
  throw Error('AI3_R18_SCOPE_OR_PUBLISHER_DENIED');
 if(!deps.publisher||typeof deps.publisher.readCommittedOriginal!=='function'||
  !deps.independentFloor||typeof deps.independentFloor.read!=='function'||
  !deps.authDb?.prepare||!deps.batteryDb?.prepare||!deps.taskDb?.prepare||
  typeof deps.lawfulPurposeNow!=='function'||
  typeof deps.lawfulRetentionNow!=='function'||
  typeof deps.approvedPolicyVersionNow!=='function')
  throw Error('AI3_R18_READ_ONLY_SERVER_PORTS_REQUIRED');
 const scope:StarryDeletionScope=Object.freeze({brand_id:'starry',
  environment:sc.environment as StarryDeletionScope['environment']});
 const enabled=deps.enabled===true;
 return Object.freeze({
  async assess(eventId:unknown,serverNowMs:unknown):Promise<R18RecoveryResult>{
   if(!enabled)return result('blocked','DISABLED');
   if(typeof eventId!=='string'||!ID.test(eventId)||!int(serverNowMs))
    return result('blocked','INVALID_OPAQUE_EVENT_OR_CLOCK');
   try{
    // Gate legal/retention BEFORE ANY member/Task/Wallet/Auth/floor read.
    if(await deps.lawfulPurposeNow(scope)!==true||
     await deps.lawfulRetentionNow(scope)!==true)
     return result('blocked','LAWFUL_PURPOSE_OR_RETENTION_NOT_APPROVED');
    const policy=await deps.approvedPolicyVersionNow(scope);
    if(!int(policy)||policy<1)return result('blocked','POLICY_NOT_APPROVED');
    const readSource=async()=>{
     const q=exact(await deps.publisher.readCommittedOriginal(eventId,scope),RAW);
     if(!q||q.event_id!==eventId||typeof q.s_user_id!=='string'||
      !MEMBER.test(q.s_user_id)||!int(q.occurred_at)||
      !Number.isSafeInteger(q.occurred_at*1000)||
      q.occurred_at*1000>(serverNowMs as number)||
      q.event_type!=='account_deleted')return null;
     return q;
    };
    const source=await readSource();
    if(!source)return result('blocked','AUTH_ORIGINAL_SOURCE_MISSING');
    const member=source.s_user_id as string;
    const occurred=source.occurred_at as number;
    const readAuth=async()=>{
     const q=exact(await deps.authDb.prepare(VERIFIED_AUTH_OUTBOX_SQL)
      .bind(eventId,member,occurred,scope.environment)
      .first<Record<string,unknown>>(),AUTH);
     return !!q&&RAW.every(k=>q[k]===source[k])&&q.status==='deleted'&&
      int(q.auth_version)&&q.auth_version>=2&&q.deleted_at===occurred&&
      q.unrevoked_sessions===0;
    };
    if(!await readAuth())return result('blocked','CURRENT_AUTH_DELETION_UNVERIFIED');
    const readReceipt=async()=>{
     const q=exact(await deps.batteryDb.prepare(BATTERY_R16_RECEIPT_SQL)
      .bind(scope.environment,eventId,member,occurred*1000)
      .first<Record<string,unknown>>(),RECEIPT);
     if(!q)return null;
     return q;
    };
    const validReceipt=(q:Record<string,unknown>|null):boolean=>!!q&&
     q.event_id===eventId&&q.member_ref===member&&
     q.event_type==='account_deleted'&&q.occurred_at_ms===occurred*1000&&
     q.policy_version===policy&&q.applied===1&&q.revoked===1&&q.balance===0&&
     int(q.wallet_version)&&q.wallet_version>0&&
     q.wallet_version===q.journal_revision&&q.kind==='revoke'&&
     Number.isSafeInteger(q.delta)&&q.balance_after===0&&
     q.reason_code==='ACCOUNT_DELETED'&&q.pending_holds===0;
    const receipt=await readReceipt();
    if(!validReceipt(receipt))
     return result('review_only','BATTERY_RECEIPT_MISSING_TRUNCATED_OR_STALE');
    const readFloor=async()=>{
     return exact(await deps.independentFloor.read(scope,eventId),FLOOR);
    };
    const floor=await readFloor();
    if(!floor)return result('review_only','INDEPENDENT_NONROLLBACK_WITNESS_MISSING');
    const validFloor=(f:Record<string,unknown>):boolean=>
     f.event_id===eventId&&f.member_ref===member&&
     f.environment===scope.environment&&f.occurred_at_ms===occurred*1000&&
     f.policy_version===policy&&f.revoked===1&&
     int(f.minimum_wallet_revision)&&f.minimum_wallet_revision>0&&
     int(f.witness_revision)&&f.witness_revision>0&&
     int(f.recorded_at_ms)&&f.recorded_at_ms>=occurred*1000&&
     f.recorded_at_ms<=(serverNowMs as number);
    if(!validFloor(floor))
     return result('blocked','EXTERNAL_FLOOR_SCOPE_OR_PROVENANCE_INVALID');
    if((floor.minimum_wallet_revision as number)>(receipt!.wallet_version as number))
     return result('review_only','PITR_WALLET_BELOW_INDEPENDENT_FLOOR');
    const readTasks=async()=>{
     const [holds,tasks]=await Promise.all([
      deps.batteryDb.prepare(R18_BATTERY_HOLDS_SQL).bind(member).all<Record<string,unknown>>(),
      deps.taskDb.prepare(R18_OFFLINE_TASK_SQL).bind(member,scope.environment)
       .all<Record<string,unknown>>()
     ]);
     if(!Array.isArray(holds)||!Array.isArray(tasks)||
      holds.length>500||tasks.length>500)return null;
     const hs=holds.map(x=>exact(x,HOLD)),ts=tasks.map(x=>exact(x,TASK_ROW));
     if(hs.some(x=>!x)||ts.some(x=>!x))return null;
     const ids=new Set<string>(),tids=new Set<string>();
     for(const h of hs){
      const row=h!;
      if(typeof row.task_ref!=='string'||!TASK.test(row.task_ref)||
       row.member_ref!==member||!['held','committed','released','expired','revoked'].includes(row.status as string)||
       ids.has(row.task_ref)){return null;}
      ids.add(row.task_ref);
     }
     for(const t of ts){
      const row=t!;
      if(typeof row.task_ref!=='string'||!TASK.test(row.task_ref)||
       row.member_ref!==member||row.environment!==scope.environment||
       !['committed','cancelled','pending'].includes(row.status as string)||
       tids.has(row.task_ref))return null;
      tids.add(row.task_ref);
     }
     return {hs,ts};
    };
    const states=await readTasks();
    if(!states)return result('blocked','TASK_WALLET_SOURCE_INVALID');
    const holdByTask=new Map(states.hs.map(h=>[h!.task_ref as string,h!] as const));
    const taskById=new Map(states.ts.map(t=>[t!.task_ref as string,t!] as const));
    for(const h of states.hs){
     if(h!.status==='held')return result('blocked','WALLET_HOLD_STILL_PENDING');
     if(!taskById.has(h!.task_ref as string))
      return result('blocked','TASK_EVIDENCE_MISSING_FOR_WALLET_HOLD');
    }
    for(const t of states.ts){
     const h=holdByTask.get(t!.task_ref as string);
     if(!h)return result('blocked','WALLET_HOLD_MISSING_FOR_TASK');
     if(t!.status==='pending')return result('blocked','TASK_NOT_FENCED_OR_FINAL');
     if(t!.status==='committed'&&h.status!=='committed')
      return result('blocked','TASK_COMMITTED_BEFORE_WALLET_SETTLED');
     if(t!.status==='cancelled'&&
      !['revoked','released','expired'].includes(h.status as string))
      return result('blocked','TASK_CANCEL_WALLET_CONFLICT');
    }
    const afterSource=await readSource();
    if(!afterSource||!RAW.every(k=>afterSource[k]===source[k])||!await readAuth())
     return result('blocked','AUTH_CHANGED_DURING_RECOVERY_REVIEW');
    const [afterReceipt,afterFloor,afterStates]=await Promise.all([
     readReceipt(),readFloor(),readTasks()
    ]);
    if(!validReceipt(afterReceipt)||!afterFloor||!validFloor(afterFloor)||
     !afterStates||!stableArrays(receipt,afterReceipt)||
     !stableArrays(floor,afterFloor)||!stableArrays(states,afterStates))
     return result('review_only','RECOVERY_EVIDENCE_CHANGED_OR_PITR_RACE');
    if(await deps.lawfulPurposeNow(scope)!==true||
     await deps.lawfulRetentionNow(scope)!==true||
     await deps.approvedPolicyVersionNow(scope)!==policy)
     return result('blocked','LAW_OR_POLICY_CHANGED_DURING_REVIEW');
    // Even a perfect mock witness is NOT approved real independent evidence.
    return result('review_only','OFFLINE_CONSISTENT_NOT_AUTHORIZED_FOR_RECOVERY');
   }catch{return result('blocked','AUTH_TASK_WALLET_OR_WITNESS_UNAVAILABLE');}
  }
 });
}
