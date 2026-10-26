import test from 'node:test';
import assert from 'node:assert/strict';
import {createReliableBillingAuditConsumer,isBillingP05ForGate} from '../src/queue-consumer.ts';
import {BATTERY} from '../src/index.ts';
const key='b_'+'a'.repeat(64),dig='b'.repeat(64),scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const event={brand_id:'starry',app_id:'starry-id',environment:'staging',schema_version:'billing.p05.v1-candidate',
 event_id:key,event_type:'billing.store_state_observed',occurred_at:'2026-10-26T07:52:00Z',
 correlation_id:key,idempotency_key:key,actor_ref:'anon_one',resource_ref:key,result:'recorded',classification:'metadata_only'};
const record={p05:event,payload_digest:dig,committed:true,provider_verified:true};
function fixture(){
 let row=record,failRead=false,failWrite=false,failQuarantine=false,gate='yes',receipt=null;
 const storeRows=new Map(),audits=[],quarantine=[];
 const source={async readAfterCommit(){if(failRead)throw Error('offline');return row;}};
 const store={
  async claimAndAppendAtomically(c){
   if(failWrite)throw Error('D1_BUSY');
   if(receipt!==null)return receipt;
   const stored=storeRows.get(c.key);
   if(stored)return stored.digest===c.digest&&stored.id===c.eventId?'duplicate':'conflict';
   storeRows.set(c.key,{digest:c.digest,id:c.eventId});audits.push(c.event);return 'inserted';
  },
  async recordQuarantine(_scope,id,reason){
   if(failQuarantine)throw Error('not persisted');quarantine.push([id,reason]);
  },
 };
 const authority={schemaVersion:'billing.p05.v1-candidate',async accepts(){
  if(gate==='error')throw Error('AI0_UNAVAILABLE');return gate==='yes';
 }};
 const consumer=createReliableBillingAuditConsumer(scope,authority,source,store);
 return {consumer,audits,quarantine,storeRows,
  row:v=>row=v,readFail:v=>failRead=v,writeFail:v=>failWrite=v,
  quarantineFail:v=>failQuarantine=v,gate:v=>gate=v,receipt:v=>receipt=v};
}
test('exact P05 13 fields with version, Starry brand, safe pseudonymous actor',()=>{
 assert.equal(Object.keys(event).length,13);
 assert.equal(isBillingP05ForGate(event,scope,'billing.p05.v1-candidate'),true);
 assert.equal(BATTERY.purchasable,false);
 for(const patch of [
  {schema_version:'fake'},{app_id:'different'},{brand_id:'hglobal'},
  {environment:'production'},{event_id:'arbitrary'},{correlation_id:'other'},
  {resource_ref:'pii@example.com'},{actor_ref:'s_user_1'},
  {occurred_at:'2026-02-30T00:00:00Z'}, {store_environment:'sandbox'}, {adminVerified:true}
 ])assert.equal(isBillingP05ForGate({...event,...patch},scope,'billing.p05.v1-candidate'),false);
});
test('ACK only after commit of inbox+redacted audit',async()=>{
 const f=fixture();const r=await f.consumer.consume(key,1);
 assert.equal(r.outcome,'ack');assert.equal(r.ack_safe,true);
 assert.equal(f.audits.length,1);
 assert.equal(f.audits[0].schema_version,'rebuild-ai3.0.1-candidate');
 assert.equal('entitlement' in r,false);
});
test('crash after commit before ACK redelivery does not duplicate audit',async()=>{
 const f=fixture();await f.consumer.consume(key,1);
 const r=await f.consumer.consume(key,2);
 assert.equal(r.reason,'ALREADY_COMMITTED_SAME_EVENT');
 assert.equal(f.audits.length,1);
});
test('same key but changed digest quarantines rather than overwrites',async()=>{
 const f=fixture();await f.consumer.consume(key,1);
 f.row({...record,payload_digest:'c'.repeat(64)});
 const r=await f.consumer.consume(key,2);
 assert.equal(r.outcome,'quarantine_recorded');
 assert.equal(f.quarantine[0][1],'IDEMPOTENCY_DIGEST_CONFLICT');
 assert.equal(f.audits.length,1);
});
test('failed quarantine persists nothing and never permits Queue ACK',async()=>{
 const f=fixture();f.row({...record,provider_verified:false});f.quarantineFail(true);
 const r=await f.consumer.consume(key,1);
 assert.equal(r.outcome,'retry');assert.equal(r.retry_after_ms,1000);assert.equal(r.ack_safe,false);
 const exhausted=await f.consumer.consume(key,5);
 assert.equal(exhausted.outcome,'dlq_required');assert.equal(exhausted.ack_safe,false);
});
test('fake provider, uncommitted data, scope, version and PII are quarantined',async()=>{
 for(const patch of [{committed:false},{provider_verified:false},
  {payload_digest:'bad'}, {p05:{...event,app_id:'other'}},
  {p05:{...event,event_type:'battery.purchase'}},{p05:{...event,store_environment:'sandbox'}},
  {p05:{...event,raw_receipt:'secret'}},{p05:{...event,actor_ref:'user@email'}},
  {p05:{...event,occurred_at:'invalid'}}]){
  const f=fixture();f.row({...record,...patch});
  const r=await f.consumer.consume(key,1);
  assert.equal(r.outcome,'quarantine_recorded',JSON.stringify(patch));
  assert.equal(f.audits.length,0);
 }
});
test('AI-0 canonical port can reject candidate or be unavailable; neither ACKs unsafe event',async()=>{
 const f=fixture();f.gate('no');
 assert.equal((await f.consumer.consume(key,1)).outcome,'quarantine_recorded');
 f.gate('error');
 assert.equal((await f.consumer.consume(key,1)).outcome,'retry');
 assert.equal((await f.consumer.consume(key,5)).outcome,'dlq_required');
 assert.equal(f.audits.length,0);
});
test('AI-2 outbox source failure and AI-3 atomic store failure return retry then DLQ',async()=>{
 const f=fixture();f.readFail(true);
 assert.equal((await f.consumer.consume(key,1)).outcome,'retry');
 f.readFail(false);f.writeFail(true);
 assert.equal((await f.consumer.consume(key,3)).retry_after_ms,4000);
 assert.equal((await f.consumer.consume(key,5)).outcome,'dlq_required');
 assert.equal(f.audits.length,0);
});
test('invalid Queue retry count/key cannot read or ACK',async()=>{
 const f=fixture();
 for(const [ref,n] of [['client_key',1],[key,0],[key,6],[key,NaN],[null,1]]){
  const r=await f.consumer.consume(ref,n);
  assert.equal(r.outcome,'hold');assert.equal(r.ack_safe,false);
 }
});
test('store must return recognized persisted result, not arbitrary receipt',async()=>{
 const f=fixture();f.receipt('ok_but_not_persisted');
 const r=await f.consumer.consume(key,1);
 assert.equal(r.outcome,'retry');assert.equal(r.ack_safe,false);
});
test('getter, hidden field, revoked proxy and wrong resource id fail closed',async()=>{
 const f=fixture();
 const hidden={...event};Object.defineProperty(hidden,'secret',{value:'raw',enumerable:false});
 const getter={...event};Object.defineProperty(getter,'actor_ref',{enumerable:true,get(){return 'anon_fake'}});
 const {proxy,revoke}=Proxy.revocable({...event},{});revoke();
 for(const p05 of [hidden,getter,proxy,{...event,resource_ref:'unsafe'}]){
  f.row({...record,p05});
  assert.equal((await f.consumer.consume(key,1)).outcome,'quarantine_recorded');
 }
 assert.equal(f.audits.length,0);
});
