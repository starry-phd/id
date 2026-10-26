/**
 * AI-3 Round4: D1-shaped Starry-only inbox & audit persistence candidate.
 * No binding, migration, credentials or live D1 operations are created here.
 * Cloudflare D1Database.batch() is the ONLY atomic write boundary.
 */
import {assertEvent,assertScope,CANDIDATE_VERSION} from './index.ts';
import type {Scope} from './index.ts';
import type {Claim,ClaimOutcome,Ai3InboxStore} from './queue-consumer.ts';

export type D1Param=string|number|null;
export interface D1Prepared {
 bind(...values:D1Param[]):D1Prepared;
}
export type D1BatchReceipt=Readonly<{
 success:boolean;meta?:Readonly<{changes?:number}>;results?:unknown[];
}>;
export interface D1DatabasePort {
 prepare(sql:string):D1Prepared;
 batch(statements:D1Prepared[]):Promise<D1BatchReceipt[]>;
}
const KEY=/^b_[a-f0-9]{64}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const QUARANTINE_REASONS=new Set([
 'UNVERIFIED_OR_UNCOMMITTED_SOURCE','P05_SCOPE_VERSION_OR_FIELDS_DENIED',
 'AI0_P05_NOT_APPROVED','AUDIT_FIELDS_DENIED','IDEMPOTENCY_DIGEST_CONFLICT',
 'STALE_BILLING_EVENT',
]);
function ensure(ok:unknown,code:string):asserts ok{
 if(!ok)throw new Error(code);
}
function same(row:unknown,expected:Readonly<Record<string,string>>):boolean{
 if(!row||typeof row!=='object'||Array.isArray(row))return false;
 const actual=row as Record<string,unknown>;
 return Object.entries(expected).every(([k,v])=>actual[k]===v);
}
function single(rows:unknown):unknown{
 return Array.isArray(rows)&&rows.length===1?rows[0]:null;
}
function receipts(rows:unknown,size:number):asserts rows is D1BatchReceipt[]{
 ensure(Array.isArray(rows)&&rows.length===size,'AI3_D1_TRANSACTION_UNCERTAIN');
 ensure(rows.every(r=>r&&r.success===true&&Array.isArray(r.results)),
   'AI3_D1_TRANSACTION_UNCERTAIN');
}
/** Unlike a two-call read/insert, the entire sequence is one batch transaction. */
export function createAi3AuditD1Store(db:D1DatabasePort,serverScope:Scope):Ai3InboxStore{
 assertScope(serverScope,serverScope);
 ensure(serverScope.environment!=='production','AI3_D1_DRAFT_ONLY');
 return Object.freeze({
  async claimAndAppendAtomically(c:Claim):Promise<ClaimOutcome>{
   assertScope(serverScope,c.scope);
   assertEvent(serverScope,c.event);
   ensure(c.event.schema_version===CANDIDATE_VERSION
     &&c.event.event_type==='billing.store_state_observed'
     &&typeof c.key==='string'&&KEY.test(c.key)
     &&typeof c.digest==='string'&&DIGEST.test(c.digest)
     &&c.eventId===c.key&&c.event.event_id===c.key
     &&c.event.idempotency_key===c.key
     &&c.event.resource_ref===c.key
     &&c.event.correlation_id===c.key,'AI3_D1_INVALID_CLAIM');
   const s=c.scope,e=c.event;
   const q1=db.prepare(
    'INSERT INTO ai3_r4_inbox (brand_id,app_id,environment,idempotency_key,event_id,payload_digest) '
    +'VALUES (?,?,?,?,?,?) ON CONFLICT(brand_id,app_id,environment,idempotency_key) DO NOTHING'
   ).bind(s.brand_id,s.app_id,s.environment,c.key,c.eventId,c.digest);
   const q2=db.prepare(
    'INSERT INTO ai3_r4_audit (brand_id,app_id,environment,event_id,idempotency_key,schema_version,'
    +'event_type,occurred_at,actor_ref,resource_ref,classification,result) '
    +'SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS '
    +'(SELECT 1 FROM ai3_r4_inbox WHERE brand_id=? AND app_id=? AND environment=? '
    +'AND idempotency_key=? AND event_id=? AND payload_digest=?) '
    +'ON CONFLICT(brand_id,app_id,environment,event_id) DO NOTHING'
   ).bind(s.brand_id,s.app_id,s.environment,c.eventId,c.key,e.schema_version,
    e.event_type,e.occurred_at,e.actor_ref,e.resource_ref,e.classification,e.result,
    s.brand_id,s.app_id,s.environment,c.key,c.eventId,c.digest);
   const q3=db.prepare(
    'SELECT event_id,payload_digest FROM ai3_r4_inbox '
    +'WHERE brand_id=? AND app_id=? AND environment=? AND idempotency_key=?'
   ).bind(s.brand_id,s.app_id,s.environment,c.key);
   const q4=db.prepare(
    'SELECT event_id,idempotency_key,schema_version,event_type,occurred_at,'
    +'actor_ref,resource_ref,classification,result FROM ai3_r4_audit '
    +'WHERE brand_id=? AND app_id=? AND environment=? AND event_id=?'
   ).bind(s.brand_id,s.app_id,s.environment,c.eventId);
   const rows=await db.batch([q1,q2,q3,q4]);
   receipts(rows,4);
   const claimRow=single(rows[2].results);
   // Conflict MUST NOT be treated as duplicate, even if an audit row exists.
   if(!claimRow)return 'conflict';
   if(!same(claimRow,{event_id:c.eventId,payload_digest:c.digest}))return 'conflict';
   const auditRow=single(rows[3].results);
   ensure(same(auditRow,{
    event_id:c.eventId,idempotency_key:c.key,schema_version:e.schema_version,
    event_type:e.event_type,occurred_at:e.occurred_at,actor_ref:e.actor_ref,
    resource_ref:e.resource_ref,classification:e.classification,result:e.result,
   }),'AI3_D1_AUDIT_NOT_DURABLE');
   const claimChanges=rows[0].meta?.changes;
   const auditChanges=rows[1].meta?.changes;
   if(claimChanges===1&&auditChanges===1)return 'inserted';
   if(claimChanges===0&&auditChanges===0)return 'duplicate';
   throw new Error('AI3_D1_PARTIAL_RECEIPT');
  },
  async recordQuarantine(scope:Scope,eventRef:string,reason:string):Promise<void>{
   assertScope(serverScope,scope);
   ensure(KEY.test(eventRef)&&QUARANTINE_REASONS.has(reason),'AI3_D1_QUARANTINE_DENIED');
   // Deterministic, append-only minimal reason code; no raw provider payload.
   const sql=db.prepare(
    'INSERT INTO ai3_r4_quarantine (brand_id,app_id,environment,idempotency_key,reason) '
    +'VALUES (?,?,?,?,?) ON CONFLICT(brand_id,app_id,environment,idempotency_key,reason) DO NOTHING'
   ).bind(scope.brand_id,scope.app_id,scope.environment,eventRef,reason);
   const read=db.prepare(
    'SELECT reason FROM ai3_r4_quarantine WHERE brand_id=? AND app_id=? AND environment=? '
    +'AND idempotency_key=? AND reason=?'
   ).bind(scope.brand_id,scope.app_id,scope.environment,eventRef,reason);
   const rows=await db.batch([sql,read]);
   receipts(rows,2);
   ensure(same(single(rows[1].results),{reason}),'AI3_D1_QUARANTINE_NOT_DURABLE');
  },
 });
}
