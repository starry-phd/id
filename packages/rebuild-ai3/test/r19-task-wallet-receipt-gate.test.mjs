import test from 'node:test';
import assert from 'node:assert/strict';
import {AI3_R19_AUTH_SQL,AI3_R19_TASK_SQL,AI3_R19_WALLET_SQL,
 LIVE_AI3_R19_TASK_SETTLEMENT_ENABLED,createOfflineR19TaskWalletReview}
 from '../src/r19-task-wallet-receipt-gate.ts';
const env={brand_id:'starry',environment:'staging'};
const member='member_1',taskRef='task_1';
const ref='auth_task_source_1234567890123456789';
const auth={member_ref:member,environment:'staging',status:'active',
 auth_version:3,session_revoked:0,policy_version:1};
const taskRow={task_ref:taskRef,member_ref:member,environment:'staging',
 source_event_ref:ref,status:'committed',commit_attempt:1,
 completed_at_ms:110000,policy_version:1};
const wallet={task_ref:taskRef,member_ref:member,hold_status:'committed',
 created_ms:1000,expires_ms:181000,hold_policy_version:1,rate_version:1,
 price:7,balance:3,wallet_version:4,revoked:0,reserve_entries:1,
 commit_entries:1,commit_revision:4,commit_balance_after:3};
const proof={source_event_ref:ref,member_ref:member,environment:'staging',
 auth_version:3,policy_version:1,observed_at_ms:100000,witness_revision:1};
const floor={task_ref:taskRef,member_ref:member,environment:'staging',
 minimum_wallet_revision:4,policy_version:1,witness_revision:1};
const clone=x=>structuredClone(x);
function fixture(options={}){
 const counts={auth:0,task:0,wallet:0,provenance:0,floor:0,legal:0,
  retention:0,policy:0};
 function value(key,fallback){counts[key]++;let v=options[key];
  return typeof v==='function'?v(counts[key]):v===undefined?clone(fallback):v;
 }
 const sql=(kind,required,params,defaultValue)=>({prepare(s){
  assert.equal(s,required);return {bind(...a){
   assert.deepEqual(a,params);return {async first(){return value(kind,defaultValue);}};
  }};
 }});
 const dependencies={enabled:true,scope:env,
  authDb:sql('auth',AI3_R19_AUTH_SQL,[member,'staging'],auth),
  taskDb:sql('task',AI3_R19_TASK_SQL,[taskRef,member,'staging'],taskRow),
  batteryDb:sql('wallet',AI3_R19_WALLET_SQL,[member,taskRef],wallet),
  provenance:{readCandidate:async(event,s)=>{assert.equal(event,ref);
   assert.deepEqual(s,env);return value('provenance',proof);}},
  floor:{readCandidate:async(task,s)=>{assert.equal(task,taskRef);
   assert.deepEqual(s,env);return value('floor',floor);}},
  lawfulPurposeNow:async()=>value('legal',true),
  lawfulRetentionNow:async()=>value('retention',true),
  approvedPolicyVersionNow:async()=>value('policy',1)};
 return {counts,gate:(override={})=>createOfflineR19TaskWalletReview({
  ...dependencies,...override})};
}
function noRights(r){
 assert.equal(r.may_ack_queue,false);assert.equal(r.may_settle,false);
 assert.equal(r.may_release,false);assert.equal(r.may_regrant,false);
 assert.equal(r.may_restore,false);assert.equal(r.may_sell_battery,false);
 assert.equal(r.live,false);
}
test('R19 all three read-only mocked ports show candidate, never authorize ACK or battery sale',async()=>{
 assert.equal(LIVE_AI3_R19_TASK_SETTLEMENT_ENABLED,false);
 const f=fixture(),out=await f.gate().inspect(member,taskRef,110500);
 assert.equal(out.status,'review_only');noRights(out);
 assert.deepEqual(out.candidate_receipt,{brand_id:'starry',environment:'staging',
  task_ref:taskRef,source_event_ref:ref,policy_version:1,wallet_revision:4,
  task_attempt:1,kind:'OFFLINE_UNTRUSTED_LOCAL_RECEIPT'});
 assert.equal(f.counts.auth,3);assert.equal(f.counts.task,2);
});
test('R19 disabled and foreign brand reject without any private DB read',async()=>{
 const f=fixture();
 assert.equal((await f.gate({enabled:false}).inspect(member,taskRef,110500)).reason,'DISABLED');
 assert.throws(()=>f.gate({scope:{brand_id:'hglobal',environment:'staging'}}),/SCOPE/);
 assert.equal(f.counts.auth,0);
});
test('R19 legal, lawful retention and policy are tested before member lookups',async()=>{
 for(const o of [{legal:false},{retention:false},{policy:null},{policy:0}]){
  const f=fixture(o),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.status,'blocked');noRights(out);
  assert.equal(f.counts.auth,0);assert.equal(f.counts.task,0);
 }
});
test('R19 reject deleted member, revoked session and stale Auth policy',async()=>{
 for(const a of [{...auth,status:'deleted'},{...auth,session_revoked:1},
  {...auth,policy_version:2},{...auth,auth_version:0},null]){
  const f=fixture({auth:a}),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.reason,'AUTH_NOT_CURRENT_OR_MEMBER_REVOKED');noRights(out);
 }
});
test('R19 current member deleted between precheck and Task proof blocks',async()=>{
 const f=fixture({auth:n=>n===1?auth:{...auth,status:'deleted'}});
 const out=await f.gate().inspect(member,taskRef,110500);
 assert.equal(out.reason,'AUTH_REVOKED_BETWEEN_CHECKS');noRights(out);
});
test('R19 Task committed while reserve held, expired or wallet locally only reserved',async()=>{
 for(const w of [{...wallet,hold_status:'held',commit_entries:0,commit_revision:null,
  commit_balance_after:null},{...wallet,hold_status:'held',expires_ms:110000,
  commit_entries:0},{...wallet,hold_status:'committed',commit_entries:0}]){
  const f=fixture({wallet:w}),out=await f.gate().inspect(member,taskRef,200000);
  assert.equal(out.status,'blocked');noRights(out);
 }
});
test('R19 duplicate task attempts and stale or forged task event blocked',async()=>{
 for(const t of [{...taskRow,commit_attempt:2},
  {...taskRow,source_event_ref:'bad'}, {...taskRow,policy_version:2},
  {...taskRow,status:'pending'},null]){
  const f=fixture({task:t}),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.status,'blocked');noRights(out);
 }
});
test('R19 Wallet journal duplicate/reserve gap, revoked member or inconsistent version rejected',async()=>{
 for(const w of [{...wallet,reserve_entries:2},
  {...wallet,commit_entries:2},{...wallet,commit_revision:3},
  {...wallet,revoked:1},{...wallet,hold_policy_version:2},
  {...wallet,commit_balance_after:15},null]){
  const f=fixture({wallet:w}),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.status,'blocked');noRights(out);
 }
});
test('R19 no approved independent signed provenance means no receipt, ever',async()=>{
 for(const p of [null,{...proof,auth_version:2},
  {...proof,environment:'development'},{...proof,untrusted:true}]){
  const f=fixture({provenance:p}),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.reason,'INDEPENDENT_SIGNED_AUTH_PROVENANCE_UNAVAILABLE');
  assert.equal(out.candidate_receipt,null);noRights(out);
 }
});
test('R19 missing independent floor or PITR behind floor cannot restore',async()=>{
 for(const o of [{floor:null},{floor:{...floor,minimum_wallet_revision:5}},
  {floor:{...floor,policy_version:2}}]){
  const f=fixture(o),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.status,'blocked');noRights(out);
 }
});
test('R19 partially committed Task, Battery, Auth or floor between reads blocks',async()=>{
 for(const o of [{task:n=>n===1?taskRow:{...taskRow,status:'cancelled'}},
  {wallet:n=>n===1?wallet:{...wallet,commit_entries:0}},
  {auth:n=>n<=2?auth:{...auth,session_revoked:1}},
  {floor:n=>n===1?floor:{...floor,minimum_wallet_revision:5}},
  {provenance:n=>n===1?proof:null}]){
  const f=fixture(o),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.reason,'MULTI_DB_PARTIAL_COMMIT_OR_CONCURRENT_RACE');noRights(out);
 }
});
test('R19 policy revocation, lawful retention expiration after commit blocks',async()=>{
 for(const o of [{legal:n=>n===1},{retention:n=>n===1},
  {policy:n=>n===1?1:2}]){
  const f=fixture(o),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.reason,'LAW_OR_POLICY_CHANGED_DURING_CHECK');noRights(out);
 }
});
test('R19 malformed records, DB unavailable or getter provenance never authorize',async()=>{
 const malicious={...proof};Object.defineProperty(malicious,'member_ref',{
  enumerable:true,get(){throw Error('SECRET');}});
 for(const o of [{wallet:()=>{throw Error('DB');}},{provenance:malicious},
  {task:{...taskRow,session_token:'PII'}}]){
  const f=fixture(o),out=await f.gate().inspect(member,taskRef,110500);
  assert.equal(out.status,'blocked');noRights(out);
 }
});
