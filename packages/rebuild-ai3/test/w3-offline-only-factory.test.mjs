import test from 'node:test';
import assert from 'node:assert/strict';
import {createAi3OfflineOnlyFactory,AI3_W3_LIVE_CAPABLE} from '../src/w3-offline-only-factory.ts';

const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const spy=()=>{
 const calls=[];
 const ports={
  db:{prepare:()=>{calls.push('prepare');throw Error('DB used')},
    batch:async()=>{calls.push('batch');throw Error('DB used')}},
  msg:{ack:()=>calls.push('ack'),retry:()=>calls.push('retry')},
  consumer:{consume:async()=>{calls.push('consume');return {outcome:'ack',ack_safe:true}}},
  deadLetter:{persist:async()=>{calls.push('persist');return {outcome:'durably_written'}}},
  send:()=>calls.push('send'),erase:()=>calls.push('erase'),
  restore:()=>calls.push('restore'),
 };
 return {calls,ports};
};
const noLive=r=>{
 assert.equal(r.live,false);assert.equal(r.ack_safe,false);
 assert.equal(r.real_ack,false);assert.equal(r.side_effects_performed,false);
};
test('default OFF: forged ACK/DLQ and side-effect ports are never touched',async()=>{
 const {calls,ports}=spy();
 const factory=createAi3OfflineOnlyFactory(scope);
 for(const input of [{ack_safe:true,ports},ports,null]){
  const queue=await factory.queueReview(input);
  const audit=await factory.auditReview(input);
  assert.equal(queue.status,'disabled');assert.equal(audit.status,'disabled');
  noLive(queue);noLive(audit);
 }
 assert.deepEqual(calls,[]);
 assert.equal(AI3_W3_LIVE_CAPABLE,false);
});
test('explicit dev/staging offline test reuses adapters without any external side effect or true ACK',async()=>{
 for(const environment of ['development','staging']){
  const {calls,ports}=spy();
  const factory=createAi3OfflineOnlyFactory({...scope,environment},{enableOfflineTest:true});
  for(const forged of [
   {ack_safe:true,outcome:'ack',ports},
   {ack_safe:true,outcome:'dlq_required',receipt:{outcome:'durably_written'},ports},
   {committed:true,verified:true,live:true,ports},
  ]){
   const queue=await factory.queueReview(forged);
   const audit=await factory.auditReview(forged);
   assert.equal(queue.status,'offline_review_only');
   assert.equal(audit.status,'offline_review_only');
   noLive(queue);noLive(audit);
  }
  assert.deepEqual(calls,[]);
 }
});
test('constructor rejects production, unknown, cross-brand, malformed scope even when OFF',()=>{
 for(const bad of [
  {...scope,environment:'production'},{...scope,environment:'preview'},
  {...scope,environment:undefined},{...scope,brand_id:'hglobal'},
  {...scope,app_id:''},{...scope,unexpected:true},
  Object.assign(Object.create({brand_id:'starry'}),scope),null,
 ]){
  assert.throws(()=>createAi3OfflineOnlyFactory(bad,{enableOfflineTest:false}));
 }
});
test('no caller-supplied capability/enable spoofing or accessor may activate live',async()=>{
 const {calls,ports}=spy();
 for(const opts of [{enableOfflineTest:'true'},{enableOfflineTest:1},
  {enableOfflineTest:true,db:ports.db},{enableOfflineTest:true,ack_safe:true},
  Object.defineProperty({},'enableOfflineTest',{get(){throw Error('getter')},enumerable:true}),
 ]){
  assert.throws(()=>createAi3OfflineOnlyFactory(scope,opts));
 }
 const factory=createAi3OfflineOnlyFactory(scope,{enableOfflineTest:true});
 assert.deepEqual(Object.keys(factory).sort(),['auditReview','queueReview','scope']);
 noLive(await factory.queueReview({ack_safe:true,ports}));
 assert.deepEqual(calls,[]);
});
