/**
 * Starry BILL-001 Round4 sandbox D1 transaction candidate.
 * Not bound to any deployed Workers/D1. Test-generated HMAC keys only.
 * Requires unapplied schema/0004_billing_atomic_DRAFT.sql.
 */
import {isServerBillingPlan} from './index.ts';
import type {BillingP05Candidate,EntitlementProjection,ServerRegistry} from './index.ts';
type V=string|number|null;
type Row=Record<string,unknown>;
export interface Prepared {bind(...args:V[]):Prepared;first<T extends Row>():Promise<T|null>;}
export interface D1Shape {prepare(sql:string):Prepared;batch(statements:Prepared[]):Promise<readonly unknown[]>;}
export type Scope=Pick<ServerRegistry,'brandId'|'appId'|'environment'|'storeEnvironment'|'store'|'storeAppId'>;
export type CommittedRecord=Readonly<{
 p05:BillingP05Candidate;payload_digest:string;committed:true;provider_verified:true;
}>;
const ID=/^[A-Za-z0-9._:-]{1,180}$/;
const KEY=/^b_[a-f0-9]{64}$/;
const DIGEST=/^[a-f0-9]{64}$/;
function enforce(ok:unknown,msg:string):asserts ok {if(!ok)throw new Error(msg);}
export const ATOMIC_SQL=Object.freeze({
 owner:[
 'INSERT INTO billing_owner (owner_key,brand_id,app_id,environment,store_environment,store,store_app_id,',
 'original_transaction_id,s_user_id,binding_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
 'ON CONFLICT(owner_key) DO NOTHING',
 ].join(' '),
 event:[
 'INSERT INTO billing_event (idempotency_key,owner_key,provider_event_ref,payload_digest,transaction_ref,sku,state,occurred_at,created_at)',
 'VALUES (?,(SELECT owner_key FROM billing_owner WHERE owner_key=? AND s_user_id=? AND binding_digest=?',
 'AND brand_id=? AND app_id=? AND environment=? AND store_environment=? AND store=? AND store_app_id=?),?,?,?,?,?,?,?)',
 ].join(' '),
 entitlement:[
 'INSERT INTO billing_entitlement (owner_key,entitlement_key,s_user_id,app_id,status,period_started_at,',
 'last_effective_at,last_transaction_ref,valid_until,version,applied_event_key)',
 'VALUES (?,?,?,?,?,?,?,?,?,1,?)',
 'ON CONFLICT(owner_key,entitlement_key) DO UPDATE SET',
 'status=excluded.status,period_started_at=excluded.period_started_at,',
 'last_effective_at=excluded.last_effective_at,last_transaction_ref=excluded.last_transaction_ref,',
 'valid_until=excluded.valid_until,version=billing_entitlement.version+1,',
 'applied_event_key=excluded.applied_event_key',
 'WHERE billing_entitlement.version=? AND billing_entitlement.s_user_id=excluded.s_user_id',
 'AND billing_entitlement.app_id=excluded.app_id',
 'AND billing_entitlement.period_started_at<=excluded.period_started_at',
 'AND billing_entitlement.last_effective_at<=excluded.last_effective_at',
 ].join(' '),
 outbox:[
 'INSERT INTO billing_outbox (idempotency_key,event_type,app_id,environment,store_environment,',
 'safe_payload_json,created_at) VALUES (?,?,?,?,?,?,?)',
 ].join(' '),
 guard:[
 'INSERT INTO billing_atomic_receipt (idempotency_key,verified_provider,guard_applied,created_at)',
 'VALUES (?,1,CASE WHEN EXISTS(SELECT 1 FROM billing_entitlement',
 'WHERE owner_key=? AND entitlement_key=? AND s_user_id=? AND app_id=?',
 'AND version=? AND applied_event_key=?)',
 'AND EXISTS(SELECT 1 FROM billing_event WHERE idempotency_key=? AND payload_digest=?)',
 'AND EXISTS(SELECT 1 FROM billing_outbox WHERE idempotency_key=?)',
 'THEN 1 ELSE 0 END,?)',
 ].join(' '),
});
function equalPrior(row:Row|null,p:EntitlementProjection|null,priorRef:string|null):boolean{
 if(p===null)return row===null;
 return row!==null && Number.isSafeInteger(row.version)&&Number(row.version)>0
  && row.s_user_id===p.userId&&row.app_id===p.appId&&row.status===p.right
  && row.period_started_at===p.periodStartedAt&&row.last_effective_at===p.lastEffectiveAt
  && row.last_transaction_ref===priorRef&&row.valid_until===p.validUntil;
}
export function createSandboxBillingD1Writer(deps:Readonly<{
 db:D1Shape;scope:Scope;hmacKey:CryptoKey;
}>){
 const {db,scope,hmacKey}=deps;
 enforce(scope.brandId==='starry' && (scope.environment==='development'||scope.environment==='staging')
  &&scope.storeEnvironment==='sandbox'&&(scope.store==='apple'||scope.store==='google')
  &&ID.test(scope.appId)&&ID.test(scope.storeAppId),'BILLING_D1_SCOPE_DENIED');
 enforce(hmacKey.type==='secret'&&hmacKey.algorithm.name==='HMAC'&&hmacKey.usages.includes('sign'),
  'BILLING_HMAC_DENIED');
 const hmac=async(label:string,value:string):Promise<string>=>{
  const signature=await crypto.subtle.sign('HMAC',hmacKey,new TextEncoder().encode(
   JSON.stringify([label,scope.appId,scope.environment,value])));
  return Array.from(new Uint8Array(signature),n=>n.toString(16).padStart(2,'0')).join('');
 };
 const query=<T extends Row>(sql:string,...bind:V[])=>db.prepare(sql).bind(...bind).first<T>();
 const ownerKey=(store:string,app:string,original:string)=>hmac('billing-owner-v1',[store,app,original].join('|')).then(x=>'o_'+x);
 const bindingHash=(binding:string)=>hmac('billing-binding-v1',binding);
 const txRef=(id:string)=>hmac('billing-transaction-v1',id);
 const readAfterCommit=async(ref:unknown):Promise<CommittedRecord|null>=>{
  enforce(typeof ref==='string'&&KEY.test(ref),'BILLING_COMMITTED_REF_DENIED');
  const row=await query<Row>([
    'SELECT r.verified_provider,r.guard_applied,e.payload_digest,o.brand_id,o.app_id,o.environment,',
    'b.safe_payload_json FROM billing_atomic_receipt r',
    'JOIN billing_event e ON e.idempotency_key=r.idempotency_key',
    'JOIN billing_owner o ON o.owner_key=e.owner_key',
    'JOIN billing_outbox b ON b.idempotency_key=r.idempotency_key',
    'WHERE r.idempotency_key=? AND o.app_id=? AND o.environment=?',
   ].join(' '),ref,scope.appId,scope.environment);
  if(!row)return null;
  enforce(row.verified_provider===1&&row.guard_applied===1&&row.brand_id==='starry'
   &&row.app_id===scope.appId&&row.environment===scope.environment
   &&typeof row.payload_digest==='string'&&DIGEST.test(row.payload_digest),
   'BILLING_COMMITTED_PROOF_DENIED');
  let value:unknown;
  try{value=JSON.parse(String(row.safe_payload_json));}catch{throw new Error('BILLING_COMMITTED_EVENT_DENIED');}
  const p05=value as BillingP05Candidate;
  enforce(value!==null&&typeof value==='object'&&!Array.isArray(value)
   &&p05.event_id===ref&&p05.idempotency_key===ref&&p05.brand_id==='starry'
   &&p05.app_id===scope.appId&&p05.environment===scope.environment
   &&p05.event_type==='billing.store_state_observed'
   &&p05.schema_version==='billing.p05.v1-candidate','BILLING_COMMITTED_EVENT_DENIED');
  return Object.freeze({p05:Object.freeze({...p05}),payload_digest:row.payload_digest,
   committed:true as const,provider_verified:true as const});
 };
 return Object.freeze({
  readAfterCommit,
  async commit(plan:unknown,now:string){
   enforce(isServerBillingPlan(plan),'BILLING_UNISSUED_PLAN');
   const {snapshot:s,entitlement:e,previousEntitlement:prior,owner,p05,outbox}=plan;
   enforce(KEY.test(plan.idempotencyKey)&&DIGEST.test(plan.payloadDigest)
    &&s.brandId==='starry'&&s.appId===scope.appId&&s.store===scope.store
    &&s.storeEnvironment==='sandbox'&&s.storeAppId===scope.storeAppId
    &&owner.userId===e.userId&&owner.accountBinding===s.accountBinding
    &&e.appId===scope.appId&&!/battery/i.test(s.sku)&&p05.event_id===plan.idempotencyKey
    &&p05.idempotency_key===plan.idempotencyKey&&p05.brand_id==='starry'
    &&p05.app_id===scope.appId&&p05.environment===scope.environment
    &&p05.schema_version==='billing.p05.v1-candidate'
    &&p05.actor_ref!==owner.userId&&p05.actor_ref!==owner.accountBinding
    &&outbox.idempotencyKey===plan.idempotencyKey,'BILLING_PLAN_SCOPE_DENIED');
   const clock=Date.parse(now);
   enforce(Number.isFinite(clock)&&new Date(clock).toISOString()===now,'BILLING_CLOCK_DENIED');
   const key=await ownerKey(s.store,s.storeAppId,s.originalTransactionId);
   const bindDigest=await bindingHash(owner.accountBinding);
   const current=await query<Row>([
    'SELECT version,s_user_id,app_id,status,period_started_at,last_effective_at,',
    'last_transaction_ref,valid_until FROM billing_entitlement',
    'WHERE owner_key=? AND entitlement_key=?'].join(' '),key,s.sku);
   const prevRef=prior?await txRef(prior.transactionId):null;
   enforce(equalPrior(current,prior,prevRef),'BILLING_CAS_STALE_PLAN');
   const existing=await query<Row>([
    'SELECT e.payload_digest,o.s_user_id,o.binding_digest FROM billing_event e',
    'JOIN billing_owner o ON o.owner_key=e.owner_key WHERE e.idempotency_key=?',
   ].join(' '),plan.idempotencyKey);
   if(existing){
    enforce(existing.payload_digest===plan.payloadDigest&&existing.s_user_id===owner.userId
      &&existing.binding_digest===bindDigest,'BILLING_IDEMPOTENCY_CONFLICT');
    return Object.freeze({disposition:'duplicate' as const,eventRef:plan.idempotencyKey,right:null});
   }
   // Non-changing/historical events must be audit-only by a separately approved path.
   enforce(plan.entitlementChanged,'BILLING_HISTORICAL_AUDIT_GATE');
   const safePayload=JSON.stringify(p05);
   const allowedP05=new Set(['brand_id','app_id','environment','schema_version',
    'event_id','event_type','occurred_at','correlation_id','idempotency_key',
    'actor_ref','resource_ref','result','classification']);
   enforce(safePayload.length<=4096 && Object.keys(p05).length===13
    && Object.keys(p05).every(k=>allowedP05.has(k))
    && typeof p05.actor_ref==='string' && /^(anon|actor|audit|opaque)_[A-Za-z0-9._:-]{1,120}$/.test(p05.actor_ref)
    && p05.actor_ref!==owner.userId&&p05.actor_ref!==owner.accountBinding,
    'BILLING_OUTBOX_PII_DENIED');
   const statement=[
    db.prepare(ATOMIC_SQL.owner).bind(key,'starry',scope.appId,scope.environment,'sandbox',
      scope.store,scope.storeAppId,await hmac('billing-original-v1',s.originalTransactionId),
      owner.userId,bindDigest,now),
    db.prepare(ATOMIC_SQL.event).bind(plan.idempotencyKey,key,owner.userId,bindDigest,
      'starry',scope.appId,scope.environment,'sandbox',scope.store,scope.storeAppId,
      await hmac('billing-provider-event-v1',s.providerEventId),plan.payloadDigest,
      await txRef(s.transactionId),s.sku,s.state,s.effectiveAt,now),
    db.prepare(ATOMIC_SQL.entitlement).bind(key,s.sku,e.userId,e.appId,e.right,
      e.periodStartedAt,e.lastEffectiveAt,await txRef(e.transactionId),e.validUntil,
      plan.idempotencyKey,current?Number(current.version):0),
    db.prepare(ATOMIC_SQL.outbox).bind(plan.idempotencyKey,'billing.store_state_observed',
      scope.appId,scope.environment,'sandbox',safePayload,now),
    db.prepare(ATOMIC_SQL.guard).bind(plan.idempotencyKey,key,s.sku,e.userId,e.appId,
      current?Number(current.version)+1:1,plan.idempotencyKey,plan.idempotencyKey,
      plan.payloadDigest,plan.idempotencyKey,now),
   ];
   try {
    // D1 batch is documented transactional: any statement error rolls back ALL five.
    const result=await db.batch(statement);
    enforce(Array.isArray(result)&&result.length===5,'BILLING_COMMIT_UNCONFIRMED');
   }catch(e){throw new Error('BILLING_ATOMIC_BATCH_FAILED',{cause:e});}
   const committed=await readAfterCommit(plan.idempotencyKey);
   enforce(committed!==null&&committed.payload_digest===plan.payloadDigest,
    'BILLING_COMMIT_RECEIPT_DENIED');
   return Object.freeze({disposition:'committed' as const,eventRef:plan.idempotencyKey,right:e.right});
  },
 });
}
