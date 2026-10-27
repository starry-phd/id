/**
 * AI-4 R16: OFFLINE-only delivery coordinator, NOT a second publisher.
 * AI-1's committed Auth outbox is the sole authoritative deletion source.
 * No live Queue ACK, real D1 migration, KMS, Store or cross-DB atomicity.
 */
import {isSealedAuthDeletionSource} from '../../../modules/starry-id-v1/src/round15-deletion-source-contract.ts';
import type {AuthCommittedDeletion,BatteryAuthDeletionDTO,StarryDeletionEventScope} from '../../../modules/starry-id-v1/src/round15-deletion-source-contract.ts';
export const LIVE_DELETION_DELIVERY_COORDINATOR=false as const;
export const DELETION_DELIVERY_VERSION='starry.deletion-delivery.v0-draft' as const;
export const EXCLUSIVE_DELETION_PUBLISHER='AI-1_AUTH_COMMITTED_OUTBOX' as const;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const MEMBER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const STATE=['environment','event_id','member_ref','occurred_at_sec','auth_version','status','lease_token','leased_until_sec'] as const;
const RECEIPT=['event_id','member_ref','inbox_applied','wallet_revoked','pending_holds','journal_kind','journal_event_ref'] as const;
const finite=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
function exact(v:unknown,names:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return null;
  const all=Reflect.ownKeys(v);
  if(all.length!==names.length||all.some(x=>typeof x!=='string'||!names.includes(x)))return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of names){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   o[k]=d.value;
  }
  return o;
 }catch{return null;}
}
/** DDL exists ONLY as an embedded disposable SQLite test fixture; NOT a migration. */
export const DELIVERY_JOURNAL_DRAFT_SQL=Object.freeze({
 create:`CREATE TABLE ai4_r16_delivery_journal(
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  event_id TEXT NOT NULL,
  member_ref TEXT NOT NULL,
  occurred_at_sec INTEGER NOT NULL CHECK(occurred_at_sec>0),
  auth_version INTEGER NOT NULL CHECK(auth_version>=2),
  status TEXT NOT NULL CHECK(status IN ('leased','applied')),
  lease_token TEXT,
  leased_until_sec INTEGER NOT NULL CHECK(leased_until_sec>=0),
  PRIMARY KEY(environment,event_id),
  UNIQUE(environment,member_ref),
  CHECK((status='leased' AND lease_token IS NOT NULL) OR
        (status='applied' AND lease_token IS NULL))
 );
 CREATE TRIGGER ai4_r16_no_erase BEFORE DELETE ON ai4_r16_delivery_journal
 BEGIN SELECT RAISE(ABORT,'DELIVERY_JOURNAL_RETENTION_GATE'); END;
 CREATE TRIGGER ai4_r16_no_rollback AFTER UPDATE ON ai4_r16_delivery_journal
 WHEN OLD.status='applied' OR OLD.member_ref<>NEW.member_ref
 OR OLD.occurred_at_sec<>NEW.occurred_at_sec
 OR OLD.auth_version<>NEW.auth_version OR OLD.event_id<>NEW.event_id
 OR OLD.environment<>NEW.environment
 BEGIN SELECT RAISE(ABORT,'DELIVERY_JOURNAL_IMMUTABLE'); END;`,
 claim:`INSERT INTO ai4_r16_delivery_journal
 (environment,event_id,member_ref,occurred_at_sec,auth_version,status,lease_token,leased_until_sec)
 VALUES (?,?,?,?,?,'leased',?,?)
 ON CONFLICT(environment,event_id) DO UPDATE SET
 lease_token=excluded.lease_token,leased_until_sec=excluded.leased_until_sec
 WHERE ai4_r16_delivery_journal.status='leased'
 AND ai4_r16_delivery_journal.leased_until_sec<=?
 AND ai4_r16_delivery_journal.member_ref=excluded.member_ref
 AND ai4_r16_delivery_journal.occurred_at_sec=excluded.occurred_at_sec
 AND ai4_r16_delivery_journal.auth_version=excluded.auth_version
 RETURNING environment,event_id,member_ref,occurred_at_sec,auth_version,
 status,lease_token,leased_until_sec`,
 read:`SELECT environment,event_id,member_ref,occurred_at_sec,auth_version,
 status,lease_token,leased_until_sec FROM ai4_r16_delivery_journal
 WHERE environment=? AND event_id=?`,
 complete:`UPDATE ai4_r16_delivery_journal SET status='applied',
 lease_token=NULL,leased_until_sec=0
 WHERE environment=? AND event_id=? AND member_ref=? AND status='leased'
 AND lease_token=? RETURNING
 environment,event_id,member_ref,occurred_at_sec,auth_version,
 status,lease_token,leased_until_sec`
});
export type LocalDeliveryDB=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...values:(string|number)[])=>Readonly<{first:<T extends object>()=>Promise<T|null>}>;
}>}>;
export type DeliveryAuthSource=Readonly<{
 readCommitted:(id:unknown)=>Promise<AuthCommittedDeletion|null>;
 readBatteryEvent:(id:unknown)=>Promise<BatteryAuthDeletionDTO|null>;
 verifyCommittedDeletion:(scope:unknown,event:unknown)=>Promise<boolean>;
}>;
export type LocalBatteryResult=Readonly<{disposition:'receipt_only'|'retry';
 may_ack_queue:false;may_regrant:false;live:false}>;
export type DeliveryPorts=Readonly<{
 auth:DeliveryAuthSource;db:LocalDeliveryDB;
 consumeBattery:(e:BatteryAuthDeletionDTO,nowMs:number)=>Promise<LocalBatteryResult>;
 readBatteryReceipt:(eventId:string,memberRef:string)=>Promise<unknown>;
}>;
export type DeliveryResult=Readonly<{
 status:'local_recorded'|'duplicate_local'|'retry'|'blocked';reason:string;
 may_ack_queue:false;may_regrant:false;live:false;
 sole_publisher:typeof EXCLUSIVE_DELETION_PUBLISHER;
}>;
function res(status:DeliveryResult['status'],reason:string):DeliveryResult{
 return Object.freeze({status,reason,may_ack_queue:false,may_regrant:false,live:false,
  sole_publisher:EXCLUSIVE_DELETION_PUBLISHER});
}
function state(v:unknown,e:AuthCommittedDeletion,env:string):Record<string,unknown>|null{
 const r=exact(v,STATE);
 return r&&r.environment===env&&r.event_id===e.event_id&&
 r.member_ref===e.s_user_id&&r.occurred_at_sec===e.occurred_at&&
 r.auth_version===e.auth_version&&finite(r.leased_until_sec)&&
 (r.status==='applied'?r.lease_token===null&&r.leased_until_sec===0:
 r.status==='leased'&&typeof r.lease_token==='string'&&/^[a-f0-9]{32}$/.test(r.lease_token))
 ?r:null;
}
function receipt(v:unknown,e:AuthCommittedDeletion):boolean{
 const r=exact(v,RECEIPT);
 return !!r&&r.event_id===e.event_id&&r.member_ref===e.s_user_id&&
 r.inbox_applied===1&&r.wallet_revoked===1&&r.pending_holds===0&&
 r.journal_kind==='revoke'&&r.journal_event_ref===e.event_id;
}
function same(a:AuthCommittedDeletion,b:AuthCommittedDeletion):boolean{
 return a.event_id===b.event_id&&a.s_user_id===b.s_user_id&&
 a.occurred_at===b.occurred_at&&a.auth_version===b.auth_version&&
 a.event_type===b.event_type;
}
export function createOfflineSinglePublisherDeletionSync(scope:StarryDeletionEventScope,ports:DeliveryPorts){
 const s=exact(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||
 (s.environment!=='development'&&s.environment!=='staging'))
 throw Error('AI4_R16_SCOPE_DENIED');
 if(typeof ports?.auth?.readCommitted!=='function'||
 typeof ports.auth.readBatteryEvent!=='function'||
 typeof ports.auth.verifyCommittedDeletion!=='function'||
 typeof ports.db?.prepare!=='function'||
 typeof ports.consumeBattery!=='function'||
 typeof ports.readBatteryReceipt!=='function')
 throw Error('AI4_R16_PORTS_REQUIRED');
 const stableScope:StarryDeletionEventScope=Object.freeze({
  brand_id:'starry',environment:s.environment as 'development'|'staging'
 });
 const get=async(id:string):Promise<AuthCommittedDeletion|null>=>{
  const e=await ports.auth.readCommitted(id);
  if(!isSealedAuthDeletionSource(e)||e.event_id!==id||
   !EVENT.test(e.event_id)||!MEMBER.test(e.s_user_id)||
   !finite(e.occurred_at,1)||!finite(e.auth_version,2))return null;
  return e;
 };
 const reread=(id:string)=>ports.db.prepare(DELIVERY_JOURNAL_DRAFT_SQL.read)
  .bind(stableScope.environment,id).first<Record<string,unknown>>();
 return Object.freeze({
  async deliver(eventRef:unknown,serverNowSec:unknown):Promise<DeliveryResult>{
   if(typeof eventRef!=='string'||!EVENT.test(eventRef)||
    !finite(serverNowSec,1)||!finite(serverNowSec*1000))
    return res('blocked','INVALID_REF_OR_CLOCK');
   try{
    // There is intentionally NO publish() method or self-issued event.
    const a=await get(eventRef);
    if(!a||a.occurred_at>serverNowSec)return res('blocked','AUTH_NOT_COMMITTED');
    const raw=exact(await ports.auth.readBatteryEvent(eventRef),
     ['event_id','member_ref','occurred_at_sec','event_type']);
    if(!raw||raw.event_id!==a.event_id||raw.member_ref!==a.s_user_id||
     raw.occurred_at_sec!==a.occurred_at||raw.event_type!=='account_deleted')
     return res('blocked','SOURCE_MAPPING_MISMATCH');
    const dto:BatteryAuthDeletionDTO=Object.freeze({
     event_id:a.event_id,member_ref:a.s_user_id,
     occurred_at_sec:a.occurred_at,event_type:'account_deleted'
    });
    if(await ports.auth.verifyCommittedDeletion(stableScope,dto)!==true)
     return res('blocked','SOURCE_AUTHORITY_UNVERIFIED');
    const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),
     n=>n.toString(16).padStart(2,'0')).join('');
    const until=serverNowSec+30;
    if(!finite(until))return res('blocked','LEASE_TIME_OVERFLOW');
    const claim=state(await ports.db.prepare(DELIVERY_JOURNAL_DRAFT_SQL.claim)
     .bind(stableScope.environment,a.event_id,a.s_user_id,a.occurred_at,
      a.auth_version,token,until,serverNowSec)
     .first<Record<string,unknown>>(),a,stableScope.environment);
    if(!claim||claim.status!=='leased'||claim.lease_token!==token){
     const prior=state(await reread(a.event_id),a,stableScope.environment);
     if(!prior||prior.status!=='applied')return res('retry','LEASE_HELD_OR_CONFLICT');
     const fresh=await get(a.event_id);
     if(!fresh||!same(a,fresh)||
      await ports.auth.verifyCommittedDeletion(stableScope,dto)!==true||
      !receipt(await ports.readBatteryReceipt(a.event_id,a.s_user_id),a))
      return res('retry','PREVIOUS_RECEIPT_NOT_AUTHENTICATED');
     return res('duplicate_local','ALREADY_CONSUMED_IN_SINK');
    }
    // Recover crash between Battery mutation and local delivered receipt.
    let applied=receipt(await ports.readBatteryReceipt(a.event_id,a.s_user_id),a);
    if(!applied){
     const r=await ports.consumeBattery(dto,serverNowSec*1000);
     if(r?.may_ack_queue!==false||r?.may_regrant!==false||r?.live!==false||
      !['receipt_only','retry'].includes(String(r.disposition)))
      return res('retry','BATTERY_RESULT_NOT_TRUSTED');
     applied=receipt(await ports.readBatteryReceipt(a.event_id,a.s_user_id),a);
     if(!applied)return res('retry','BATTERY_DURABLE_RECEIPT_MISSING');
    }
    const current=await get(a.event_id);
    if(!current||!same(current,a)||
     await ports.auth.verifyCommittedDeletion(stableScope,dto)!==true)
     return res('retry','AUTH_CHANGED_BEFORE_COMPLETION');
    const done=state(await ports.db.prepare(DELIVERY_JOURNAL_DRAFT_SQL.complete)
     .bind(stableScope.environment,a.event_id,a.s_user_id,token)
     .first<Record<string,unknown>>(),a,stableScope.environment);
    if(!done||done.status!=='applied')return res('retry','LEASE_CAS_NOT_DURABLE');
    const final=state(await reread(a.event_id),a,stableScope.environment);
    if(!final||final.status!=='applied'||
     !receipt(await ports.readBatteryReceipt(a.event_id,a.s_user_id),a))
     return res('retry','POSTCOMMIT_RECEIPT_CHANGED');
    return res('local_recorded','SINK_REVOCATION_LOCALLY_DURABLE_ONLY');
   }catch{return res('retry','SOURCE_OR_SINK_UNAVAILABLE');}
  }
 });
}
