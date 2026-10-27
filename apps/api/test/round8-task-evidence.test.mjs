import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineServerTaskAuthority,TASK_EVIDENCE_SCHEMA,
 LIVE_TASK_PROOF_ENABLED,OFFLINE_TEST_PORT_ONLY} from '../src/task-evidence.ts';
import {newWallet,registrationGrant,reserveTask,finishTask,RESERVATION_TTL_MS,
 LIVE_BATTERY_WRITES_ENABLED} from '../../../packages/rebuild-ai3/src/free-battery.ts';
const scope={brand_id:'starry',member_ref:'member_01'};
const p={brand_id:'starry',version:3,registration_grant:4,first_task_grant:3,
 max_debt:4,max_task_cost:4,rates:[{app_id:'starry-ai',task_type:'generate',price:2,version:7}]};
const proof=(overrides={})=>({
 schema_version:TASK_EVIDENCE_SCHEMA,brand_id:'starry',member_ref:scope.member_ref,
 task_ref:'task_01',app_id:'starry-ai',task_type:'generate',policy_version:3,
 rate_version:7,price:2,request_state:'accepted',proof_state:'committed',
 proof_source:'server_task_engine',proof_revision:1,completed_at:null,...overrides
});
function fixture(){
 let current=proof(),approved=p,first=null;
 const source={
  async readTask(){return current;},
  async readPolicy(){return approved;},
  async readFirstSuccessfulTask(){return first;}
 };
 return {port:createOfflineServerTaskAuthority(source),
  setTask:(v)=>{current=v;},setPolicy:(v)=>{approved=v;},setFirst:(v)=>{first=v;}};
}
test('Q99 backend-only price registry: exact version/rate, no battery purchase or automatic live writes',async()=>{
 const f=fixture();
 assert.equal(LIVE_TASK_PROOF_ENABLED,false);
 assert.equal(OFFLINE_TEST_PORT_ONLY,true);
 assert.equal(LIVE_BATTERY_WRITES_ENABLED,false);
 assert.equal(await f.port.authorizePolicy(p),true);
 assert.equal(await f.port.authorizePolicy({...p,registration_grant:999}),false);
 assert.equal(await f.port.authorizePolicy({...p,rates:[{...p.rates[0],price:1}]}),false);
 assert.equal(await f.port.authorizePolicy({...p,rates:[...p.rates,...p.rates]}),false);
 f.setPolicy({...p,version:4});
 assert.equal(await f.port.authorizePolicy(p),false);
 assert.equal(await f.port.verifyTaskRequest(scope,'task_01','starry-ai','generate'),false);
});
test('Q91 source-of-truth requires committed server task and exact subject/app/task/version/price',async()=>{
 const f=fixture();
 assert.equal(await f.port.verifyTaskRequest(scope,'task_01','starry-ai','generate'),true);
 for(const changed of [
  {proof_state:'pending'}, {proof_source:'client'}, {request_state:'succeeded',completed_at:1},
  {member_ref:'another'}, {brand_id:'hglobal'}, {task_ref:'replay_02'},
  {app_id:'unapproved'}, {task_type:'other'}, {policy_version:2},
  {rate_version:8},{price:4},{completed_at:77},{proof_revision:0}
 ]){
  f.setTask(proof(changed));
  assert.equal(await f.port.verifyTaskRequest(scope,'task_01','starry-ai','generate'),false,
   JSON.stringify(changed));
 }
 f.setTask(proof());
 assert.equal(await f.port.verifyTaskRequest({...scope,brand_id:'hglobal'},
  'task_01','starry-ai','generate'),false);
 assert.equal(await f.port.verifyTaskRequest({...scope,member_ref:'someone_else'},
  'task_01','starry-ai','generate'),false);
 assert.equal(await f.port.verifyTaskRequest(scope,'task_01','fake-app','generate'),false);
 assert.equal(await f.port.verifyTaskRequest(scope,'task_01','starry-ai','fake-type'),false);
});
test('fail closed on malformed records, hidden fields, accessors, fake policy and revoked proxies',async()=>{
 const f=fixture();
 for(const invalid of [null,[],{...proof(),clientApproved:true},
  Object.assign(Object.create({user:true}),proof()),
  {...proof(),proof_revision:2.5},
  {...proof(),completed_at:77}, {...proof(),schema_version:'unexpected'}]){
  f.setTask(invalid);
  assert.equal(await f.port.verifyTaskRequest(scope,'task_01','starry-ai','generate'),false);
 }
 const getter=proof();
 Object.defineProperty(getter,'request_state',{enumerable:true,get(){throw Error('getter');}});
 f.setTask(getter);
 assert.equal(await f.port.verifyTaskRequest(scope,'task_01','starry-ai','generate'),false);
 const revoked=Proxy.revocable(proof(),{});revoked.revoke();
 f.setTask(revoked.proxy);
 assert.equal(await f.port.verifyTaskRequest(scope,'task_01','starry-ai','generate'),false);
 f.setTask(proof());
 f.setPolicy({...p,rates:[{...p.rates[0],price:2,client_flag:true}]});
 assert.equal(await f.port.authorizePolicy(p),false);
 assert.equal(await f.port.verifyTaskRequest(scope,'task_01','starry-ai','generate'),false);
 assert.throws(()=>createOfflineServerTaskAuthority({readTask:async()=>proof(),
  readPolicy:async()=>p,readFirstSuccessfulTask:async()=>null,clientApproved:true}),
 /AI4_TASK_SOURCE_REQUIRED/);
});
test('Q109 successful outcome and FIRST eligible lookup must be committed and same member',async()=>{
 const f=fixture();
 assert.equal(await f.port.verifyTaskOutcome(scope,'task_01','success'),false);
 f.setTask(proof({request_state:'succeeded',completed_at:1000,proof_revision:2}));
 assert.equal(await f.port.verifyTaskOutcome(scope,'task_01','success'),true);
 assert.equal(await f.port.verifyTaskOutcome(scope,'task_01','failure'),false);
 assert.equal(await f.port.verifyFirstEligibleTask(scope,'task_01'),false);
 f.setFirst('other_task');
 assert.equal(await f.port.verifyFirstEligibleTask(scope,'task_01'),false);
 f.setFirst('task_01');
 assert.equal(await f.port.verifyFirstEligibleTask(scope,'task_01'),true);
 f.setTask(proof({request_state:'failed',completed_at:1000}));
 assert.equal(await f.port.verifyTaskOutcome(scope,'task_01','success'),false);
 assert.equal(await f.port.verifyTaskOutcome(scope,'task_01','failure'),true);
 assert.equal(await f.port.verifyFirstEligibleTask(scope,'task_01'),false);
});
test('R8 actual AI-4 → AI-3 integration: forged client result never grants Y, then committed source does',async()=>{
 const f=fixture();
 const a={
  ...f.port,
  verifyMemberActive:async(s)=>s.brand_id==='starry',
  verifyRegistrationGrant:async()=>true, // TEST ONLY, AI-1 privacy Gate not passed
  verifyAdminStepUp:async()=>false,verifyDeletion:async()=>false
 };
 let w=newWallet(scope);
 w=await registrationGrant(w,p,a,0); // fixture X=4, not approved live X
 assert.equal(w.balance,4);
 w=await reserveTask(w,p,a,{task_ref:'task_01',app_id:'starry-ai',task_type:'generate'},100);
 assert.equal(w.balance,2);
 assert.equal(w.holds[0].status,'held');
 // Even if an HTTP caller sends 'success', authoritative record is still accepted.
 await assert.rejects(finishTask(w,p,a,'task_01','success',1000),/OUTCOME_AUTHORITY_DENIED/);
 assert.equal(w.first_task_granted,false);
 f.setTask(proof({request_state:'succeeded',completed_at:900,proof_revision:2}));
 // Still cannot credit first success without independent committed-first-task lookup.
 await assert.rejects(finishTask(w,p,a,'task_01','success',1000),/FIRST_TASK_AUTHORITY_REQUIRED/);
 f.setFirst('task_01');
 const completed=await finishTask(w,p,a,'task_01','success',1000);
 assert.equal(completed.holds[0].status,'committed');
 assert.equal(completed.balance,5); // fixture remaining 2 + Y fixture 3
 assert.equal(completed.first_task_granted,true);
 assert.equal(completed.journal.filter(x=>x.kind==='first_task_grant').length,1);
 const replay=await finishTask(completed,p,a,'task_01','success',1100);
 assert.deepEqual(replay,completed);
});
test('Q101 late completion after three minutes cannot debit or receive first-task grant',async()=>{
 const f=fixture();const a={
  ...f.port,verifyMemberActive:async()=>true,verifyRegistrationGrant:async()=>true,
  verifyAdminStepUp:async()=>false,verifyDeletion:async()=>false
 };
 let w=await registrationGrant(newWallet(scope),p,a,0);
 w=await reserveTask(w,p,a,{task_ref:'task_01',app_id:'starry-ai',task_type:'generate'},100);
 f.setTask(proof({request_state:'succeeded',completed_at:100,proof_revision:2}));
 f.setFirst('task_01');
 const expired=await finishTask(w,p,a,'task_01','success',100+RESERVATION_TTL_MS);
 assert.equal(expired.balance,4);
 assert.equal(expired.first_task_granted,false);
 assert.equal(expired.holds[0].status,'expired');
 await assert.rejects(finishTask(expired,p,a,'task_01','success',100+RESERVATION_TTL_MS+1),
  /STALE_OR_CONFLICTING_RESULT/);
});
test('true provider outage and fake client booleans do not create Task authority',async()=>{
 let reads=0;
 const ports=createOfflineServerTaskAuthority({
  readTask:async()=>{reads++;throw Error('D1 offline');},
  readPolicy:async()=>p,
  readFirstSuccessfulTask:async()=>{throw Error('no source');}
 });
 assert.equal(await ports.verifyTaskRequest(scope,'task_01','starry-ai','generate'),false);
 assert.equal(await ports.verifyTaskOutcome(scope,'task_01','success'),false);
 assert.equal(await ports.verifyFirstEligibleTask(scope,'task_01'),false);
 assert.equal(reads,3);
 const f=fixture();
 const forged={...scope,verified:true,taskSucceeded:true};
 assert.equal(await f.port.verifyTaskRequest(forged,'task_01','starry-ai','generate'),false);
});
