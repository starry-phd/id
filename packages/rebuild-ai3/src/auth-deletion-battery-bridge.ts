/**
 * AI-3 R15: bridge EXACT persisted AI-1 Auth outbox shape to R14 Battery.
 * Offline candidate only. NO fabricated Billing digest, auth_version, scope
 * fields or unsupported cross-D1 transaction and no Queue ACK.
 */
import {createOfflineAuthDeletionBatteryConsumer} from './auth-deletion-battery-consumer.ts';
import type {AuthDeletionEvent,BatteryDeletionResult,DeletionSqlPort,
 StarryDeletionScope} from './auth-deletion-battery-consumer.ts';
export const LIVE_AUTH_OUTBOX_BATTERY_BRIDGE_ENABLED=false as const;
export type OriginalAuthOutboxRow=Readonly<{
 event_id:string;s_user_id:string;occurred_at:number;event_type:'account_deleted';
}>;
export type CurrentAuthDeletionEvidence=Readonly<{
 event_id:string;s_user_id:string;occurred_at:number;event_type:'account_deleted';
 status:'deleted';auth_version:number;deleted_at:number;unrevoked_sessions:0;
}>;
type Value=string|number;
export type ReadOnlyAuthDb=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...values:Value[])=>Readonly<{first:<T extends object>()=>Promise<T|null>}>;
}>}>;
export type R15PolicyPorts=Readonly<{
 lawfulDeletionRetentionApproved:(scope:StarryDeletionScope)=>Promise<boolean>;
 readApprovedBatteryPolicyVersion:(scope:StarryDeletionScope)=>Promise<number|null>;
}>;
const RAW=['event_id','s_user_id','occurred_at','event_type'] as const;
const PROOF=['event_id','s_user_id','occurred_at','event_type',
 'status','auth_version','deleted_at','unrevoked_sessions'] as const;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const integer=(v:unknown):v is number=>typeof v==='number'&&
 Number.isSafeInteger(v)&&v>=0;
function shape(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const all=Reflect.ownKeys(v);
  if(all.length!==keys.length||all.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const obj:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   obj[k]=d.value;
  }
  return obj;
 }catch{return null;}
}
/**
 * EXACT R13/14 AI-1 schemas 001 + 007 + 011 + 012. Read-only.
 * Challenge, outbox, Member, current revoked sessions and scope must agree
 * in ONE Auth SELECT. Never materialize challenge_ref, sessions or identity.
 */
export const VERIFIED_AUTH_OUTBOX_SQL=[
 'SELECT o.event_id,o.s_user_id,o.occurred_at,o.event_type,',
 'm.status,m.auth_version,m.updated_at AS deleted_at,',
 '(SELECT COUNT(*) FROM starry_sessions s WHERE s.s_user_id=o.s_user_id',
 'AND s.revoked_at IS NULL) AS unrevoked_sessions',
 'FROM starry_deletion_outbox o',
 'JOIN starry_members m ON m.s_user_id=o.s_user_id',
 'JOIN starry_deletion_challenges c ON c.event_id=o.event_id',
 'AND c.s_user_id=o.s_user_id',
 'JOIN starry_deletion_challenge_scope sc ON sc.challenge_ref=c.challenge_ref',
 "WHERE o.event_id=? AND o.s_user_id=? AND o.occurred_at=?",
 "AND o.event_type='account_deleted'",
 "AND m.status='deleted' AND m.updated_at=o.occurred_at",
 'AND m.auth_version=c.auth_version+1',
 'AND c.consumed_at=o.occurred_at',
 'AND sc.environment=?',
 'AND NOT EXISTS(SELECT 1 FROM starry_sessions active',
 'WHERE active.s_user_id=o.s_user_id AND active.revoked_at IS NULL)'
].join(' ');
const deny=(reason:string):BatteryDeletionResult=>Object.freeze({
 disposition:'retry',reason,may_regrant:false,may_ack_queue:false,live:false
});
function original(v:unknown,now:number):OriginalAuthOutboxRow|null{
 const x=shape(v,RAW);
 if(!x||typeof x.event_id!=='string'||!EVENT.test(x.event_id)||
  typeof x.s_user_id!=='string'||!ID.test(x.s_user_id)||
  !integer(x.occurred_at)||!Number.isSafeInteger(x.occurred_at*1000)||
  x.occurred_at*1000>now||x.event_type!=='account_deleted')return null;
 return Object.freeze({
  event_id:x.event_id,s_user_id:x.s_user_id,
  occurred_at:x.occurred_at,event_type:'account_deleted'
 });
}
function authentic(row:unknown,e:OriginalAuthOutboxRow):row is CurrentAuthDeletionEvidence{
 const a=shape(row,PROOF);
 return !!a&&a.event_id===e.event_id&&a.s_user_id===e.s_user_id&&
  a.occurred_at===e.occurred_at&&a.event_type==='account_deleted'&&
  a.status==='deleted'&&integer(a.auth_version)&&a.auth_version>=2&&
  a.deleted_at===e.occurred_at&&a.unrevoked_sessions===0;
}
/**
 * This is NOT a P05 universal event and not a cross-D1 signed attestation.
 * Front-end or Queue JSON never authorizes a deletion: the original event
 * must be re-read from trusted AI-1 Auth DB, including after the first query.
 */
export function createOfflineVerifiedAuthDeletionBatteryBridge(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionScope;authDb:ReadOnlyAuthDb;
 batteryDb:DeletionSqlPort;policy:R15PolicyPorts;
}>){
 const s=shape(deps?.scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||
  (s.environment!=='development'&&s.environment!=='staging'))
  throw Error('AI3_R15_SCOPE_DENIED');
 if(!deps.authDb||typeof deps.authDb.prepare!=='function'||
  !deps.batteryDb||typeof deps.batteryDb.prepare!=='function'||
  !deps.policy||typeof deps.policy.lawfulDeletionRetentionApproved!=='function'||
  typeof deps.policy.readApprovedBatteryPolicyVersion!=='function')
  throw Error('AI3_R15_TRUSTED_BACKEND_REQUIRED');
 const scope:StarryDeletionScope=Object.freeze({
  brand_id:'starry',environment:s.environment as StarryDeletionScope['environment']
 });
 const enabled=deps.enabled===true;
 const source=async(e:OriginalAuthOutboxRow):Promise<boolean>=>{
  const row=await deps.authDb.prepare(VERIFIED_AUTH_OUTBOX_SQL).bind(
   e.event_id,e.s_user_id,e.occurred_at,scope.environment
  ).first<Record<string,unknown>>();
  return authentic(row,e);
 };
 const consumer=createOfflineAuthDeletionBatteryConsumer({
  enabled,scope,db:deps.batteryDb,
  authority:{
   verifyCommittedDeletion:async(_s,translated:AuthDeletionEvent)=>{
    if(!integer(translated.occurred_at_sec))return false;
    // Only construct original canonical fields from the already validated
    // translated object; second Auth SELECT is a NEW authoritative read.
    const e:OriginalAuthOutboxRow={
     event_id:translated.event_id,s_user_id:translated.member_ref,
     occurred_at:translated.occurred_at_sec,event_type:'account_deleted'
    };
    return source(e);
   },
   readApprovedBatteryPolicyVersion:deps.policy.readApprovedBatteryPolicyVersion
  }
 });
 return Object.freeze({
  async consume(raw:unknown,nowMs:number):Promise<BatteryDeletionResult>{
   if(!enabled)return deny('DISABLED');
   if(!integer(nowMs))return deny('INVALID_SERVER_CLOCK');
   const e=original(raw,nowMs);
   if(!e)return deny('ORIGINAL_AI1_OUTBOX_INVALID_OR_MEMBER_REF_INCOMPATIBLE');
   try{
    if(await deps.policy.lawfulDeletionRetentionApproved(scope)!==true)
     return deny('PRIVACY_LEGAL_APPROVAL_MISSING');
    if(await source(e)!==true)return deny('CURRENT_AUTH_OUTBOX_NOT_COMMITTED');
    // Preserve exact AI-1 source ref/time. Never synthesize Billing's
    // event_digest, auth_version or a fake signature from available data.
    return await consumer.consume({
     event_id:e.event_id,member_ref:e.s_user_id,
     occurred_at_sec:e.occurred_at,event_type:'account_deleted'
    },nowMs);
   }catch{return deny('AUTH_DB_OR_BATTERY_UNAVAILABLE');}
  }
 });
}
