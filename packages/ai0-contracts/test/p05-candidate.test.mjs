import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION,PUBLISHABLE,FIELDS,isCandidate} from '../src/p05-candidate.mjs';
import {isBillingP05ForGate,createReliableBillingAuditConsumer} from '../../rebuild-ai3/src/queue-consumer.ts';
const key='b_'+'a'.repeat(64);
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const event={...scope,schema_version:VERSION,event_id:key,
 event_type:'billing.store_state_observed',occurred_at:'2026-10-26T08:00:00Z',
 correlation_id:key,idempotency_key:key,actor_ref:'opaque_actor_1',
 resource_ref:key,result:'recorded',classification:'metadata_only'};
const change=p=>({...event,...p});
test('exact 13 fields, candidate is disabled for publication',()=>{
 assert.equal(PUBLISHABLE,false);
 assert.equal(FIELDS.length,13);
 assert.deepEqual(Object.keys(event).sort(),[...FIELDS].sort());
 assert.equal(isCandidate(event,scope),true);
 assert.equal(isBillingP05ForGate(event,scope,VERSION),true);
});
test('AI-0 / AI-3 reject mismatched version, scope, idempotency and PII actor',()=>{
 for(const patch of [
  {schema_version:'rebuild-ai3.0.1-candidate'},
  {schema_version:'candidate-not-approved'},
  {brand_id:'hglobal'},{app_id:'other'},{environment:'production'},
  {event_type:'battery.purchase'},{event_id:'x'},
  {correlation_id:'x'},{resource_ref:'x'},{idempotency_key:'client'},
  {result:'paid'},{classification:'raw'},
  {actor_ref:'s_user_1'},{actor_ref:'email@example.com'}]){
  assert.equal(isCandidate(change(patch),scope),false,JSON.stringify(patch));
  assert.equal(isBillingP05ForGate(change(patch),scope,VERSION),false,JSON.stringify(patch));
 }
 for(const patch of [{app_id:'other'},{brand_id:'hglobal'},{environment:'production'}])
  assert.equal(isCandidate(event,{...scope,...patch}),false);
});
test('rejects undeclared, hidden, accessors, symbol and unsafe object data',()=>{
 for(const p of [{raw_receipt:'secret'},{email:'pii'},{user_id:'s_1'},
  {store_environment:'sandbox'},{accountBinding:'value'},
  {adminVerified:true},{paid:true},{entitlement:'active'}]){
  assert.equal(isCandidate(change(p),scope),false,JSON.stringify(p));
 }
 const hidden=change({});Object.defineProperty(hidden,'token',{value:'secret',enumerable:false});
 const getter=change({});Object.defineProperty(getter,'actor_ref',{enumerable:true,get:()=> 'opaque_actor_1'});
 const symbol=change({});symbol[Symbol.for('secret')]=true;
 const {proxy,revoke}=Proxy.revocable(change({}),{});revoke();
 for(const x of [hidden,getter,symbol,proxy,[],null,'paid',new Map(),new Date()])
  assert.equal(isCandidate(x,scope),false);
});
test('validates RFC3339 real calendar with timezone',()=>{
 for(const date of ['2026-02-30T01:00:00Z','2026-02-29T01:00:00Z',
 '2026-10-26T01:00:00','2026-10-26T24:00:00Z',
 '2026-10-26T01:00:00+24:00',null]){
  assert.equal(isCandidate(change({occurred_at:date}),scope),false,String(date));
 }
 assert.equal(isCandidate(change({occurred_at:'2024-02-29T01:00:00+08:00'}),scope),true);
});
test('AI-0 Gate blocked: valid syntax never alone authorizes Queue ack/write',async()=>{
 let wrote=0,quarantined=0;
 const consumer=createReliableBillingAuditConsumer(scope,{
  schemaVersion:VERSION,accepts:async()=>false,
 },{
  readAfterCommit:async()=>({p05:event,committed:true,provider_verified:true,payload_digest:'b'.repeat(64)}),
 },{
  claimAndAppendAtomically:async()=>{wrote++;return 'inserted';},
  recordQuarantine:async()=>{quarantined++;},
 });
 const decision=await consumer.consume(key,1);
 assert.equal(decision.reason,'AI0_P05_NOT_APPROVED');
 assert.equal(decision.outcome,'quarantine_recorded');
 assert.equal(wrote,0);assert.equal(quarantined,1);
});
