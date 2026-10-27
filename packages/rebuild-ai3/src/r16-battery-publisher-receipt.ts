/**
 * AI-3 R16: OFFLINE candidate "single publisher" Battery replay receipt.
 * Only the trusted AI-1 Auth outbox can supply deletion facts.
 * This does NOT select the production publisher or ACK any live Queue.
 * Reuse R15 Auth proof and R14 Battery single-DB atomic tombstone.
 */
import {createOfflineVerifiedAuthDeletionBatteryBridge,
 VERIFIED_AUTH_OUTBOX_SQL} from './auth-deletion-battery-bridge.ts';
import type {ReadOnlyAuthDb,OriginalAuthOutboxRow} from './auth-deletion-battery-bridge.ts';
import type {DeletionSqlPort,StarryDeletionScope} from './auth-deletion-battery-consumer.ts';

export const LIVE_BATTERY_R16_PUBLISHER_SYNC_ENABLED=false as const;
export const R16_CANDIDATE_SINGLE_PUBLISHER='ai1.starry_deletion_outbox.v1' as const;
export type PublisherPort=Readonly<{
 /** Reads ORIGINAL four-column committed AI-1 outbox by opaque ref. */
 readCommittedOriginal:(eventId:string,scope:StarryDeletionScope)=>Promise<unknown>;
}>;
export type BatteryReceiptDb=Readonly<{
 prepare:(sql:string)=>Readonly<{
  bind:(...params:(string|number)[])=>Readonly<{
   first:<T extends object>()=>Promise<T|null>;
  }>;
 }>;
}>;
export type R16Result=Readonly<{
 status:'blocked'|'applied_offline'|'already_applied_offline';
 reason:string;may_ack_queue:false;may_regrant:false;may_restore:false;live:false;
}>;
type Receipt=Readonly<{
 event_id:string;member_ref:string;event_type:'account_deleted';
 occurred_at_ms:number;policy_version:number;applied:1;revoked:1;
 balance:0;wallet_version:number;journal_revision:number;
 kind:'revoke';delta:number;balance_after:0;
 reason_code:'ACCOUNT_DELETED';pending_holds:0;
}>;
const RAW=['event_id','s_user_id','occurred_at','event_type'] as const;
const EVIDENCE=['event_id','s_user_id','occurred_at','event_type','status',
 'auth_version','deleted_at','unrevoked_sessions'] as const;
const RECEIPT=['event_id','member_ref','event_type','occurred_at_ms','policy_version',
 'applied','revoked','balance','wallet_version','journal_revision','kind','delta',
 'balance_after','reason_code','pending_holds'] as const;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const MEMBER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const int=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const names=Reflect.ownKeys(v);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   result[k]=d.value;
  }
  return result;
 }catch{return null;}
}
function source(raw:unknown,id:string,now:number):OriginalAuthOutboxRow|null{
 const r=exact(raw,RAW);
 if(!r||r.event_id!==id||!EVENT.test(id)||
  typeof r.s_user_id!=='string'||!MEMBER.test(r.s_user_id)||
  !int(r.occurred_at)||!Number.isSafeInteger(r.occurred_at*1000)||
  r.occurred_at*1000>now||r.event_type!=='account_deleted')return null;
 return Object.freeze({event_id:id,s_user_id:r.s_user_id,
  occurred_at:r.occurred_at,event_type:'account_deleted'});
}
function matchesAuth(raw:unknown,e:OriginalAuthOutboxRow):boolean{
 const r=exact(raw,EVIDENCE);
 return !!r&&r.event_id===e.event_id&&r.s_user_id===e.s_user_id&&
  r.occurred_at===e.occurred_at&&r.event_type==='account_deleted'&&
  r.status==='deleted'&&int(r.auth_version)&&r.auth_version>=2&&
  r.deleted_at===e.occurred_at&&r.unrevoked_sessions===0;
}
function verifyReceipt(raw:unknown,e:OriginalAuthOutboxRow):Receipt|null{
 const r=exact(raw,RECEIPT);
 if(!r||r.event_id!==e.event_id||r.member_ref!==e.s_user_id||
  r.event_type!=='account_deleted'||r.occurred_at_ms!==e.occurred_at*1000||
  !int(r.policy_version)||r.policy_version<1||r.applied!==1||
  r.revoked!==1||r.balance!==0||!int(r.wallet_version)||r.wallet_version===0||
  r.journal_revision!==r.wallet_version||r.kind!=='revoke'||
  typeof r.delta!=='number'||!Number.isSafeInteger(r.delta)||
  r.balance_after!==0||r.reason_code!=='ACCOUNT_DELETED'||
  r.pending_holds!==0)return null;
 return r as unknown as Receipt;
}
const result=(status:R16Result['status'],reason:string):R16Result=>
 Object.freeze({status,reason,may_ack_queue:false,may_regrant:false,
  may_restore:false,live:false});
/**
 * Existing R14 ledger/inbox is the sole durable Battery receipt.
 * Includes event identity AND original time; different event for same member
 * is not an idempotent retry. Always re-verify Auth after local DB reads.
 */
export const BATTERY_R16_RECEIPT_SQL=[
 'SELECT i.event_id,i.member_ref,i.event_type,i.occurred_at_ms,i.policy_version,',
 'i.applied,w.revoked,w.balance,w.version AS wallet_version,',
 'j.revision AS journal_revision,j.kind,j.delta,j.balance_after,j.reason_code,',
 '(SELECT COUNT(*) FROM ai3_battery_hold h WHERE h.brand_id=i.brand_id',
 "AND h.member_ref=i.member_ref AND h.status='held') AS pending_holds",
 'FROM ai3_r14_deletion_inbox i JOIN ai3_battery_wallet w',
 'ON w.brand_id=i.brand_id AND w.member_ref=i.member_ref',
 'JOIN ai3_battery_journal j ON j.brand_id=i.brand_id',
 "AND j.member_ref=i.member_ref AND j.event_ref=i.event_id AND j.kind='revoke'",
 "WHERE i.brand_id='starry' AND i.environment=? AND i.event_id=?",
 'AND i.member_ref=? AND i.occurred_at_ms=?'
].join(' ');

export function createOfflineBatteryPublisherReceiptSync(config:Readonly<{
 enabled?:boolean;scope:StarryDeletionScope;
 /** Fixed by trusted server config, NEVER taken from an incoming message. */
 publisher_id:typeof R16_CANDIDATE_SINGLE_PUBLISHER;
 publisher:PublisherPort;
 authDb:ReadOnlyAuthDb;
 batteryReadDb:BatteryReceiptDb;
 /** Must target SAME logical Battery DB as batteryReadDb; not proven live. */
 batteryWriteDb:DeletionSqlPort;
 lawfulProcessingApprovedNow:(s:StarryDeletionScope)=>Promise<boolean>;
 readApprovedBatteryPolicyVersion:(s:StarryDeletionScope)=>Promise<number|null>;
}>){
 const sc=exact(config?.scope,['brand_id','environment']);
 if(!sc||sc.brand_id!=='starry'||
  (sc.environment!=='development'&&sc.environment!=='staging')||
  config.publisher_id!==R16_CANDIDATE_SINGLE_PUBLISHER)
  throw Error('AI3_R16_SINGLE_PUBLISHER_SCOPE_DENIED');
 if(!config.publisher||typeof config.publisher.readCommittedOriginal!=='function'||
  !config.authDb||typeof config.authDb.prepare!=='function'||
  !config.batteryReadDb||typeof config.batteryReadDb.prepare!=='function'||
  !config.batteryWriteDb||typeof config.batteryWriteDb.prepare!=='function'||
  typeof config.lawfulProcessingApprovedNow!=='function'||
  typeof config.readApprovedBatteryPolicyVersion!=='function')
  throw Error('AI3_R16_SERVER_AUTHORITY_REQUIRED');
 const scope:StarryDeletionScope=Object.freeze({
  brand_id:'starry',environment:sc.environment as StarryDeletionScope['environment']
 });
 const enabled=config.enabled===true;
 const auth=async(e:OriginalAuthOutboxRow):Promise<boolean>=>{
  const row=await config.authDb.prepare(VERIFIED_AUTH_OUTBOX_SQL)
   .bind(e.event_id,e.s_user_id,e.occurred_at,scope.environment)
   .first<Record<string,unknown>>();
  return matchesAuth(row,e);
 };
 const receipt=async(e:OriginalAuthOutboxRow):Promise<Receipt|null>=>{
  const row=await config.batteryReadDb.prepare(BATTERY_R16_RECEIPT_SQL)
   .bind(scope.environment,e.event_id,e.s_user_id,e.occurred_at*1000)
   .first<Record<string,unknown>>();
  return verifyReceipt(row,e);
 };
 const bridge=createOfflineVerifiedAuthDeletionBatteryBridge({
  enabled,scope,authDb:config.authDb,batteryDb:config.batteryWriteDb,
  policy:{
   lawfulDeletionRetentionApproved:config.lawfulProcessingApprovedNow,
   readApprovedBatteryPolicyVersion:config.readApprovedBatteryPolicyVersion
  }
 });
 return Object.freeze({
  async sync(eventId:unknown,serverNowMs:unknown):Promise<R16Result>{
   // Accept only ID as event *locator*. Never accept sender's purported DTO,
   // scope, producer id, signature, secret or approval bool.
   if(!enabled)return result('blocked','DISABLED');
   if(typeof eventId!=='string'||!EVENT.test(eventId)||
    !int(serverNowMs))return result('blocked','INVALID_EVENT_REF_OR_CLOCK');
   try{
    if(await config.lawfulProcessingApprovedNow(scope)!==true)
     return result('blocked','LAWFUL_PURPOSE_DENIED');
    // Pin the approved policy before ANY protected Auth/Battery read.
    // A replay receipt is not lawful merely because it was once persisted.
    const policyAtStart=await config.readApprovedBatteryPolicyVersion(scope);
    if(!int(policyAtStart)||policyAtStart<1)
     return result('blocked','BATTERY_POLICY_NOT_APPROVED');
    const original=source(await config.publisher.readCommittedOriginal(eventId,scope),
      eventId,serverNowMs);
    if(!original)return result('blocked','ONLY_AUTH_OUTBOX_IS_SOURCE');
    if(await auth(original)!==true)return result('blocked','AUTH_COMMIT_NOT_CURRENT');
    const before=await receipt(original);
    if(before){
     if(before.policy_version!==policyAtStart)
      return result('blocked','BATTERY_RECEIPT_POLICY_STALE');
     // A duplicate is NOT a second mutation: prove same event, member, time
     // and locally persisted revoke, check Auth and same receipt AGAIN.
     const latestOriginal=source(
      await config.publisher.readCommittedOriginal(eventId,scope),eventId,serverNowMs);
     if(await auth(original)!==true||!latestOriginal||
      latestOriginal.s_user_id!==original.s_user_id||
      latestOriginal.occurred_at!==original.occurred_at)
      return result('blocked','AUTH_CHANGED_DURING_REPLAY');
     const after=await receipt(original);
     if(!after||JSON.stringify(before)!==JSON.stringify(after))
      return result('blocked','BATTERY_RECEIPT_RACED');
     // The same policy must still be lawful and current at confirmation.
     if(await config.lawfulProcessingApprovedNow(scope)!==true||
      await config.readApprovedBatteryPolicyVersion(scope)!==policyAtStart)
      return result('blocked','LEGAL_OR_POLICY_CHANGED_BEFORE_CONFIRMATION');
     return result('already_applied_offline','DURABLE_BATTERY_REPLAY_MATCHED');
    }
    // Only the already-tested R15 bridge can initiate the R14 local DELETE.
    const consume=await bridge.consume(original,serverNowMs);
    // A concurrently applied event or lost postcommit response may have
    // actually succeeded: reconcile the same immutable inbox either way.
    const recovered=await receipt(original);
    if(!recovered)return result('blocked','BATTERY_RECEIPT_MISSING_OR_CONFLICT');
    if(recovered.policy_version!==policyAtStart)
     return result('blocked','BATTERY_RECEIPT_POLICY_STALE');
    if(await auth(original)!==true)return result('blocked','AUTH_CHANGED_AFTER_BATTERY_COMMIT');
    const publisherAgain=source(await config.publisher.readCommittedOriginal(eventId,scope),
     eventId,serverNowMs);
    if(!publisherAgain||publisherAgain.s_user_id!==original.s_user_id||
     publisherAgain.occurred_at!==original.occurred_at)
     return result('blocked','PUBLISHER_EVENT_CHANGED');
    const confirmed=await receipt(original);
    if(!confirmed||JSON.stringify(recovered)!==JSON.stringify(confirmed))
     return result('blocked','BATTERY_RECEIPT_CHANGED');
    if(await config.lawfulProcessingApprovedNow(scope)!==true||
     await config.readApprovedBatteryPolicyVersion(scope)!==policyAtStart)
     return result('blocked','LEGAL_OR_POLICY_CHANGED_BEFORE_CONFIRMATION');
    return consume.disposition==='receipt_only'?
     result('applied_offline','BATTERY_LOCAL_COMMIT_CONFIRMED'):
     result('already_applied_offline','CONCURRENT_OR_RETRIED_COMMIT_CONFIRMED');
   }catch{return result('blocked','AUTH_BATTERY_SOURCE_UNAVAILABLE');}
  }
 });
}
