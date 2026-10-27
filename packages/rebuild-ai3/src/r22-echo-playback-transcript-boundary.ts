/**
 * AI-3 R22 Echo Starry (繁星回聲). OFFLINE ONLY.
 *
 * Legacy browser playback/CacheStorage/mediaSession events, transcript Worker
 * and AI QA completion are different namespaces. None can authorize Battery.
 * R19/R20 real read-only gates remain the only local candidate Wallet checks.
 */
import type {StarryDeletionScope} from './auth-deletion-battery-consumer.ts';
import type {R19ReadOnlySql} from './r19-task-wallet-receipt-gate.ts';
import {AI3_R19_AUTH_SQL,AI3_R19_TASK_SQL,AI3_R19_WALLET_SQL}
 from './r19-task-wallet-receipt-gate.ts';
import type {R20Decision} from './r20-task-wallet-source-binding.ts';

export const R22_ECHO_LIVE_ENABLED=false as const;
export const R22_ECHO_VERSION='starry.echo.task-battery-boundary.v0-offline' as const;
/** No client-supplied "task_committed" or legacy battery transaction. */
export const R22_ECHO_EVENTS=[
 'play','pause','seek','progress','ended','offline_download',
 'transcript_requested','transcript_job_completed',
 'qa_requested','qa_job_completed'
] as const;
export type R22EchoEvent=typeof R22_ECHO_EVENTS[number];
export type R22EchoState='playback_local_only'|'offline_cache_unverified'|
 'job_pending'|'task_unknown'|'wallet_receipt_mismatch'|'review_only'|'blocked';
export type R22EchoDTO=Readonly<{
 schema_version:typeof R22_ECHO_VERSION;kind:'offline_echo_boundary_only';
 event:R22EchoEvent;state:R22EchoState;evidence:'none'|'local_only';
 task_completed:false;wallet_settled:false;balance_verified:false;
 offline_file_verified:false;can_unlock:false;can_replay_charge:false;
 may_grant:false;may_settle:false;may_release:false;may_regrant:false;
 may_restore:false;may_ack_queue:false;may_publish:false;may_sell_battery:false;
 live:false;
}>;
export const R22_ECHO_JOB_SQL=[
 'SELECT brand_id,environment,member_ref,task_ref,source_event_ref,',
 'job_event_ref,event_type,status,attempt_no,policy_version,completed_at_ms',
 'FROM ai3_r22_echo_job_projection',
 'WHERE member_ref=? AND task_ref=? AND environment=?'
].join(' ');
type Job=Readonly<{brand_id:'starry';environment:'development'|'staging';
 member_ref:string;task_ref:string;source_event_ref:string;job_event_ref:string;
 event_type:'transcript_job_completed'|'qa_job_completed';status:'completed';
 attempt_no:1;policy_version:number;completed_at_ms:number}>;
const A=['member_ref','environment','status','auth_version','session_revoked','policy_version'];
const T=['task_ref','member_ref','environment','source_event_ref','status',
 'commit_attempt','completed_at_ms','policy_version'];
const W=['task_ref','member_ref','hold_status','created_ms','expires_ms',
 'hold_policy_version','rate_version','price','balance','wallet_version',
 'revoked','reserve_entries','commit_entries','commit_revision','commit_balance_after'];
const J=['brand_id','environment','member_ref','task_ref','source_event_ref',
 'job_event_ref','event_type','status','attempt_no','policy_version','completed_at_ms'];
const R=['status','reason','candidate','may_settle','may_release_task','may_ack_queue',
 'may_regrant','may_restore','may_publish','may_sell_battery','live'];
const C=['kind','brand_id','environment','member_ref','task_ref','source_event_ref',
 'task_attempt','policy_version','wallet_revision',
 'signed_source_approved','member_mapping_approved','independent_floor_approved'];
const IDENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const safe=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function exact(raw:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const proto=Object.getPrototypeOf(raw);
  if(proto!==Object.prototype&&proto!==null)return null;
  const names=Reflect.ownKeys(raw);
  if(names.length!==keys.length||names.some(x=>typeof x!=='string'||!keys.includes(x)))
   return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){const d=Object.getOwnPropertyDescriptor(raw,k);
   if(!d||!d.enumerable||!('value' in d))return null;out[k]=d.value;}
  return out;
 }catch{return null;}
}
const output=(event:R22EchoEvent,state:R22EchoState,evidence:'none'|'local_only'='none'):
 R22EchoDTO=>Object.freeze({schema_version:R22_ECHO_VERSION,
 kind:'offline_echo_boundary_only',event,state,evidence,task_completed:false,
 wallet_settled:false,balance_verified:false,offline_file_verified:false,
 can_unlock:false,can_replay_charge:false,may_grant:false,may_settle:false,
 may_release:false,may_regrant:false,may_restore:false,may_ack_queue:false,
 may_publish:false,may_sell_battery:false,live:false});
const local=new Set<R22EchoEvent>(['play','pause','seek','progress','ended','offline_download']);
const requested=new Set<R22EchoEvent>(['transcript_requested','qa_requested']);
const finished=new Set<R22EchoEvent>(['transcript_job_completed','qa_job_completed']);

/** Entire function remains PRIVATE/offline: no writes, Queue/transport, media fetch or native filesystem.
 * Job DB is an offline *unapproved* projection, not legacy Worker/AI authority.
 */
export function createOfflineR22EchoTaskBatteryBoundary(cfg:Readonly<{
 enabled?:boolean;scope:StarryDeletionScope;
 authDb:R19ReadOnlySql;taskDb:R19ReadOnlySql;batteryDb:R19ReadOnlySql;
 /** Inject original R20 real AI-3 review; cannot bypass law/witness denials. */
 taskWalletReview:Readonly<{inspect:(member:unknown,task:unknown,now:unknown)=>Promise<R20Decision>}>;
 lawfulPurposeNow:(scope:StarryDeletionScope)=>Promise<boolean>;
 lawfulRetentionNow:(scope:StarryDeletionScope)=>Promise<boolean>;
 approvedPolicyNow:(scope:StarryDeletionScope)=>Promise<number|null>;
}>){
 const raw=exact(cfg?.scope,['brand_id','environment']);
 if(!raw||raw.brand_id!=='starry'||
  !['development','staging'].includes(raw.environment as string))
  throw Error('AI3_R22_ECHO_SCOPE_DENIED');
 if(!cfg.authDb?.prepare||!cfg.taskDb?.prepare||!cfg.batteryDb?.prepare||
  typeof cfg.taskWalletReview?.inspect!=='function'||
  typeof cfg.lawfulPurposeNow!=='function'||
  typeof cfg.lawfulRetentionNow!=='function'||
  typeof cfg.approvedPolicyNow!=='function')
  throw Error('AI3_R22_ECHO_OFFLINE_READ_PORTS_REQUIRED');
 const scope:StarryDeletionScope=Object.freeze({brand_id:'starry',
  environment:raw.environment as StarryDeletionScope['environment']});
 const get=async(db:R19ReadOnlySql,sql:string,keys:readonly string[],args:string[])=>{
  const v=await db.prepare(sql).bind(...args).first<Record<string,unknown>>();
  if(v===null)return null;
  const e=exact(v,keys);
  if(!e)throw Error('MALFORMED_PRIVATE_RECEIPT');
  return e;
 };
 const legal=async()=>await cfg.lawfulPurposeNow(scope)===true&&
  await cfg.lawfulRetentionNow(scope)===true;
 return Object.freeze({
  async project(request:Readonly<{
   event:unknown;member_ref?:unknown;task_ref?:unknown;now_ms?:unknown;
  }>):Promise<R22EchoDTO>{
   const event=R22_ECHO_EVENTS.includes(request?.event as R22EchoEvent)
    ?request.event as R22EchoEvent:'progress';
   if(cfg.enabled!==true||!R22_ECHO_EVENTS.includes(request?.event as R22EchoEvent))
    return output(event,'blocked');
   // Browser Media Session / CacheStorage / 95% completed flag is NEVER
   // a Battery event. Absolutely no protected member/Task/Wallet reads.
   if(local.has(event))return output(event,event==='offline_download'?
    'offline_cache_unverified':'playback_local_only');
   if(requested.has(event))return output(event,'job_pending');
   if(!finished.has(event))return output(event,'blocked');
   const m=request.member_ref,t=request.task_ref,now=request.now_ms;
   if(typeof m!=='string'||!IDENT.test(m)||typeof t!=='string'||
    !IDENT.test(t)||!safe(now))return output(event,'blocked');
   try{
    if(!await legal())return output(event,'blocked');
    const policy=await cfg.approvedPolicyNow(scope);
    if(!safe(policy)||policy<1)return output(event,'blocked');
    const auth=()=>get(cfg.authDb,AI3_R19_AUTH_SQL,A,[m,scope.environment]);
    const task=()=>get(cfg.taskDb,AI3_R19_TASK_SQL,T,[t,m,scope.environment]);
    const wallet=()=>get(cfg.batteryDb,AI3_R19_WALLET_SQL,W,[m,t]);
    const job=()=>get(cfg.taskDb,R22_ECHO_JOB_SQL,J,[m,t,scope.environment]);
    const a=await auth();
    if(!a||a.member_ref!==m||a.environment!==scope.environment||
     a.status!=='active'||a.session_revoked!==0||
     !safe(a.auth_version)||a.auth_version===0||a.policy_version!==policy)
     return output(event,'blocked');
    const j=await job();
    if(!j)return output(event,'task_unknown');
    if(j.brand_id!=='starry'||j.environment!==scope.environment||
     j.member_ref!==m||j.task_ref!==t||j.event_type!==event||
     j.status!=='completed'||j.attempt_no!==1||
     j.policy_version!==policy||typeof j.source_event_ref!=='string'||
     !EVENT.test(j.source_event_ref)||typeof j.job_event_ref!=='string'||
     !EVENT.test(j.job_event_ref)||j.job_event_ref===j.source_event_ref||
     !safe(j.completed_at_ms)||j.completed_at_ms>now)
     return output(event,'blocked');
    const q=await task();
    if(!q)return output(event,'task_unknown');
    if(q.task_ref!==t||q.member_ref!==m||q.environment!==scope.environment||
     q.source_event_ref!==j.source_event_ref||
     q.status!=='committed'||q.commit_attempt!==1||
     q.policy_version!==policy||!safe(q.completed_at_ms)||
     q.completed_at_ms>now||q.completed_at_ms<j.completed_at_ms)
     return output(event,'wallet_receipt_mismatch');
    const w=await wallet();
    if(!w)return output(event,'wallet_receipt_mismatch');
    if(w.task_ref!==t||w.member_ref!==m||w.hold_policy_version!==policy||
     w.revoked!==0||w.hold_status!=='committed'||
     w.reserve_entries!==1||w.commit_entries!==1||
     !safe(w.wallet_version)||w.wallet_version===0||
     w.commit_revision!==w.wallet_version||
     w.commit_balance_after!==w.balance)
     return output(event,'wallet_receipt_mismatch');
    const check=async()=>{
     const r=exact(await cfg.taskWalletReview.inspect(m,t,now),R);
     if(!r||r.status!=='review_only'||
      R.slice(3).some(k=>r[k]!==false))return null;
     const c=exact(r.candidate,C);
     if(!c||c.kind!=='OFFLINE_UNVERIFIED_TASK_WALLET_MAPPING'||
      c.brand_id!=='starry'||c.environment!==scope.environment||
      c.member_ref!==m||c.task_ref!==t||
      c.source_event_ref!==j.source_event_ref||
      c.task_attempt!==1||c.policy_version!==policy||
      c.wallet_revision!==w.wallet_version||
      c.signed_source_approved!==false||
      c.member_mapping_approved!==false||
      c.independent_floor_approved!==false)return null;
     return c;
    };
    if(!await check())return output(event,'wallet_receipt_mismatch');
    const [a2,j2,q2,w2]=await Promise.all([auth(),job(),task(),wallet()]);
    if(!a2||!j2||!q2||!w2||
     JSON.stringify([a,j,q,w])!==JSON.stringify([a2,j2,q2,w2]))
     return output(event,'wallet_receipt_mismatch');
    if(!await check())return output(event,'wallet_receipt_mismatch');
    if(!await legal()||await cfg.approvedPolicyNow(scope)!==policy)
     return output(event,'blocked');
    // Local-only matching does NOT mean transcript/QA is entitled to spend.
    return output(event,'review_only','local_only');
   }catch{return output(event,'blocked');}
  }
 });
}
