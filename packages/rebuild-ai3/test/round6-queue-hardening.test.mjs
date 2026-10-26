import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchQueueMessage} from '../src/queue-transport.ts';
const key='b_'+'a'.repeat(64);
const fixture=(attempts=1)=>{
 const actions=[],sent=[];
 const msg={body:{event_ref:key},attempts,ack:()=>actions.push('ack'),
  retry:x=>actions.push(['retry',x.delaySeconds])};
 const consumer={consume:async(_key,attempt)=>{
  sent.push(attempt);
  return {outcome:'dlq_required',ack_safe:false,
   reason:'SOURCE_NOT_YET_COMMITTED',retry_after_ms:0};
 }};
 const dlq={persist:async row=>({outcome:'durably_written',event_ref:row.event_ref})};
 return {msg,consumer,dlq,actions,sent};
};
test('R6 deliveries 6, 7, 99 use bounded domain policy attempt 5 and durable DLQ',async()=>{
 for(const attempts of [6,7,99]){
  const f=fixture(attempts);
  assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.dlq),'dlq_acked');
  assert.deepEqual(f.sent,[5]);assert.deepEqual(f.actions,['ack']);
 }
});
test('R6 DLQ outage after attempt 5+ prevents ACK',async()=>{
 const f=fixture(9);
 f.dlq.persist=async()=>{throw Error('DLQ_DOWN')};
 assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.dlq),'retried');
 assert.deepEqual(f.actions,[['retry',1]]);
});
test('R6 invalid attempts never invoke consumer/ACK',async()=>{
 for(const n of [0,-1,NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1]){
  const f=fixture(n);
  assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.dlq),'retried');
  assert.equal(f.sent.length,0);assert.deepEqual(f.actions,[['retry',1]]);
 }
});
test('R6 retry backoff is finite and capped between 1-60 seconds',async()=>{
 for(const [delay,expected] of [[-100,1],[0,1],[1,1],[2100,3],
  [60001,60],[Number.POSITIVE_INFINITY,1],[Number.NaN,1]]){
  const f=fixture();f.consumer.consume=async()=>({
   outcome:'retry',ack_safe:false,reason:'SOURCE_UNAVAILABLE',retry_after_ms:delay});
  assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.dlq),'retried');
  assert.deepEqual(f.actions,[['retry',expected]],String(delay));
 }
});
test('R6 hidden queue event ref, getter, prototype, symbol, client paid flag are denied',async()=>{
 const hidden={};Object.defineProperty(hidden,'event_ref',{value:key,enumerable:false});
 const getter={};Object.defineProperty(getter,'event_ref',{get(){return key},enumerable:true});
 const child=Object.create({event_ref:key});
 const symbol={event_ref:key,[Symbol('secret')]:true};
 const revoked=Proxy.revocable({event_ref:key},{});revoked.revoke();
 for(const body of [hidden,getter,child,symbol,revoked.proxy,{event_ref:key,paid:true}]){
  const f=fixture();f.msg.body=body;
  assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.dlq),'retried');
  assert.equal(f.sent.length,0);assert.deepEqual(f.actions,[['retry',1]]);
 }
});
test('R6 consumer claims safe ACK but ack_safe is false: fail closed',async()=>{
 for(const outcome of ['ack','quarantine_recorded']){
  const f=fixture();f.consumer.consume=async()=>({
   outcome,ack_safe:false,reason:'SOURCE_NOT_YET_COMMITTED',retry_after_ms:0});
  assert.equal(await dispatchQueueMessage(f.msg,f.consumer,f.dlq),'retried');
  assert.deepEqual(f.actions,[['retry',1]]);
 }
});
