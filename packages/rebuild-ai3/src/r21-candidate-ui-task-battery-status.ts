/**
 * R21 Starry Battery/Task CANDIDATE APP UI STATUS only (offline, no public route).
 * R19 wallet/journal and R20 source mapping keep domain authority. This module
 * never asserts Task completed, a settled charge, spendable balance, or live UX.
 * No member/event/task IDs or balance/rate numbers leave the PRIVATE UI DTO.
 */
import type {StarryDeletionScope} from './auth-deletion-battery-consumer.ts';
import {AI3_R19_AUTH_SQL,AI3_R19_TASK_SQL,AI3_R19_WALLET_SQL} from './r19-task-wallet-receipt-gate.ts';
import type {R19ReadOnlySql} from './r19-task-wallet-receipt-gate.ts';
import type {R20Decision} from './r20-task-wallet-source-binding.ts';
export const LIVE_AI3_R21_CANDIDATE_UI_ENABLED=false as const;
export const AI3_R21_UI_VERSION='starry.candidate.task-battery-status.v1' as const;
export const AI3_R21_UI_SCREENS=['TASK_REVIEW','TASK_STATUS','TASK_RESULT','BATTERY_LEDGER'] as const;
export type R21Screen=typeof AI3_R21_UI_SCREENS[number];
export type R21Status=
 'rate_not_approved'|'balance_unverified'|'hold_pending'|'task_unknown'|
 'task_failed'|'receipt_mismatch'|'blocked'|'review_only'|'unconfirmed_balance';
/** Only publicly presentable *candidate* UI state, not a live or official App result. */
export type R21CandidateUiDTO=Readonly<{
 schema_version:typeof AI3_R21_UI_VERSION;kind:'offline_candidate_ui_only';
 screen:R21Screen;state:R21Status;message_key:R21Status;
 balance_display:null;rate_display:null;task_completed:false;
 wallet_settled:false;status_authoritative:false;
 can_submit:false;can_retry:false;may_settle:false;may_release:false;
 may_regrant:false;may_restore:false;may_ack_queue:false;may_sell_battery:false;
 live:false;
}>;
const AUTH=['member_ref','environment','status','auth_version','session_revoked','policy_version'];
const TASK=['task_ref','member_ref','environment','source_event_ref','status',
 'commit_attempt','completed_at_ms','policy_version'];
const WALLET=['task_ref','member_ref','hold_status','created_ms','expires_ms',
 'hold_policy_version','rate_version','price','balance','wallet_version','revoked',
 'reserve_entries','commit_entries','commit_revision','commit_balance_after'];
const R20=['status','reason','candidate','may_settle','may_release_task',
 'may_ack_queue','may_regrant','may_restore','may_publish','may_sell_battery','live'];
const CANDIDATE=['kind','brand_id','environment','member_ref','task_ref',
 'source_event_ref','task_attempt','policy_version','wallet_revision',
 'signed_source_approved','member_mapping_approved','independent_floor_approved'];
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const safe=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const normal=(raw:unknown,keys:readonly string[]):Record<string,unknown>|null=>{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  const names=Reflect.ownKeys(raw);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const descriptor=Object.getOwnPropertyDescriptor(raw,k);
   if(!descriptor||!descriptor.enumerable||!('value' in descriptor))return null;
   result[k]=descriptor.value;
  }
  return result;
 }catch{return null;}
};
const dto=(screen:R21Screen,state:R21Status):R21CandidateUiDTO=>Object.freeze({
 schema_version:AI3_R21_UI_VERSION,kind:'offline_candidate_ui_only',
 screen,state,message_key:state,balance_display:null,rate_display:null,
 task_completed:false,wallet_settled:false,status_authoritative:false,
 can_submit:false,can_retry:false,may_settle:false,may_release:false,
 may_regrant:false,may_restore:false,may_ack_queue:false,may_sell_battery:false,
 live:false
});
/** No writes, no network, no client secrets, no approved commercial Battery SKU. */
export function createOfflineR21CandidateTaskBatteryStatus(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionScope;
 authDb:R19ReadOnlySql;taskDb:R19ReadOnlySql;batteryDb:R19ReadOnlySql;
 /** Existing R20 source/Task/R19 Battery review; not a signed real publisher. */
 mapping:Readonly<{inspect:(memberRef:unknown,taskRef:unknown,nowMs:unknown)=>Promise<R20Decision>}>;
 lawfulPurposeNow:(s:StarryDeletionScope)=>Promise<boolean>;
 lawfulRetentionNow:(s:StarryDeletionScope)=>Promise<boolean>;
 approvedPolicyVersionNow:(s:StarryDeletionScope)=>Promise<number|null>;
 approvedFreeBatteryRateNow:(s:StarryDeletionScope)=>Promise<boolean>;
}>){
 const s=normal(deps?.scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(s.environment as string))
  throw Error('AI3_R21_SCOPE_DENIED');
 if(!deps.authDb?.prepare||!deps.taskDb?.prepare||!deps.batteryDb?.prepare||
  typeof deps.mapping?.inspect!=='function'||typeof deps.lawfulPurposeNow!=='function'||
  typeof deps.lawfulRetentionNow!=='function'||
  typeof deps.approvedPolicyVersionNow!=='function'||
  typeof deps.approvedFreeBatteryRateNow!=='function')
  throw Error('AI3_R21_READ_ONLY_SERVER_PORTS_REQUIRED');
 const scope:StarryDeletionScope=Object.freeze({brand_id:'starry',
  environment:s.environment as StarryDeletionScope['environment']});
 const read=async(db:R19ReadOnlySql,sql:string,cols:readonly string[],...params:string[])=>{
  const row=await db.prepare(sql).bind(...params).first<Record<string,unknown>>();
  if(row===null)return null; // Only a genuinely absent row is unknown.
  const parsed=normal(row,cols);
  if(!parsed)throw Error('AI3_R21_MALFORMED_PROJECTION_DENIED');
  return parsed; // Forged columns/getters are blocked, never mislabelled missing.
 };
 const gate=async()=>await deps.lawfulPurposeNow(scope)===true&&
  await deps.lawfulRetentionNow(scope)===true;
 return Object.freeze({
  async project(member:unknown,task:unknown,screen:unknown,now:unknown):Promise<R21CandidateUiDTO>{
   // Error paths never incorporate untrusted identifiers, counts, timings or DB values.
   const view=AI3_R21_UI_SCREENS.includes(screen as R21Screen)
    ?screen as R21Screen:'TASK_STATUS';
   if(deps.enabled!==true||!AI3_R21_UI_SCREENS.includes(screen as R21Screen)||
    typeof member!=='string'||!SAFE_ID.test(member)||
    typeof task!=='string'||!SAFE_ID.test(task)||!safe(now))
    return dto(view,'blocked');
   try{
    if(!await gate())return dto(view,'blocked');
    const policy=await deps.approvedPolicyVersionNow(scope);
    if(!safe(policy)||policy<1)return dto(view,'blocked');
    // Free Battery rate is not Store pricing. No approved rate => no numeric rate.
    if(await deps.approvedFreeBatteryRateNow(scope)!==true)
     return dto(view,'rate_not_approved');
    const auth=()=>read(deps.authDb,AI3_R19_AUTH_SQL,AUTH,member,scope.environment);
    const taskRow=()=>read(deps.taskDb,AI3_R19_TASK_SQL,TASK,task,member,scope.environment);
    const wallet=()=>read(deps.batteryDb,AI3_R19_WALLET_SQL,WALLET,member,task);
    const a=await auth();
    if(!a||a.member_ref!==member||a.environment!==scope.environment||
     a.status!=='active'||a.session_revoked!==0||
     !safe(a.auth_version)||a.auth_version===0||a.policy_version!==policy)
     return dto(view,'blocked');
    const t=await taskRow();
    if(!t)return dto(view,'task_unknown');
    if(t.task_ref!==task||t.member_ref!==member||
     t.environment!==scope.environment||t.policy_version!==policy||
     !['pending','committed','cancelled'].includes(t.status as string)||
     !safe(t.commit_attempt)||t.commit_attempt!==1)
     return dto(view,'blocked');
    const w=await wallet();
    if(!w)return dto(view,t.status==='committed'?'receipt_mismatch':'balance_unverified');
    if(w.task_ref!==task||w.member_ref!==member||w.hold_policy_version!==policy||
     w.revoked!==0||!safe(w.wallet_version)||w.wallet_version===0||
     !Number.isSafeInteger(w.balance)||!safe(w.price)||w.price===0||
     !safe(w.rate_version)||w.rate_version===0||!safe(w.created_ms)||
     !safe(w.expires_ms)||w.expires_ms!==w.created_ms+180000)
     return dto(view,'blocked');
    if(t.status==='pending'){
     // Never confuse an unfinished reserve with a completed task.
     if(w.hold_status==='held')return dto(view,'hold_pending');
     return dto(view,'task_unknown');
    }
    if(t.status==='cancelled'){
     if(['released','expired','revoked'].includes(w.hold_status as string))
      return dto(view,'task_failed');
     return dto(view,'receipt_mismatch');
    }
    // Task's own source event does not authorize a charge.
    if(t.status!=='committed'||w.hold_status!=='committed'||
     w.reserve_entries!==1||w.commit_entries!==1||
     w.commit_revision!==w.wallet_version||w.commit_balance_after!==w.balance)
     return dto(view,'receipt_mismatch');
    const local=normal(await deps.mapping.inspect(member,task,now),R20);
    if(!local||!['blocked','review_only'].includes(local.status as string)||
     R20.slice(3).some(k=>local[k]!==false))
     return dto(view,'receipt_mismatch');
    if(local.status!=='review_only')return dto(view,'receipt_mismatch');
    const c=normal(local.candidate,CANDIDATE);
    if(!c||c.kind!=='OFFLINE_UNVERIFIED_TASK_WALLET_MAPPING'||
     c.brand_id!=='starry'||c.environment!==scope.environment||
     c.member_ref!==member||c.task_ref!==task||
     c.source_event_ref!==t.source_event_ref||c.task_attempt!==1||
     c.wallet_revision!==w.wallet_version||c.policy_version!==policy||
     c.signed_source_approved!==false||
     c.member_mapping_approved!==false||c.independent_floor_approved!==false)
     return dto(view,'receipt_mismatch');
    // Defensive second independent readback. Must never authorize a *final* UI.
    const [a2,t2,w2]=await Promise.all([auth(),taskRow(),wallet()]);
    if(!a2||!t2||!w2||JSON.stringify(a2)!==JSON.stringify(a)||
     JSON.stringify(t2)!==JSON.stringify(t)||JSON.stringify(w2)!==JSON.stringify(w))
     return dto(view,'receipt_mismatch');
    if(!await gate()||await deps.approvedPolicyVersionNow(scope)!==policy||
     await deps.approvedFreeBatteryRateNow(scope)!==true)
     return dto(view,'blocked');
    // Consistent disposable SQLite/MOCK receipts do not certify balances or Task success.
    return dto(view,view==='BATTERY_LEDGER'?'unconfirmed_balance':'review_only');
   }catch{return dto(view,'blocked');}
  }
 });
}
