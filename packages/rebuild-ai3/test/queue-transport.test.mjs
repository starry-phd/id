import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchQueueMessage} from '../src/queue-transport.ts';
const key='b_'+'a'.repeat(64);
const fixture=(decision,dlqOk=true)=> {
 const actions=[],persisted=[];
 const msg={body:{event_ref:key},attempts:5,
  ack:()=>actions.push('ack'),retry:arg=>actions.push(['retry',arg?.delaySeconds])};
 const consumer={consume:async()=>decision};
 const deadLetter={persist:async row=>{
  persisted.push(row);
  if(!dlqOk)throw Error('storage outage');
  return {outcome:'durably_written',event_ref:key};
 }};
 return {msg,consumer,deadLetter,actions,persisted};
};
test('Cloudflare Queue ACK only when AI3 storage says confirmed',async()=>{
 for(const outcome of ['ack','quarantine_recorded']){
  const f=fixture({outcome,ack_safe:true,reason:'AUDIT_COMMITTED',retry_after_ms:0});
  assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.deadLetter),'acked');
  assert.deepEqual(f.actions,['ack']);
  assert.equal(f.persisted.length,0);
 }
});
test('never silently autoACK retry/hold/unknown Queue delivery',async()=>{
 for(const outcome of ['retry','hold','unknown']){
  const f=fixture({outcome,ack_safe:false,reason:'SAFE_DENIED',retry_after_ms:4000});
  assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.deadLetter),'retried');
  assert.equal(f.actions[0][0],'retry');assert.equal(f.actions.includes('ack'),false);
 }
});
test('failed dlq storage forbids ACK and retries same message',async()=>{
 const f=fixture({outcome:'dlq_required',ack_safe:false,reason:'SOURCE_UNAVAILABLE'},false);
 assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.deadLetter),'retried');
 assert.equal(f.actions.some(x=>x==='ack'),false);
 assert.equal(f.persisted.length,1);
 assert.deepEqual(Object.keys(f.persisted[0]),['event_ref','reason_code','attempt']);
});
test('confirmed DLQ write allows ACK, never stores request body/PII',async()=>{
 const f=fixture({outcome:'dlq_required',ack_safe:false,reason:'SOURCE_UNAVAILABLE'},true);
 assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.deadLetter),'dlq_acked');
 assert.deepEqual(f.actions,['ack']);
 assert.equal(JSON.stringify(f.persisted[0]).includes('receipt'),false);
});
test('wrong DLQ ref/status must not be trusted for ACK',async()=>{
 const f=fixture({outcome:'dlq_required',ack_safe:false,reason:'SOURCE_UNAVAILABLE'});
 f.deadLetter.persist=async()=>({outcome:'durably_written',event_ref:'b_'+ 'b'.repeat(64)});
 assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.deadLetter),'retried');
 assert.equal(f.actions.some(x=>x==='ack'),false);
});
test('malicious Queue DTO extra fields and fake client verified markers retry without delivery',async()=>{
 const f=fixture({outcome:'ack',ack_safe:true,reason:'SAVED'});
 let count=0;f.consumer.consume=async()=>{count++;return {outcome:'ack',ack_safe:true}};
 for(const body of [{event_ref:key,paid:true},{event_ref:key,adminVerified:true},
  {event_ref:'member@example.com'},null,{},Object.create({event_ref:key})]){
  f.msg.body=body;
  assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.deadLetter),'retried');
 }
 assert.equal(count,0);assert.equal(f.actions.some(x=>x==='ack'),false);
});
test('unhandled consumer throw also retries and never ACKs',async()=>{
 const f=fixture({outcome:'ack',ack_safe:true,reason:'OK'});
 f.consumer.consume=async()=>{throw Error('server timeout')};
 assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.deadLetter),'retried');
 assert.equal(f.actions.some(x=>x==='ack'),false);
});
test('consumer lying ack_safe true on retry does not ACK',async()=>{
 const f=fixture({outcome:'retry',ack_safe:true,reason:'BAD',retry_after_ms:1000});
 assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.deadLetter),'retried');
 assert.deepEqual(f.actions,[['retry',1]]);
});
