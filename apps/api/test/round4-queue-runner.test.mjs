import test from 'node:test';
import assert from 'node:assert/strict';
import {createReliableBillingAuditConsumer} from '../../../packages/rebuild-ai3/src/queue-consumer.ts';
import {createOfflineRound4QueueRunner} from '../test-support/round4-queue-runner.ts';

const ref='b_'+'a'.repeat(64),scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const event={brand_id:'starry',app_id:'starry-id',environment:'staging',
 schema_version:'billing.p05.v1-candidate',event_id:ref,event_type:'billing.store_state_observed',
 occurred_at:'2026-10-26T07:52:00Z',correlation_id:ref,idempotency_key:ref,
 actor_ref:'anon_1',resource_ref:ref,result:'recorded',classification:'metadata_only'};
const baseRow={p05:event,payload_digest:'a'.repeat(64),committed:true,provider_verified:true};
function fixture(){
 const state={row:baseRow,readFail:false,writeFail:false,quarantineFail:false,dlqFail:false,
  allow:true,atomic:new Map(),audit:[],quarantine:[],dlq:[],acks:0,retries:[]};
 const authority={schemaVersion:'billing.p05.v1-candidate',accepts:async()=>state.allow};
 const source={readAfterCommit:async()=>{if(state.readFail)throw Error('NO_BILLING');
  return state.row;}};
 const store={
  async claimAndAppendAtomically(claim){
   if(state.writeFail)throw Error('D1_ABORT');
   const old=state.atomic.get(claim.key);
   if(old)return old.id===claim.eventId&&old.digest===claim.digest?'duplicate':'conflict';
   state.atomic.set(claim.key,{id:claim.eventId,digest:claim.digest});
   state.audit.push(claim.event);return 'inserted';
  },
  async recordQuarantine(_scope,eventRef,reason){
   if(state.quarantineFail)throw Error('D1_QUARANTINE_ABORT');
   state.quarantine.push([eventRef,reason]);
  },
 };
 const consumer=createReliableBillingAuditConsumer(scope,authority,source,store);
 const runner=createOfflineRound4QueueRunner(consumer,{
  persist:async(id,reason)=>{if(state.dlqFail)throw Error('DLQ_OFFLINE');
   state.dlq.push([id,reason]);return true;}
 });
 const delivery=(attempts=1,body={eventRef:ref})=>({
  attempts,body,ack:()=>{state.acks++;},
  retry:opt=>{state.retries.push(opt.delaySeconds);}
 });
 return {state,runner,delivery};
}
test('AI3 inbox+audit commits before AI4 ACK, lost ACK redelivery is idempotent',async()=>{
 const f=fixture();
 assert.equal(await f.runner.deliver(f.delivery()),'ack');
 assert.equal(f.state.audit.length,1);assert.equal(f.state.acks,1);
 assert.equal(await f.runner.deliver(f.delivery(2)),'ack');
 assert.equal(f.state.audit.length,1);assert.equal(f.state.acks,2);
});
test('changed digest conflict requires durable quarantine before ACK; missing quarantine retry',async()=>{
 const f=fixture();await f.runner.deliver(f.delivery());
 f.state.row={...baseRow,payload_digest:'b'.repeat(64)};
 assert.equal(await f.runner.deliver(f.delivery(2)),'ack');
 assert.equal(f.state.quarantine[0][1],'IDEMPOTENCY_DIGEST_CONFLICT');
 const g=fixture();g.state.row={...baseRow,committed:false};g.state.quarantineFail=true;
 assert.equal(await g.runner.deliver(g.delivery()),'retry');
 assert.equal(g.state.acks,0);
});
test('source failure and atomic D1 failure RETRY; DLQ must persist before source ACK',async()=>{
 const f=fixture();f.state.readFail=true;
 assert.equal(await f.runner.deliver(f.delivery(1)),'retry');
 assert.equal(f.state.retries[0],1);assert.equal(f.state.acks,0);
 f.state.dlqFail=true;
 assert.equal(await f.runner.deliver(f.delivery(5)),'retry');
 assert.equal(f.state.acks,0);assert.equal(f.state.dlq.length,0);
 f.state.dlqFail=false;
 assert.equal(await f.runner.deliver(f.delivery(5)),'ack');
 assert.equal(f.state.dlq.length,1);assert.equal(f.state.acks,1);
 const g=fixture();g.state.writeFail=true;
 assert.equal(await g.runner.deliver(g.delivery(3)),'retry');
 assert.equal(g.state.acks,0);assert.equal(g.state.audit.length,0);
});
test('wrong P05/version/brand/private payload quarantined, no audit authorized',async()=>{
 for(const p05 of [
  {...event,brand_id:'hglobal'},{...event,app_id:'wrong'},
  {...event,environment:'production'},{...event,schema_version:'unapproved'},
  {...event,email:'private@example.test'}, {...event,actor_ref:'user@example.test'}
 ]){
  const f=fixture();f.state.row={...baseRow,p05};
  assert.equal(await f.runner.deliver(f.delivery()),'ack');
  assert.equal(f.state.audit.length,0);assert.equal(f.state.quarantine.length,1);
 }
 const f=fixture();f.state.allow=false;
 assert.equal(await f.runner.deliver(f.delivery()),'ack');
 assert.equal(f.state.audit.length,0);assert.equal(f.state.quarantine[0][1],'AI0_P05_NOT_APPROVED');
});
test('client Queue body cannot provide authority, attempts or arbitrary event',async()=>{
 const f=fixture();
 for(const bad of [{eventRef:ref,adminVerified:true},{eventRef:'client'},null,
  {eventRef:ref,attempts:1},Object.create({eventRef:ref})]){
  assert.equal(await f.runner.deliver(f.delivery(1,bad)),'retry');
 }
 assert.equal(f.state.acks,0);
 assert.equal(f.state.audit.length,0);
});
