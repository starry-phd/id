/**
 * AI-4 R18 — PRIVATE, OFFLINE-ONLY Saga/Outbox transport candidate.
 * No new account_deleted publisher, domain DB writes, Queue/DLQ or public route.
 * Local commits cannot prove official independent provenance or cross-D1 ACID.
 */
import type {OfflineFanoutResult} from './round17-offline-deletion-fanout-review.ts';
export const R18_LIVE_TRANSPORT_ENABLED=false as const;
export const R18_CANDIDATE_VERSION='starry.saga-transport.v0-draft' as const;
export const R18_ONLY_LOGICAL_SOURCE='AI-1_AUTH_COMMITTED_OUTBOX' as const;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const MEMBER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const POLICY=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/;
const WITNESS=['brand_id','environment','event_id','member_ref','auth_version','policy_revision','signature'] as const;
const SINK=['sink','brand_id','environment','event_id','member_ref','auth_version','policy_revision','source_event_ref','committed','inbox_applied','pending_holds','active_entitlements','task_released'] as const;
const ROW=['environment','event_id','member_ref','auth_version','policy_revision','status','lease_token','lease_until_sec','attempt_count'] as const;
const DOMAINS=['battery','billing','task'] as const;
type Domain=typeof DOMAINS[number];
type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
type Witness=Readonly<{brand_id:'starry';environment:Scope['environment'];event_id:string;member_ref:string;auth_version:number;policy_revision:string;signature:string}>;
type Journal=Record<string,unknown>;
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
function exact(value:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const record:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of fields){
   const desc=Object.getOwnPropertyDescriptor(value,key);
   if(!desc||!desc.enumerable||!('value' in desc))return null;
   record[key]=desc.value;
  }
  return record;
 }catch{return null;}
}
export const R18_DISPOSABLE_TRANSPORT_SQL=Object.freeze({
 create:"CREATE TABLE ai4_r18_offline_saga (environment TEXT NOT NULL CHECK(environment IN ('development','staging')), event_id TEXT NOT NULL,member_ref TEXT NOT NULL,auth_version INTEGER NOT NULL CHECK(auth_version>=2),policy_revision TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('leased','retry','observed_local','review_only')),lease_token TEXT,lease_until_sec INTEGER NOT NULL CHECK(lease_until_sec>=0),attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 1 AND 3),PRIMARY KEY(environment,event_id),UNIQUE(environment,member_ref),CHECK((status='leased' AND lease_token IS NOT NULL) OR (status<>'leased' AND lease_token IS NULL))); CREATE TRIGGER ai4_r18_deny_erase BEFORE DELETE ON ai4_r18_offline_saga BEGIN SELECT RAISE(ABORT,'R18_RETENTION_UNAPPROVED'); END; CREATE TRIGGER ai4_r18_immutable AFTER UPDATE ON ai4_r18_offline_saga WHEN OLD.status IN ('observed_local','review_only') OR OLD.environment<>NEW.environment OR OLD.event_id<>NEW.event_id OR OLD.member_ref<>NEW.member_ref OR OLD.auth_version<>NEW.auth_version OR OLD.policy_revision<>NEW.policy_revision OR NEW.attempt_count<OLD.attempt_count BEGIN SELECT RAISE(ABORT,'R18_IMMUTABLE_OR_UNAPPROVED_RESET'); END;",
 claim:"INSERT INTO ai4_r18_offline_saga (environment,event_id,member_ref,auth_version,policy_revision,status,lease_token,lease_until_sec,attempt_count) VALUES (?,?,?,?,?,'leased',?,?,1) ON CONFLICT(environment,event_id) DO UPDATE SET status='leased',lease_token=excluded.lease_token,lease_until_sec=excluded.lease_until_sec,attempt_count=ai4_r18_offline_saga.attempt_count+1 WHERE ai4_r18_offline_saga.status IN ('leased','retry') AND ai4_r18_offline_saga.lease_until_sec<=? AND ai4_r18_offline_saga.attempt_count<3 AND ai4_r18_offline_saga.member_ref=excluded.member_ref AND ai4_r18_offline_saga.auth_version=excluded.auth_version AND ai4_r18_offline_saga.policy_revision=excluded.policy_revision RETURNING environment,event_id,member_ref,auth_version,policy_revision,status,lease_token,lease_until_sec,attempt_count",
 read:"SELECT environment,event_id,member_ref,auth_version,policy_revision,status,lease_token,lease_until_sec,attempt_count FROM ai4_r18_offline_saga WHERE environment=? AND event_id=?",
 conclude:"UPDATE ai4_r18_offline_saga SET status=?,lease_token=NULL,lease_until_sec=? WHERE environment=? AND event_id=? AND member_ref=? AND status='leased' AND lease_token=? AND lease_until_sec>=? RETURNING environment,event_id,member_ref,auth_version,policy_revision,status,lease_token,lease_until_sec,attempt_count"
});
export type R18SqlitePort=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...args:(string|number)[])=>Readonly<{first:<T extends object>()=>Promise<T|null>}>
}>}>;
export type R18OfflineSagaPorts=Readonly<{
 db:R18SqlitePort;
 readWitness:(eventRef:string)=>Promise<unknown>;
 verifyOfflineSignature:(witness:Witness)=>Promise<boolean>;
 readPolicy:()=>Promise<unknown>;
 reviewExistingR17:(eventRef:string,nowSec:number)=>Promise<OfflineFanoutResult>;
 readOwnerSink:(domain:Domain,eventRef:string)=>Promise<unknown>;
 nowSec:()=>number;
}>;
export type R18SagaResult=Readonly<{
 status:'blocked'|'retry'|'observed_local'|'duplicate_local'|'review_only';
 reason:string;attempt_count:number;
 may_ack_queue:false;may_dlq:false;may_release_task:false;
 may_regrant:false;may_restore:false;publishable:false;live:false;
}>;
function outcome(status:R18SagaResult['status'],reason:string,attempt=0):R18SagaResult{
 return Object.freeze({status,reason,attempt_count:attempt,may_ack_queue:false,
  may_dlq:false,may_release_task:false,may_regrant:false,may_restore:false,
  publishable:false,live:false});
}
function witness(raw:unknown,scope:Scope,eventRef:string,pinned:string):Witness|null{
 const row=exact(raw,WITNESS);
 return row&&row.brand_id==='starry'&&row.environment===scope.environment&&
 row.event_id===eventRef&&row.policy_revision===pinned&&
 typeof row.member_ref==='string'&&MEMBER.test(row.member_ref)&&
 integer(row.auth_version,2)&&typeof row.signature==='string'&&
 /^[A-Za-z0-9_-]{20,2048}$/.test(row.signature)
 ?{brand_id:'starry',environment:scope.environment,event_id:eventRef,
  policy_revision:pinned,member_ref:row.member_ref,auth_version:row.auth_version,
  signature:row.signature}:null;
}
function policyValid(raw:unknown,pinned:string):boolean{
 const p=exact(raw,['revision','processing_approved']);
 return !!p&&p.revision===pinned&&p.processing_approved===true;
}
function rowValid(raw:unknown,source:Witness):Journal|null{
 const row=exact(raw,ROW);
 return row&&row.environment===source.environment&&row.event_id===source.event_id&&
 row.member_ref===source.member_ref&&row.auth_version===source.auth_version&&
 row.policy_revision===source.policy_revision&&
 integer(row.attempt_count,1)&&row.attempt_count<=3&&integer(row.lease_until_sec)&&
 ['leased','retry','observed_local','review_only'].includes(String(row.status))&&
 (row.status==='leased'
 ?typeof row.lease_token==='string'&&/^[a-f0-9]{32}$/.test(row.lease_token)
 :row.lease_token===null) ?row:null;
}
function sinkValid(raw:unknown,domain:Domain,source:Witness):boolean{
 const x=exact(raw,SINK);
 return !!x&&x.sink===domain&&x.brand_id==='starry'&&
 x.environment===source.environment&&x.event_id===source.event_id&&
 x.member_ref===source.member_ref&&x.auth_version===source.auth_version&&
 x.policy_revision===source.policy_revision&&x.source_event_ref===source.event_id&&
 x.committed===true&&x.inbox_applied===true&&x.pending_holds===0&&
 x.active_entitlements===0&&x.task_released===false;
}
function r17Valid(value:unknown):boolean{
 const r=exact(value,['status','reason','may_ack_queue','may_dlq','may_regrant',
  'may_release_task','publishable','live']);
 return !!r&&r.status==='candidate_consistent'&&
 r.may_ack_queue===false&&r.may_dlq===false&&r.may_regrant===false&&
 r.may_release_task===false&&r.publishable===false&&r.live===false&&
 r.reason==='ONLY_LOCAL_CANDIDATE_NOT_AN_ACK';
}
/** AI-4 writes only its disposable coordinator SQLite; domain sinks are read-only. */
export function createR18OfflineSagaTransport(scope:Scope,pinnedPolicy:string,ports:R18OfflineSagaPorts){
 const s=exact(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(String(s.environment)))
  throw Error('AI4_R18_SCOPE_DENIED');
 if(typeof pinnedPolicy!=='string'||!POLICY.test(pinnedPolicy))
  throw Error('AI4_R18_POLICY_REQUIRED');
 if(!ports||typeof ports.db?.prepare!=='function'||
  typeof ports.readWitness!=='function'||typeof ports.verifyOfflineSignature!=='function'||
  typeof ports.readPolicy!=='function'||typeof ports.reviewExistingR17!=='function'||
  typeof ports.readOwnerSink!=='function'||typeof ports.nowSec!=='function')
  throw Error('AI4_R18_PORTS_REQUIRED');
 const stable:Scope=Object.freeze({brand_id:'starry',
  environment:s.environment as 'development'|'staging'});
 const read=(e:Witness)=>ports.db.prepare(R18_DISPOSABLE_TRANSPORT_SQL.read)
  .bind(e.environment,e.event_id).first<Journal>();
 const validated=async(ref:string):Promise<Witness|null>=>{
  if(!policyValid(await ports.readPolicy(),pinnedPolicy))return null;
  const w=witness(await ports.readWitness(ref),stable,ref,pinnedPolicy);
  if(!w||await ports.verifyOfflineSignature(w)!==true)return null;
  return w;
 };
 const allSinks=async(w:Witness):Promise<boolean>=>{
  for(const domain of DOMAINS){
   if(!sinkValid(await ports.readOwnerSink(domain,w.event_id),domain,w))return false;
  }
  return true;
 };
 return Object.freeze({
  async inspect(eventRef:unknown,serverNowSec:unknown):Promise<R18SagaResult>{
   if(typeof eventRef!=='string'||!EVENT.test(eventRef)||
    !integer(serverNowSec,1)||!integer(serverNowSec*1000))
    return outcome('blocked','INVALID_EVENT_OR_CLOCK');
   try{
    const src=await validated(eventRef);
    if(!src)return outcome('blocked','UNTRUSTED_AUTH_SOURCE_OR_POLICY');
    const previous=rowValid(await read(src),src);
    if(previous?.status==='review_only')
     return outcome('review_only','LOCAL_DLQ_REVIEW_ONLY_NO_QUEUE_CALL',Number(previous.attempt_count));
    if(previous?.status==='observed_local'){
     if(!r17Valid(await ports.reviewExistingR17(eventRef,serverNowSec))||
      !await allSinks(src)||!await validated(eventRef))
      return outcome('review_only','PREVIOUS_SINK_OR_AUTH_RECEIPT_NO_LONGER_VALID',Number(previous.attempt_count));
     return outcome('duplicate_local','QUEUE_ACK_LOST_REDELIVERY_LOCAL_ONLY',Number(previous.attempt_count));
    }
    const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),
     n=>n.toString(16).padStart(2,'0')).join('');
    const until=serverNowSec+30;
    if(!integer(until))return outcome('blocked','LEASE_TIME_OVERFLOW');
    const claimed=rowValid(await ports.db.prepare(R18_DISPOSABLE_TRANSPORT_SQL.claim)
     .bind(src.environment,src.event_id,src.member_ref,src.auth_version,
      src.policy_revision,token,until,serverNowSec)
     .first<Journal>(),src);
    if(!claimed||claimed.status!=='leased'||claimed.lease_token!==token)
     return outcome('retry','ACTIVE_LEASE_OR_PINNED_SOURCE_CONFLICT',Number(previous?.attempt_count??0));
    const attempt=Number(claimed.attempt_count);
    let valid=false;
    try{
     valid=r17Valid(await ports.reviewExistingR17(eventRef,serverNowSec))&&
      await allSinks(src);
     if(valid){
      const fresh=await validated(eventRef);
      valid=!!fresh&&fresh.member_ref===src.member_ref&&
       fresh.auth_version===src.auth_version&&fresh.signature===src.signature&&
       await allSinks(src);
     }
    }catch{valid=false;}
    const clock=ports.nowSec();
    if(!integer(clock,serverNowSec)||clock>until)
     return outcome('retry','LEASE_EXPIRED_OR_CLOCK_REGRESSED',attempt);
    const next=valid?'observed_local':attempt>=3?'review_only':'retry';
    const backoff=valid?0:next==='review_only'?0:2**attempt;
    const due=clock+backoff;
    if(!integer(due))return outcome('retry','RETRY_CLOCK_OVERFLOW',attempt);
    const saved=rowValid(await ports.db.prepare(R18_DISPOSABLE_TRANSPORT_SQL.conclude)
     .bind(next,due,src.environment,src.event_id,src.member_ref,token,clock)
     .first<Journal>(),src);
    if(!saved||saved.status!==next)return outcome('retry','FENCED_LOCAL_CAS_NOT_CONFIRMED',attempt);
    const current=rowValid(await read(src),src);
    if(!current||current.status!==next||!policyValid(await ports.readPolicy(),pinnedPolicy))
     return outcome('review_only','POSTCOMMIT_LOCAL_OR_POLICY_DRIFT',attempt);
    if(next==='observed_local'){
     const fresh=await validated(eventRef);
     if(!fresh||fresh.signature!==src.signature||!await allSinks(src))
      return outcome('review_only','POSTCOMMIT_SINK_OR_AUTH_DRIFT',attempt);
     return outcome('observed_local','CANDIDATE_SINK_RECEIPTS_ONLY_NOT_ACK',attempt);
    }
    return next==='review_only'
     ?outcome('review_only','MAX_LOCAL_RETRIES_REQUIRES_HUMAN_REVIEW_NO_DLQ_SEND',attempt)
     :outcome('retry','PARTIAL_OR_UNVERIFIED_SINK_BACKOFF',attempt);
   }catch{return outcome('retry','OFFLINE_PORT_UNAVAILABLE_NO_QUEUE_OPERATION');}
  }
 });
}
