import test from 'node:test';
import assert from 'node:assert/strict';
import {CANDIDATE_VERSION,EVENT_KINDS,isAuditMetadata,
  mapAi2OutboxToP05,bindBillingAuditBridge,retryPlan,BATTERY,
} from '../src/index.ts';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const hex='a'.repeat(64),hex2='b'.repeat(64);
const exampleOutbox=Object.freeze({
 eventId:'provider_evt_1',eventType:'billing.store_state_observed',brandId:'starry',
 appId:'starry-id',environment:'staging',storeEnvironment:'sandbox',
 idempotencyKey:'b_'+hex,correlationId:'b_'+hex,
 resourceType:'billing_transaction',resourceId:'provider_transaction_1',result:'observed',
});
const row=Object.freeze({
 outbox:exampleOutbox,occurred_at:'2026-10-26T07:00:00Z',
 source_event_ref:'a_'+hex,resource_ref:'r_'+hex2,
 payload_digest:hex2,committed:true,verified_provider:true,
});
const canonicalFields=Object.freeze([
 'event_id','event_type','schema_version','brand_id','app_id','environment',
 'occurred_at','correlation_id','resource_type','resource_id','result','idempotency_key',
].sort());
const fixture=()=> {
 let value=row,current=null,last=null,accept=true;
 const bridge=bindBillingAuditBridge(scope,{
  readCommitted:async()=>value,
 },{
  lookupByKey:async()=>current,
  latestSourceTime:async()=>last,
 },{
  schemaVersion:'rebuild-p05.0.1-candidate',
  validateForScope:async(s,ev)=>accept&&s.brand_id==='starry'
   &&ev.brand_id===s.brand_id&&ev.app_id===s.app_id
   &&ev.environment===s.environment&&ev.schema_version==='rebuild-p05.0.1-candidate'
   &&Object.keys(ev).sort().join('|')===canonicalFields.join('|'),
 });
 return {bridge,setRow:x=>{value=x},setClaim:x=>{current=x},setLatest:x=>{last=x},setAccept:x=>{accept=x}};
};
test('Billing event stays a candidate and Battery cannot be monetized',()=>{
 assert.equal(EVENT_KINDS.includes('billing.store_state_observed'),true);
 assert.equal(BATTERY.purchasable,false);
 assert.equal(BATTERY.price,'free');
});
test('AI-2 exact camelCase outbox maps only 12 AI-0 P05 snake_case fields',()=>{
 const result=mapAi2OutboxToP05(scope,exampleOutbox,row.occurred_at,
  'rebuild-p05.0.1-candidate',row.source_event_ref,row.resource_ref);
 assert.deepEqual(Object.keys(result).sort(),canonicalFields);
 assert.deepEqual([result.brand_id,result.app_id,result.environment,result.idempotency_key],
  ['starry','starry-id','staging','b_'+hex]);
 assert.equal(result.event_type,'billing.store_state_observed');
 assert.equal(result.result,'observed');
 assert.equal('store_environment' in result,false);
 assert.equal('accountBinding' in result,false);
 assert.equal('verifiedBy' in result,false);
});
test('Trusted committed AI-2 outbox passes P05 port and creates redacted AI-3 audit only',async()=>{
 const {bridge}=fixture();
 const plan=await bridge.plan('billing_outbox_1');
 assert.equal(plan.disposition,'ready');
 assert.equal(plan.reason,'VERIFIED_COMMITTED_BILLING');
 assert.equal(isAuditMetadata(plan.audit),true);
 assert.equal(plan.audit.schema_version,CANDIDATE_VERSION);
 assert.equal(plan.audit.event_type,'billing.store_state_observed');
 assert.equal(plan.audit.actor_ref,'billing_verified_service');
 assert.equal(JSON.stringify(plan).includes('provider_transaction_1'),false);
 for(const k of ['email','raw_receipt','store_environment','provider_claims','accountBinding'])
  assert.equal(JSON.stringify(plan).includes(k),false);
});
test('Identical provider event dedupes but same idempotency key different digest quarantines',async()=>{
 const f=fixture();
 f.setClaim({event_id:'a_'+hex,payload_digest:hex2});
 assert.equal((await f.bridge.plan('outbox_1')).disposition,'duplicate');
 f.setClaim({event_id:'a_'+hex,payload_digest:hex});
 assert.deepEqual([(await f.bridge.plan('outbox_1')).disposition,(await f.bridge.plan('outbox_1')).reason],
  ['quarantine','IDEMPOTENCY_CONFLICT']);
 f.setClaim({event_id:'a_'+hex2,payload_digest:hex2});
 assert.equal((await f.bridge.plan('outbox_1')).disposition,'quarantine');
});
test('Out-of-order billing refund remains historical audit and cannot update entitlement',async()=>{
 const f=fixture();
 f.setLatest('2026-10-26T07:01:00Z');
 const p=await f.bridge.plan('outbox_1');
 assert.equal(p.disposition,'stale_audit_only');
 assert.equal(p.reason,'HISTORICAL_AUDIT_NOT_ENTITLEMENT');
 assert.equal('entitlement' in p,false);
});
test('Fail-closed on fake provider-verified, uncommitted, real-store & production runtime',async()=>{
 const f=fixture();
 for(const patch of [
  {verified_provider:false},{committed:false},
  {outbox:{...exampleOutbox,storeEnvironment:'production'}},
  {outbox:{...exampleOutbox,environment:'production'}},
  {outbox:{...exampleOutbox,brandId:'hglobal'}},
  {outbox:{...exampleOutbox,appId:'other'}},
  {outbox:{...exampleOutbox,eventType:'battery.credited'}},
  {outbox:{...exampleOutbox,paid:true}},
  {outbox:{...exampleOutbox,adminVerified:true}},
  {outbox:{...exampleOutbox,raw_receipt:'secret'}},
  {outbox:{...exampleOutbox,correlationId:'bad'}},
  {outbox:{...exampleOutbox,idempotencyKey:'client_supplied'}},
  {outbox:{...exampleOutbox,result:'paid'}},
  {payload_digest:'token'},
  {occurred_at:'2026-02-29T00:00:00Z'},
  {occurred_at:'2026-10-26T00:00:00'},
  {source_event_ref:'member_email@example.com'},
  {resource_ref:'token'},
 ]) {
  f.setRow({...row,...patch});
  assert.equal((await f.bridge.plan('outbox_1')).disposition,'quarantine',JSON.stringify(patch));
 }
});
test('AI-0 is sole P05 validator/owner: rejected unknown schema fails closed',async()=>{
 const f=fixture();
 f.setAccept(false);
 assert.equal((await f.bridge.plan('outbox_1')).reason,'CANONICAL_P05_DENIED');
});
test('AI-3 audit is non-sensitive and unknown helper/hidden audit fields rejected',async()=>{
 const plan=await fixture().bridge.plan('outbox_1');
 assert.equal(isAuditMetadata(plan.audit),true);
 for(const patch of [{email:'pii'},{store_environment:'sandbox'},
  {classification:'full_payload'},{schema_version:'1.0'}])
  assert.equal(isAuditMetadata({...plan.audit,...patch}),false);
});
test('Unknown outbox refs and absent/synthetic status are quarantined',async()=>{
 const f=fixture();
 assert.equal((await f.bridge.plan('invalid@example.com')).disposition,'quarantine');
 for(const data of [null,{},'paid',{outbox:exampleOutbox,committed:true},
  {...row,verified_provider:'client_paid'},
  {...row,payload_digest:'a'.repeat(63)},
 ]) {
  f.setRow(data);
  assert.equal((await f.bridge.plan('outbox_1')).disposition,'quarantine');
 }
});
test('Transient retry and dead-letter never replay rejected unauthorized provider events',()=>{
 assert.equal(retryPlan({attempt:1,failure:'network',idempotency_key:exampleOutbox.idempotencyKey}).decision,'retry');
 assert.equal(retryPlan({attempt:5,failure:'timeout',idempotency_key:exampleOutbox.idempotencyKey}).decision,'dead_letter');
 assert.equal(retryPlan({attempt:1,failure:'auth_denied',idempotency_key:exampleOutbox.idempotencyKey}).decision,'reject');
 assert.equal(retryPlan({attempt:1,failure:'invalid_data',idempotency_key:exampleOutbox.idempotencyKey}).decision,'reject');
 assert.equal(retryPlan({attempt:2,failure:'http',http_status:409,idempotency_key:exampleOutbox.idempotencyKey}).decision,'reject');
});
