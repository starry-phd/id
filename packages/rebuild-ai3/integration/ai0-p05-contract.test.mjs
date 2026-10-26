import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRound4BillingAuditConsumer,isBillingP05ForGate} from '../src/queue-consumer.ts';
import {CANDIDATE_VERSION} from '../src/index.ts';
if(!process.env.AI0_P05_MODULE)throw new Error('AI0_P05_MODULE fixed source is required; never skip');
const authoritative=await import(pathToFileURL(process.env.AI0_P05_MODULE).href);
const {VERSION,isCandidate,PUBLISHABLE,FIELDS}=authoritative;
const hash='a'.repeat(64),digest='b'.repeat(64),key='b_'+hash;
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const p05={brand_id:'starry',app_id:'starry-id',environment:'staging',
 schema_version:VERSION,event_id:key,event_type:'billing.store_state_observed',
 occurred_at:'2026-10-26T08:22:00Z',correlation_id:key,idempotency_key:key,
 actor_ref:'anon_safe_pseudonym',resource_ref:key,result:'recorded',classification:'metadata_only'};
test('AI-0 PR #43 pinned canonical source is same 13-field candidate, never publishable',()=>{
 assert.equal(VERSION,'billing.p05.v1-candidate');
 assert.equal(PUBLISHABLE,false);
 assert.deepEqual(Object.keys(p05).sort(),[...FIELDS].sort());
 assert.equal(isCandidate(p05,scope),true);
 assert.equal(isBillingP05ForGate(p05,scope,VERSION),true);
 assert.notEqual(VERSION,CANDIDATE_VERSION);
});
test('AI-0 and AI-3 both fail closed for exact same cross-brand/App/runtime/PII/unknown-key cases',()=>{
 for(const patch of [
  {brand_id:'hglobal'},{app_id:'other'},{environment:'production'},
  {schema_version:'not-approved'},{actor_ref:'raw_email@private'},
  {store_environment:'sandbox'},{provider_verified:true},
  {occurred_at:'2026-02-30T00:00:00Z'},
  {raw_receipt:'private'}, {event_id:'wrong'},
  {idempotency_key:'client-key'},{result:'paid'},
 ]){
  const forged={...p05,...patch};
  assert.equal(isCandidate(forged,scope),false,JSON.stringify(patch));
  assert.equal(isBillingP05ForGate(forged,scope,VERSION),false,JSON.stringify(patch));
 }
 const hidden={...p05};Object.defineProperty(hidden,'token',{value:'secret',enumerable:false});
 assert.equal(isCandidate(hidden,scope),false);
 assert.equal(isBillingP05ForGate(hidden,scope,VERSION),false);
 const getter={...p05};Object.defineProperty(getter,'actor_ref',{get:()=> 'anon_sneaky',enumerable:true});
 assert.equal(isCandidate(getter,scope),false);
 assert.equal(isBillingP05ForGate(getter,scope,VERSION),false);
});
test('AI-0 trusted canonical adapter accepts shape only, still requires true Billing committed authority',async()=>{
 let calls=0;
 const adapter=createRound4BillingAuditConsumer(scope,
  {schemaVersion:VERSION,accepts:async(s,v)=>isCandidate(v,s)},
  {readAfterCommit:async()=>{
   calls++;return {p05,payload_digest:digest,committed:false,provider_verified:false};
  }},
  {claimAndAppendAtomically:async()=>{throw Error('UNREACHABLE')},
   recordQuarantine:async()=>{}},
  {afterCommitOrder:async()=> 'current'});
 assert.equal((await adapter.consume(key,1)).outcome,'quarantine_recorded');
 assert.equal(calls,1);
});
test('canonical format alone cannot grant Queue ACK when AI0 Gate denies this candidate',async()=>{
 let claims=0;
 const adapter=createRound4BillingAuditConsumer(scope,
  {schemaVersion:VERSION,accepts:async()=>false},
  {readAfterCommit:async()=>({p05,payload_digest:digest,committed:true,provider_verified:true})},
  {claimAndAppendAtomically:async()=>{claims++;return 'inserted'},
   recordQuarantine:async()=>{}},
  {afterCommitOrder:async()=> 'current'});
 const res=await adapter.consume(key,1);
 assert.equal(res.outcome,'quarantine_recorded');assert.equal(claims,0);
});
