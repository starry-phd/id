import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineR18BatteryRecoveryReview,R18_BATTERY_HOLDS_SQL,
 R18_OFFLINE_TASK_SQL,LIVE_R18_BATTERY_RECOVERY_ENABLED}
 from '../src/r18-cross-d1-recovery-review.ts';
import {BATTERY_R16_RECEIPT_SQL,R16_CANDIDATE_SINGLE_PUBLISHER}
 from '../src/r16-battery-publisher-receipt.ts';
import {VERIFIED_AUTH_OUTBOX_SQL} from '../src/auth-deletion-battery-bridge.ts';
const id='delete_event_12345678901234567890';
const scope={brand_id:'starry',environment:'staging'};
const source={event_id:id,s_user_id:'member_1',occurred_at:110,event_type:'account_deleted'};
const auth={...source,status:'deleted',auth_version:2,deleted_at:110,unrevoked_sessions:0};
const receipt={event_id:id,member_ref:'member_1',event_type:'account_deleted',
 occurred_at_ms:110000,policy_version:1,applied:1,revoked:1,balance:0,
 wallet_version:3,journal_revision:3,kind:'revoke',delta:-3,balance_after:0,
 reason_code:'ACCOUNT_DELETED',pending_holds:0};
const floor={event_id:id,member_ref:'member_1',environment:'staging',
 occurred_at_ms:110000,policy_version:1,minimum_wallet_revision:3,
 revoked:1,recorded_at_ms:110100,witness_revision:1};
const holds=[{task_ref:'task_1',member_ref:'member_1',status:'revoked'}];
const tasks=[{task_ref:'task_1',member_ref:'member_1',environment:'staging',status:'cancelled'}];
const unchanged=x=>structuredClone(x);
function make(opts={}){
 const counts={source:0,auth:0,receipt:0,floor:0,holds:0,task:0,legal:0,policy:0,retention:0};
 function choose(key,num,otherwise){
  const v=opts[key];return typeof v==='function'?v(num,counts):v===undefined?unchanged(otherwise):v;
 }
 const db=(kind)=>({prepare(sql){
  const expected={auth:VERIFIED_AUTH_OUTBOX_SQL,receipt:BATTERY_R16_RECEIPT_SQL,
   holds:R18_BATTERY_HOLDS_SQL,task:R18_OFFLINE_TASK_SQL}[kind];
  assert.equal(sql,expected);
  return {bind(...values){
   const params={auth:[id,'member_1',110,'staging'],
    receipt:['staging',id,'member_1',110000],holds:['member_1'],task:['member_1','staging']};
   assert.deepEqual(values,params[kind]);
   return {
    async first(){counts[kind]++;return choose(kind,counts[kind],kind==='auth'?auth:receipt);},
    async all(){counts[kind]++;return choose(kind,counts[kind],kind==='holds'?holds:tasks);}
   };
  }};
 }});
 const config={enabled:true,scope,publisher_id:R16_CANDIDATE_SINGLE_PUBLISHER,
  publisher:{async readCommittedOriginal(ref,s){
   counts.source++;assert.equal(ref,id);assert.deepEqual(s,scope);
   return choose('source',counts.source,source);
  }},
  authDb:db('auth'),batteryDb:{prepare(sql){
   return sql===BATTERY_R16_RECEIPT_SQL?db('receipt').prepare(sql):
    db('holds').prepare(sql);
  }},taskDb:db('task'),
  independentFloor:{async read(s,ref){
   counts.floor++;assert.deepEqual(s,scope);assert.equal(ref,id);
   return choose('floor',counts.floor,floor);
  }},
  lawfulPurposeNow:async()=>{counts.legal++;return choose('legal',counts.legal,true);},
  lawfulRetentionNow:async()=>{counts.retention++;return choose('retention',counts.retention,true);},
  approvedPolicyVersionNow:async()=>{counts.policy++;return choose('policy',counts.policy,1);}
 };
 return {gate:(overrides={})=>createOfflineR18BatteryRecoveryReview({...config,...overrides}),
  counts};
}
const assertNoAuthority=(r)=>{
 assert.equal(r.may_ack_queue,false);assert.equal(r.may_restore,false);
 assert.equal(r.may_regrant,false);assert.equal(r.may_settle_task,false);
 assert.equal(r.may_release_task,false);assert.equal(r.live,false);
};
test('R18 positive consistent offline evidence is REVIEW ONLY, not release',async()=>{
 assert.equal(LIVE_R18_BATTERY_RECOVERY_ENABLED,false);
 const f=make(),r=await f.gate().assess(id,110500);
 assert.equal(r.status,'review_only');assert.equal(r.reason,'OFFLINE_CONSISTENT_NOT_AUTHORIZED_FOR_RECOVERY');
 assertNoAuthority(r);assert.equal(f.counts.receipt,2);assert.equal(f.counts.floor,2);
});
test('R18 disabled and invalid opaque input cannot read member evidence',async()=>{
 const f=make();
 assert.equal((await f.gate({enabled:false}).assess(id,110500)).reason,'DISABLED');
 for(const bad of [{event_id:id,verified:true},'bad',null]){
  assert.equal((await f.gate().assess(bad,110500)).status,'blocked');
 }
 assert.equal(f.counts.source,0);
});
test('R18 Starry-only and one configured Auth logical source',()=>{
 const f=make();
 assert.throws(()=>f.gate({scope:{brand_id:'hglobal',environment:'staging'}}),/SCOPE/);
 assert.throws(()=>f.gate({publisher_id:'ai4.forwarder'}),/SCOPE/);
});
test('R18 legal, retention and policy must pass before any protected reads',async()=>{
 for(const opts of [{legal:false},{retention:false},{policy:null},{policy:0}]){
  const f=make(opts),r=await f.gate().assess(id,110500);
  assert.equal(r.status,'blocked');assert.equal(f.counts.source,0);
  assert.equal(f.counts.receipt,0);assert.equal(f.counts.task,0);assertNoAuthority(r);
 }
});
test('R18 local inbox truncated/missing, stale policy and no revocation cannot pass',async()=>{
 for(const val of [null,{...receipt,applied:0},{...receipt,policy_version:2},
  {...receipt,journal_revision:2},{...receipt,balance:1},
  {...receipt,pending_holds:1}]){
  const f=make({receipt:val}),r=await f.gate().assess(id,110500);
  assert.equal(r.reason,'BATTERY_RECEIPT_MISSING_TRUNCATED_OR_STALE');assertNoAuthority(r);
 }
});
test('R18 missing independent floor must fail closed even with genuine local receipt',async()=>{
 const f=make({floor:null}),r=await f.gate().assess(id,110500);
 assert.equal(r.reason,'INDEPENDENT_NONROLLBACK_WITNESS_MISSING');assertNoAuthority(r);
 assert.equal(f.counts.task,0);
});
test('R18 PITR old local wallet revision below independently pinned floor',async()=>{
 const f=make({floor:{...floor,minimum_wallet_revision:5}});
 const r=await f.gate().assess(id,110500);
 assert.equal(r.reason,'PITR_WALLET_BELOW_INDEPENDENT_FLOOR');assertNoAuthority(r);
});
test('R18 rejects floor mismatch, foreign brand, hidden fields, extra secrets',async()=>{
 const invalid=[{...floor,environment:'production'},{...floor,member_ref:'member_2'},
  {...floor,policy_version:2},{...floor,oauth_sub:'leak'}, {...floor,revoked:0}];
 for(const val of invalid){
  const f=make({floor:val}),r=await f.gate().assess(id,110500);
  assert.equal(r.status,'blocked');assertNoAuthority(r);
 }
});
test('R18 a committed separate Task without Wallet settlement is blocked',async()=>{
 for(const status of ['held','revoked','released']){
  const f=make({tasks:[{...tasks[0],status:'committed'}],holds:[{...holds[0],status}]});
  const r=await f.gate().assess(id,110500);
  assertNoAuthority(r);
  assert.equal(r.status,'blocked');
  assert.match(r.reason,/TASK_COMMITTED|WALLET_HOLD/);
 }
});
test('R18 committed Task and committed Wallet still only permits offline review',async()=>{
 const f=make({tasks:[{...tasks[0],status:'committed'}],
  holds:[{...holds[0],status:'committed'}]});
 const r=await f.gate().assess(id,110500);
 assert.equal(r.status,'review_only');assertNoAuthority(r);
});
test('R18 missing Task row, missing Wallet hold, pending Task fail closed',async()=>{
 for(const opts of [{tasks:[]},{holds:[]},{tasks:[{...tasks[0],status:'pending'}]}]){
  const f=make(opts),r=await f.gate().assess(id,110500);
  assert.equal(r.status,'blocked');assertNoAuthority(r);
 }
});
test('R18 Auth source/session reactivation or outbox replay race blocked',async()=>{
 for(const opts of [{auth:{...auth,unrevoked_sessions:1}},
  {source:(n)=>n===1?source:{...source,s_user_id:'member_2'}},
  {auth:(n)=>n===1?auth:{...auth,status:'active'}}]){
  const f=make(opts),r=await f.gate().assess(id,110500);
  assert.equal(r.status,'blocked');assertNoAuthority(r);
 }
});
test('R18 double read detects floor, Task and Battery races, including PITR',async()=>{
 for(const opts of [
  {floor:n=>n===1?floor:{...floor,minimum_wallet_revision:4}},
  {receipt:n=>n===1?receipt:null},
  {task:n=>n===1?tasks:[]},
  {holds:n=>n===1?holds:[]} ]){
  const f=make(opts),r=await f.gate().assess(id,110500);
  assert.equal(r.status,'review_only');assertNoAuthority(r);
 }
});
test('R18 legal withdrawal/policy rotation at final check cannot become review approval',async()=>{
 for(const opts of [{legal:n=>n===1},{retention:n=>n===1},
  {policy:n=>n===1?1:2}]){
  const f=make(opts),r=await f.gate().assess(id,110500);
  assert.equal(r.reason,'LAW_OR_POLICY_CHANGED_DURING_REVIEW');assertNoAuthority(r);
 }
});
test('R18 source, Task, floor outages or getter injection fail closed',async()=>{
 const bad={...floor};Object.defineProperty(bad,'member_ref',{enumerable:true,
  get(){throw Error('UNTRUSTED');}});
 for(const opts of [{source:()=>{throw Error('DOWN');}},{task:()=>{throw Error('DOWN');}},
  {floor:bad}]){
  const f=make(opts),r=await f.gate().assess(id,110500);
  assert.equal(r.status,'blocked');assertNoAuthority(r);
 }
});
