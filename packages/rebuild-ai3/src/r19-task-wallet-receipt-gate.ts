/**
 * AI-3 R19 — Starry FREE Battery / Task settlement, offline read-only port.
 * Auth / Task / Battery are separate authorities: their snapshots cannot
 * grant cross-D1 atomicity. No live write, ACK, regrant, restore or payment.
 * This is not a replacement for R18 deletion/recovery review.
 */
import type {StarryDeletionScope} from './auth-deletion-battery-consumer.ts';
export const LIVE_AI3_R19_TASK_SETTLEMENT_ENABLED=false as const;
export const AI3_R19_AUTH_SQL=[
 'SELECT member_ref,environment,status,auth_version,session_revoked,policy_version',
 'FROM ai3_r19_test_auth_projection WHERE member_ref=? AND environment=?'
].join(' ');
export const AI3_R19_TASK_SQL=[
 'SELECT task_ref,member_ref,environment,source_event_ref,status,commit_attempt,',
 'completed_at_ms,policy_version FROM ai3_r19_test_task_projection',
 'WHERE task_ref=? AND member_ref=? AND environment=?'
].join(' ');
/** Uses REAL existing R7 Battery schema in a different disposable SQLite DB. */
export const AI3_R19_WALLET_SQL=[
 'SELECT h.task_ref,h.member_ref,h.status AS hold_status,h.created_ms,h.expires_ms,',
 'h.policy_version AS hold_policy_version,h.rate_version,h.price,',
 'w.balance,w.version AS wallet_version,w.revoked,',
 '(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id',
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='reserve') AS reserve_entries,",
 '(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id',
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_entries,",
 '(SELECT MAX(j.revision) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id',
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_revision,",
 '(SELECT MAX(j.balance_after) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id',
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_balance_after",
 'FROM ai3_battery_hold h JOIN ai3_battery_wallet w',
 "ON w.brand_id=h.brand_id AND w.member_ref=h.member_ref WHERE h.brand_id='starry'",
 'AND h.member_ref=? AND h.task_ref=?'
].join(' ');
export type R19ReadOnlySql=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...a:string[])=>Readonly<{first:<T extends object>()=>Promise<T|null>}>;
}>}>;
export type R19TaskReceiptCandidate=Readonly<{
 brand_id:'starry';environment:'development'|'staging';task_ref:string;
 source_event_ref:string;policy_version:number;wallet_revision:number;
 task_attempt:1;kind:'OFFLINE_UNTRUSTED_LOCAL_RECEIPT';
}>;
export type R19Decision=Readonly<{
 status:'blocked'|'review_only';reason:string;candidate_receipt:R19TaskReceiptCandidate|null;
 may_settle:false;may_release:false;may_ack_queue:false;may_regrant:false;
 may_restore:false;may_sell_battery:false;live:false;
}>;
const AUTH=['member_ref','environment','status','auth_version','session_revoked','policy_version'] as const;
const TASK=['task_ref','member_ref','environment','source_event_ref','status',
 'commit_attempt','completed_at_ms','policy_version'] as const;
const WALLET=['task_ref','member_ref','hold_status','created_ms','expires_ms',
 'hold_policy_version','rate_version','price','balance','wallet_version','revoked',
 'reserve_entries','commit_entries','commit_revision','commit_balance_after'] as const;
const PROOF=['source_event_ref','member_ref','environment','auth_version',
 'policy_version','observed_at_ms','witness_revision'] as const;
const FLOOR=['task_ref','member_ref','environment','minimum_wallet_revision',
 'policy_version','witness_revision'] as const;
const ident=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const event=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const integer=(v:unknown):v is number=>typeof v==='number'&&
 Number.isSafeInteger(v)&&v>=0;
function exact(raw:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  if(Reflect.ownKeys(raw).length!==fields.length)return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of fields){
   const d=Object.getOwnPropertyDescriptor(raw,key);
   if(!d||!d.enumerable||!('value' in d))return null;
   out[key]=d.value;
  }
  return out;
 }catch{return null;}
}
const deny=(reason:string):R19Decision=>Object.freeze({status:'blocked',reason,
 candidate_receipt:null,may_settle:false,may_release:false,may_ack_queue:false,
 may_regrant:false,may_restore:false,may_sell_battery:false,live:false});
const review=(candidate:R19TaskReceiptCandidate):R19Decision=>Object.freeze({
 status:'review_only',reason:'OFFLINE_UNTRUSTED_RECEIPT_NOT_AUTHORIZED',
 candidate_receipt:Object.freeze(candidate),may_settle:false,may_release:false,
 may_ack_queue:false,may_regrant:false,may_restore:false,may_sell_battery:false,live:false
});
/**
 * All ports supplied from private server tests only. The Auth projection and
 * alleged independent provenance/floor are NOT AI-1 signed KMS evidence.
 * Even valid mocks NEVER authorize a settlement, ACK or Task release.
 */
export function createOfflineR19TaskWalletReview(cfg:Readonly<{
 enabled?:boolean;scope:StarryDeletionScope;
 authDb:R19ReadOnlySql;taskDb:R19ReadOnlySql;batteryDb:R19ReadOnlySql;
 provenance:Readonly<{readCandidate:(eventRef:string,s:StarryDeletionScope)=>Promise<unknown>}>;
 floor:Readonly<{readCandidate:(taskRef:string,s:StarryDeletionScope)=>Promise<unknown>}>;
 lawfulPurposeNow:(s:StarryDeletionScope)=>Promise<boolean>;
 lawfulRetentionNow:(s:StarryDeletionScope)=>Promise<boolean>;
 approvedPolicyVersionNow:(s:StarryDeletionScope)=>Promise<number|null>;
}>){
 const s=exact(cfg?.scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||
  (s.environment!=='development'&&s.environment!=='staging'))
  throw Error('AI3_R19_SCOPE_DENIED');
 if(!cfg.authDb?.prepare||!cfg.taskDb?.prepare||!cfg.batteryDb?.prepare||
  typeof cfg.provenance?.readCandidate!=='function'||
  typeof cfg.floor?.readCandidate!=='function'||
  typeof cfg.lawfulPurposeNow!=='function'||typeof cfg.lawfulRetentionNow!=='function'||
  typeof cfg.approvedPolicyVersionNow!=='function')
  throw Error('AI3_R19_TRUSTED_READ_PORTS_REQUIRED');
 const scope:StarryDeletionScope=Object.freeze({brand_id:'starry',
  environment:s.environment as StarryDeletionScope['environment']});
 const read=async(db:R19ReadOnlySql,sql:string,fields:readonly string[],...args:string[])=>
  exact(await db.prepare(sql).bind(...args).first<Record<string,unknown>>(),fields);
 const enabled=cfg.enabled===true;
 return Object.freeze({
  async inspect(memberRef:unknown,taskRef:unknown,serverNowMs:unknown):Promise<R19Decision>{
   if(!enabled)return deny('DISABLED');
   if(typeof memberRef!=='string'||!ident.test(memberRef)||
    typeof taskRef!=='string'||!ident.test(taskRef)||!integer(serverNowMs))
    return deny('INVALID_LOCATOR_OR_CLOCK');
   const now=serverNowMs;
   try{
    if(await cfg.lawfulPurposeNow(scope)!==true||
     await cfg.lawfulRetentionNow(scope)!==true)
     return deny('LAWFUL_PURPOSE_OR_RETENTION_MISSING');
    const policy=await cfg.approvedPolicyVersionNow(scope);
    if(!integer(policy)||policy<1)return deny('CURRENT_POLICY_NOT_APPROVED');
    const getAuth=()=>read(cfg.authDb,AI3_R19_AUTH_SQL,AUTH,memberRef,scope.environment);
    const getTask=()=>read(cfg.taskDb,AI3_R19_TASK_SQL,TASK,taskRef,memberRef,scope.environment);
    const getWallet=()=>read(cfg.batteryDb,AI3_R19_WALLET_SQL,WALLET,memberRef,taskRef);
    const a=await getAuth();
    if(!a||a.member_ref!==memberRef||a.environment!==scope.environment||
     a.status!=='active'||a.session_revoked!==0||
     !integer(a.auth_version)||a.auth_version===0||a.policy_version!==policy)
     return deny('AUTH_NOT_CURRENT_OR_MEMBER_REVOKED');
    const t=await getTask();
    if(!t||t.task_ref!==taskRef||t.member_ref!==memberRef||
     t.environment!==scope.environment||
     typeof t.source_event_ref!=='string'||!event.test(t.source_event_ref)||
     t.policy_version!==policy||!integer(t.completed_at_ms)||
     t.completed_at_ms>now||!integer(t.commit_attempt)||t.commit_attempt!==1)
     return deny('TASK_SOURCE_NOT_DURABLE_OR_DUPLICATE');
    if(t.status!=='committed')return deny('TASK_NOT_COMMITTED');
    // Same member must still be current AFTER Task observation.
    if(JSON.stringify(a)!==JSON.stringify(await getAuth()))
     return deny('AUTH_REVOKED_BETWEEN_CHECKS');
    const w=await getWallet();
    if(!w||w.task_ref!==taskRef||w.member_ref!==memberRef||
     w.hold_policy_version!==policy||!integer(w.created_ms)||
     !integer(w.expires_ms)||w.expires_ms!==w.created_ms+180000||
     !integer(w.price)||w.price===0||!integer(w.rate_version)||
     w.rate_version===0||!integer(w.wallet_version)||
     w.wallet_version===0||!Number.isSafeInteger(w.balance)||w.revoked!==0)
     return deny('BATTERY_WALLET_RECEIPT_MISSING_OR_REVOKED');
    if(w.hold_status==='held'&&w.expires_ms<=now)
     return deny('RESERVE_EXPIRED_UNSETTLED');
    if(w.hold_status!=='committed'||w.reserve_entries!==1||
     w.commit_entries!==1||w.commit_revision!==w.wallet_version||
     w.commit_balance_after!==w.balance)
     return deny('TASK_COMMIT_WALLET_PARTIAL_OR_REPLAY');
    const sourceRef=t.source_event_ref as string;
    const getProvenance=async()=>exact(await cfg.provenance.readCandidate(sourceRef,scope),PROOF);
    const p=await getProvenance();
    if(!p||p.source_event_ref!==sourceRef||p.member_ref!==memberRef||
     p.environment!==scope.environment||p.auth_version!==a.auth_version||
     p.policy_version!==policy||!integer(p.observed_at_ms)||
     p.observed_at_ms>now||!integer(p.witness_revision)||p.witness_revision===0)
     return deny('INDEPENDENT_SIGNED_AUTH_PROVENANCE_UNAVAILABLE');
    const getFloor=async()=>exact(await cfg.floor.readCandidate(taskRef,scope),FLOOR);
    const f=await getFloor();
    if(!f||f.task_ref!==taskRef||f.member_ref!==memberRef||
     f.environment!==scope.environment||f.policy_version!==policy||
     !integer(f.minimum_wallet_revision)||!integer(f.witness_revision)||
     f.witness_revision===0)
     return deny('INDEPENDENT_NONROLLBACK_FLOOR_UNAVAILABLE');
    if((f.minimum_wallet_revision as number)>(w.wallet_version as number))
     return deny('PITR_WALLET_BELOW_FLOOR');
    const [a2,t2,w2,p2,f2]=await Promise.all([
     getAuth(),getTask(),getWallet(),getProvenance(),getFloor()]);
    if([a,t,w,p,f].some((v,i)=>JSON.stringify(v)!==
     JSON.stringify([a2,t2,w2,p2,f2][i])))
     return deny('MULTI_DB_PARTIAL_COMMIT_OR_CONCURRENT_RACE');
    if(await cfg.lawfulPurposeNow(scope)!==true||
     await cfg.lawfulRetentionNow(scope)!==true||
     await cfg.approvedPolicyVersionNow(scope)!==policy)
     return deny('LAW_OR_POLICY_CHANGED_DURING_CHECK');
    return review({brand_id:'starry',environment:scope.environment,task_ref:taskRef,
     source_event_ref:sourceRef,policy_version:policy,
     wallet_revision:w.wallet_version as number,task_attempt:1,
     kind:'OFFLINE_UNTRUSTED_LOCAL_RECEIPT'});
   }catch{return deny('AUTH_TASK_BATTERY_OR_WITNESS_UNAVAILABLE');}
  }
 });
}
