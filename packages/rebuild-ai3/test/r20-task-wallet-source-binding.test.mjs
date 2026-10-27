import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineR20TaskWalletBinding,R20_DTO_KIND,
 LIVE_AI3_R20_SOURCE_MAPPING_ENABLED} from '../src/r20-task-wallet-source-binding.ts';
const scope={brand_id:'starry',environment:'staging'};
const m='member_1',t='task_1',ev='auth_task_source_1234567890123456789';
const source={brand_id:'starry',environment:'staging',member_ref:m,
 task_ref:t,event_ref:ev,event_type:'task_committed',auth_version:3,
 attempt_no:1,policy_version:1,committed_at_ms:110000};
const task={brand_id:'starry',environment:'staging',member_ref:m,
 task_ref:t,source_event_ref:ev,status:'committed',attempt_no:1,
 policy_version:1,committed_at_ms:110000};
const receipt={brand_id:'starry',environment:'staging',task_ref:t,
 source_event_ref:ev,policy_version:1,wallet_revision:4,task_attempt:1,
 kind:'OFFLINE_UNTRUSTED_LOCAL_RECEIPT'};
const result={status:'review_only',reason:'OFFLINE_UNTRUSTED_RECEIPT_NOT_AUTHORIZED',
 candidate_receipt:receipt,may_settle:false,may_release:false,may_ack_queue:false,
 may_regrant:false,may_restore:false,may_sell_battery:false,live:false};
const clone=x=>structuredClone(x);
function fx(opts={}){
 const c={source:0,task:0,battery:0,legal:0,retention:0,policy:0};
 const v=(key,d)=>{c[key]++;const val=opts[key];
  return typeof val==='function'?val(c[key]):val===undefined?clone(d):val;};
 const config={enabled:true,scope,
  source:{async readTaskSource(a,b,s){assert.equal(a,m);assert.equal(b,t);assert.deepEqual(s,scope);return v('source',source);}},
  task:{async readTaskReceipt(a,b,s){assert.equal(a,m);assert.equal(b,t);assert.deepEqual(s,scope);return v('task',task);}},
  battery:{async inspect(a,b,n){assert.equal(a,m);assert.equal(b,t);assert.equal(n,110500);return v('battery',result);}},
  legalNow:async()=>v('legal',true),
  retentionNow:async()=>v('retention',true),
  policyNow:async()=>v('policy',1)};
 return {c,make:(over={})=>createOfflineR20TaskWalletBinding({...config,...over})};
}
function noPower(r){
 for(const k of ['may_settle','may_release_task','may_ack_queue','may_regrant',
 'may_restore','may_publish','may_sell_battery','live'])assert.equal(r[k],false,k);
}
test('R20 matching local mock links only yield explicitly unapproved AI-4 DTO',async()=>{
 assert.equal(LIVE_AI3_R20_SOURCE_MAPPING_ENABLED,false);
 const f=fx(),r=await f.make().inspect(m,t,110500);
 assert.equal(r.status,'review_only');noPower(r);
 assert.deepEqual(r.candidate,{kind:R20_DTO_KIND,brand_id:'starry',
  environment:'staging',member_ref:m,task_ref:t,source_event_ref:ev,
  task_attempt:1,policy_version:1,wallet_revision:4,
  signed_source_approved:false,member_mapping_approved:false,
  independent_floor_approved:false});
 assert.equal(f.c.battery,2);
});
test('R20 disabled, foreign brand, fake time fail before protected reads',async()=>{
 const f=fx();assert.equal((await f.make({enabled:false}).inspect(m,t,110500)).status,'blocked');
 noPower(await f.make().inspect(m,t,NaN));
 assert.equal(f.c.source,0);
 assert.throws(()=>f.make({scope:{brand_id:'hglobal',environment:'staging'}}),/SCOPE/);
});
test('R20 law, retention and policy fail before reading protected sources',async()=>{
 for(const o of [{legal:false},{retention:false},{policy:null},{policy:0}]){
  const f=fx(o),r=await f.make().inspect(m,t,110500);
  assert.equal(r.status,'blocked');assert.equal(f.c.source,0);noPower(r);
 }
});
test('R20 actual account_deleted and Store refund cannot be mapped to Task commit',async()=>{
 for(const o of [{...source,event_type:'account_deleted'},
  {...source,event_type:'store_refund'}, {...source,member_ref:'member_2'},
  {...source,environment:'development'},{...source,brand_id:'hglobal'}]){
  const f=fx({source:o}),r=await f.make().inspect(m,t,110500);
  assert.equal(r.status,'blocked');assert.equal(f.c.task,0);noPower(r);
 }
});
test('R20 Auth-Task-Wallet source event refs must match exactly',async()=>{
 for(const o of [
  {task:{...task,source_event_ref:'other_source_12345678901234567890'}},
  {battery:{...result,candidate_receipt:{...receipt,source_event_ref:'other_source_12345678901234567890'}}},
  {task:{...task,member_ref:'member_2'}},{task:{...task,environment:'development'}},
  {battery:{...result,candidate_receipt:{...receipt,task_ref:'task_2'}}}]){
  const f=fx(o),r=await f.make().inspect(m,t,110500);
  assert.equal(r.status,'blocked');noPower(r);
 }
});
test('R20 task commit attempt must be exactly one in source and sink',async()=>{
 for(const o of [{source:{...source,attempt_no:2}},
  {task:{...task,attempt_no:2}},
  {battery:{...result,candidate_receipt:{...receipt,task_attempt:2}}},
  {source:{...source,auth_version:0}}]){
  const f=fx(o),r=await f.make().inspect(m,t,110500);
  assert.equal(r.status,'blocked');noPower(r);
 }
});
test('R20 time, status and policy coherence cannot be inferred',async()=>{
 for(const o of [{source:{...source,committed_at_ms:111000}},
  {task:{...task,committed_at_ms:109999}},
  {task:{...task,status:'pending'}},
  {task:{...task,policy_version:2}},
  {battery:{...result,candidate_receipt:{...receipt,policy_version:2}}}]){
  const f=fx(o),r=await f.make().inspect(m,t,110500);
  assert.equal(r.status,'blocked');noPower(r);
 }
});
test('R20 underlying R19 missing floor, PITR or partial wallet commit is denied',async()=>{
 for(const o of [
  {...result,status:'blocked',reason:'PITR_WALLET_BELOW_FLOOR',candidate_receipt:null},
  {...result,status:'blocked',reason:'INDEPENDENT_NONROLLBACK_FLOOR_UNAVAILABLE',candidate_receipt:null},
  {...result,may_ack_queue:true},
  {...result,candidate_receipt:{...receipt,wallet_revision:0}},
  {...result,candidate_receipt:null}]){
  const f=fx({battery:o}),r=await f.make().inspect(m,t,110500);
  assert.equal(r.status,'blocked');noPower(r);
 }
});
test('R20 concurrent source, Task, Wallet, legal and policy drift always blocks',async()=>{
 for(const o of [
  {source:n=>n===1?source:{...source,event_ref:'other_source_12345678901234567890'}},
  {task:n=>n===1?task:{...task,status:'cancelled'}},
  {battery:n=>n===1?result:{...result,candidate_receipt:{...receipt,wallet_revision:3}}},
  {legal:n=>n===1},{retention:n=>n===1},{policy:n=>n===1?1:2}]){
  const f=fx(o),r=await f.make().inspect(m,t,110500);
  assert.equal(r.status,'blocked');noPower(r);
 }
});
test('R20 malformed/privileged fields, getters and offline DB exceptions are denied',async()=>{
 const getter={...source};Object.defineProperty(getter,'member_ref',{get(){throw Error('SECRET')},enumerable:true});
 for(const o of [{source:getter},{source:{...source,publisher:true}},
  {task:{...task,oauth_sub:'secret'}},
  {source:()=>{throw Error('DB unavailable')}},
  {battery:()=>{throw Error('Battery unavailable')}}]){
  const f=fx(o),r=await f.make().inspect(m,t,110500);
  assert.equal(r.status,'blocked');noPower(r);
 }
});
