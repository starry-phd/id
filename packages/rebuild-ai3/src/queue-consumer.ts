/**
 * AI-3 Round 3: offline Starry audit Queue consumer candidate.
 * The only possible deployment wiring belongs to AI-4 after AI-0 Gate.
 * No network, Queue, D1 writes, billing rights or token verification here.
 */
import {assertScope,CANDIDATE_VERSION,isAuditMetadata,rfc3339,retryPlan} from './index.ts';
import type {AuditMetadata,Scope} from './index.ts';

export type BillingP05=Readonly<{
 brand_id:'starry';app_id:string;environment:'development'|'staging';
 schema_version:string;event_id:string;event_type:'billing.store_state_observed';
 occurred_at:string;correlation_id:string;idempotency_key:string;
 actor_ref:string;resource_ref:string;result:'recorded';classification:'metadata_only';
}>;
export type VerifiedOutboxRecord=Readonly<{
 p05:unknown;payload_digest:string;
 committed:true;provider_verified:true;
}>;
/** AI-0 sole canonical validator; MUST originate in server-owned composition. */
export type Ai0P05Authority=Readonly<{
 schemaVersion:string;
 accepts:(scope:Scope,event:BillingP05)=>Promise<boolean>;
}>;
/**
 * AI-2 committed-outbox gateway.  This port MUST read authoritative Billing
 * transaction committed after provider verification.  Client booleans or
 * copied AI-2 plan output cannot satisfy this trust boundary in production.
 */
export type BillingCommittedReader=Readonly<{
 readAfterCommit:(eventRef:string)=>Promise<unknown>;
}>;
export type Claim=Readonly<{
 scope:Scope;key:string;eventId:string;digest:string;event:AuditMetadata;
}>;
export type ClaimOutcome='inserted'|'duplicate'|'conflict';
/**
 * Atomic implementation required for AI-3-owned D1:
 * compare digest + unique claim + append audit in ONE D1 transaction.
 * Return 'duplicate' only if stored event_id + digest match exactly.
 */
export type Ai3InboxStore=Readonly<{
 claimAndAppendAtomically:(claim:Claim)=>Promise<ClaimOutcome>;
 recordQuarantine:(scope:Scope,eventRef:string,reason:string)=>Promise<void>;
}>;
/** Issued by AI-2 authoritative post-commit provider+entitlement snapshot only. */
export type BillingSourceOrderPort=Readonly<{
 afterCommitOrder:(scope:Scope,key:string)=>Promise<'current'|'superseded'|'unknown'>;
}>;
export type QueueDecision=Readonly<{
 outcome:'ack'|'quarantine_recorded'|'retry'|'dlq_required'|'hold';
 ack_safe:boolean;reason:string;retry_after_ms:number;
}>;
const SAFE_KEY=/^b_[a-f0-9]{64}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const ACTOR=/^(anon|actor|audit|opaque)_[A-Za-z0-9._:-]{1,120}$/;
const P05_FIELDS=new Set([
 'brand_id','app_id','environment','schema_version','event_id','event_type',
 'occurred_at','correlation_id','idempotency_key','actor_ref','resource_ref',
 'result','classification',
]);
function dataRecord(v:unknown):v is Record<string,unknown>{
 if(v===null||typeof v!=='object')return false;
 try{
  if(Array.isArray(v))return false;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return false;
  const keys=Reflect.ownKeys(v);
  return keys.every(k=>{
   const d=Object.getOwnPropertyDescriptor(v,k);
   return typeof k==='string'&&d!==undefined&&d.enumerable&&'value' in d;
  });
 }catch{return false;}
}
/** AI-2 P05 candidate format. NOT an AI-0 approved version declaration. */
export function isBillingP05ForGate(v:unknown,scope:Scope,version:string):v is BillingP05{
 try{
  if(!dataRecord(v)||!SAFE_KEY.test(String(v.idempotency_key))
    ||Reflect.ownKeys(v).length!==P05_FIELDS.size
    ||Reflect.ownKeys(v).some(k=>!P05_FIELDS.has(String(k))))return false;
  return scope.brand_id==='starry'
   &&(scope.environment==='development'||scope.environment==='staging')
   &&v.brand_id==='starry'&&v.app_id===scope.app_id
   &&v.environment===scope.environment&&v.schema_version===version
   &&v.event_type==='billing.store_state_observed'
   &&v.event_id===v.idempotency_key&&v.resource_ref===v.idempotency_key
   &&v.correlation_id===v.idempotency_key
   &&v.classification==='metadata_only'&&v.result==='recorded'
   &&typeof v.actor_ref==='string'&&ACTOR.test(v.actor_ref)
   &&rfc3339(v.occurred_at);
 }catch{return false;}
}
function auditProjection(p:BillingP05):AuditMetadata{
 const projected:AuditMetadata=Object.freeze({
  brand_id:p.brand_id,app_id:p.app_id,environment:p.environment,
  schema_version:CANDIDATE_VERSION,event_id:p.event_id,
  event_type:p.event_type,occurred_at:p.occurred_at,
  correlation_id:p.correlation_id,idempotency_key:p.idempotency_key,
  actor_ref:p.actor_ref,resource_ref:p.resource_ref,result:'recorded',
  classification:'metadata_only',
 });
 if(!isAuditMetadata(projected))throw new Error('AI3_REDACTION_FAILURE');
 return projected;
}
const outcome=(name:QueueDecision['outcome'],reason:string,ms=0):QueueDecision=>
 Object.freeze({outcome:name,ack_safe:name==='ack'||name==='quarantine_recorded',reason,retry_after_ms:ms});
/** Plans acknowledgments only. Never invokes Cloudflare Queue ack/retry/DLQ. */
export function createReliableBillingAuditConsumer(
 scope:Scope,authority:Ai0P05Authority,source:BillingCommittedReader,store:Ai3InboxStore,
 order?:BillingSourceOrderPort,
){
 assertScope(scope,scope);
 // Fail closed. A real AI-0 version+validator must be supplied; no candidate
 // may be promoted by importing this module alone.
 return Object.freeze({
  async consume(eventRef:unknown,attempt:unknown):Promise<QueueDecision>{
   if(typeof eventRef!=='string'||!SAFE_KEY.test(eventRef)
     ||!Number.isSafeInteger(attempt)||typeof attempt!=='number'
     ||attempt<1||attempt>5)return outcome('hold','INVALID_QUEUE_DELIVERY');
   if(typeof authority.schemaVersion!=='string'||!authority.schemaVersion
     ||typeof authority.accepts!=='function')
     return outcome('hold','NO_CANONICAL_AUTHORITY');
   const defer=(reason:string):QueueDecision=>{
    const retry=retryPlan({attempt,failure:'network',idempotency_key:eventRef});
    return retry.decision==='retry'?outcome('retry',reason,retry.delay_ms)
      :outcome('dlq_required',reason);
   };
   // Bad/conflicting records need a durable quarantine record BEFORE ACK.
   const quarantine=async(reason:string):Promise<QueueDecision>=>{
    try {
     await store.recordQuarantine(scope,eventRef,reason);
     return outcome('quarantine_recorded',reason);
    }catch{return defer('QUARANTINE_WRITE_FAILED');}
   };
   let record:unknown;
   try{record=await source.readAfterCommit(eventRef)}
   catch{return defer('SOURCE_UNAVAILABLE');}
   // AI-2 readAfterCommit() legitimately returns null when an outbox transaction
   // is not yet visible. This is an at-least-once consistency window, not a
   // forged event: retry/DLQ WITHOUT quarantining or ACKing the Queue message.
   if(record===null||record===undefined)return defer('SOURCE_NOT_YET_COMMITTED');
   if(!dataRecord(record)||record.committed!==true
     ||record.provider_verified!==true
     ||typeof record.payload_digest!=='string'||!DIGEST.test(record.payload_digest))
     return quarantine('UNVERIFIED_OR_UNCOMMITTED_SOURCE');
   if(!isBillingP05ForGate(record.p05,scope,authority.schemaVersion)
     ||record.p05.idempotency_key!==eventRef)
     return quarantine('P05_SCOPE_VERSION_OR_FIELDS_DENIED');
   let approved=false;
   try{approved=await authority.accepts(scope,record.p05)}
   catch{return defer('CANONICAL_VALIDATOR_UNAVAILABLE');}
   if(!approved)return quarantine('AI0_P05_NOT_APPROVED');
   if(order){
    let freshness:'current'|'superseded'|'unknown';
    try{freshness=await order.afterCommitOrder(scope,eventRef);}
    catch{return defer('BILLING_ORDER_UNAVAILABLE');}
    if(freshness==='superseded')return quarantine('STALE_BILLING_EVENT');
    if(freshness!=='current')return defer('BILLING_ORDER_UNCERTAIN');
   }
   let audit:AuditMetadata;
   try{audit=auditProjection(record.p05)}
   catch{return quarantine('AUDIT_FIELDS_DENIED');}
   try{
    const status=await store.claimAndAppendAtomically(Object.freeze({
     scope,key:eventRef,eventId:audit.event_id,digest:record.payload_digest,event:audit,
    }));
    if(status==='inserted')return outcome('ack','AUDIT_ATOMICALLY_COMMITTED');
    if(status==='duplicate')return outcome('ack','ALREADY_COMMITTED_SAME_EVENT');
    if(status==='conflict')return quarantine('IDEMPOTENCY_DIGEST_CONFLICT');
    return defer('INVALID_STORAGE_RECEIPT');
   }catch{return defer('ATOMIC_INBOX_WRITE_FAILED');}
  },
 });
}


/** Fourth-round strict constructor: AI-2 server-only temporal proof is mandatory. */
export function createRound4BillingAuditConsumer(
 scope:Scope,authority:Ai0P05Authority,source:BillingCommittedReader,
 store:Ai3InboxStore,order:BillingSourceOrderPort,
){
 if(!order||typeof order.afterCommitOrder!=='function')
  throw new Error('AI3_BILLING_ORDER_AUTHORITY_REQUIRED');
 return createReliableBillingAuditConsumer(scope,authority,source,store,order);
}
