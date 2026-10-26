import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_BATTERY_WRITES_ENABLED,BATTERY_PRICE,RESERVATION_TTL_MS,
 OVERDRAFT_MAX_USES,newWallet,registrationGrant,reserveTask,finishTask,
 expireTask,adminCorrect,revokeDeleted} from '../src/free-battery.ts';
// TEST FIXTURES ONLY. X=10/Y=6 DO NOT CONSTITUTE APPROVED REAL AMOUNTS.
const s={brand_id:'starry',member_ref:'anon_member'};
const p={brand_id:'starry',version:1,registration_grant:10,first_task_grant:6,
 max_debt:15,max_task_cost:12,
 rates:[{app_id:'starry-ai',task_type:'chat',price:7,version:1},
 {app_id:'starry-tools',task_type:'summarize',price:10,version:1}]};
const auth=()=>({authorizePolicy:async()=>true,verifyRegistrationGrant:async()=>true,
 verifyTaskRequest:async()=>true,verifyTaskOutcome:async()=>true,
 verifyFirstEligibleTask:async()=>true,verifyAdminStepUp:async()=>true,
 verifyDeletion:async()=>true});
const task=(ref='task_1',app='starry-ai',type='chat')=>({task_ref:ref,app_id:app,task_type:type});
const initial=async()=>registrationGrant(newWallet(s),p,auth(),1000);
test('permanent free Starry-only, no live writes/FEFO, exact 3min/2 overdrafts',()=>{
 assert.equal(LIVE_BATTERY_WRITES_ENABLED,false);assert.equal(BATTERY_PRICE,'permanently_free');
 assert.equal(RESERVATION_TTL_MS,180000);assert.equal(OVERDRAFT_MAX_USES,2);
 assert.throws(()=>newWallet({...s,brand_id:'hglobal'}),/SCOPE_DENIED/);
});
test('registration grant X before task, exactly once, pending policy authority fail-closed',async()=>{
 const a=auth();let w=newWallet(s);
 await assert.rejects(reserveTask(w,p,a,task(),2000),/BOOTSTRAP_REQUIRED/);
 w=await registrationGrant(w,p,a,1000);assert.equal(w.balance,10);
 assert.equal(await registrationGrant(w,p,a,1001),w);
 a.authorizePolicy=async()=>false;
 await assert.rejects(reserveTask(w,p,a,task(),2000),/AUTHORITY_DENIED/);
});
test('first legitimate success grants Y one time, failed task does not',async()=>{
 const a=auth();let w=await initial();
 w=await reserveTask(w,p,a,task(),2000);
 w=await finishTask(w,p,a,'task_1','failure',2100);
 assert.equal(w.balance,10);assert.equal(w.first_task_granted,false);
 w=await reserveTask(w,p,a,task('task_2'),2200);
 w=await finishTask(w,p,a,'task_2','success',2300);
 assert.equal(w.balance,9);assert.equal(w.first_task_granted,true);
 assert.equal(await finishTask(w,p,a,'task_2','success',2400),w);
 w=await reserveTask(w,p,a,task('task_3','starry-tools','summarize'),2500);
 w=await finishTask(w,p,a,'task_3','success',2600);
 assert.equal(w.journal.filter(e=>e.kind==='first_task_grant').length,1);
});
test('fixed per-App rate in hold retains original price across new policy',async()=>{
 const a=auth();let w=await initial();w=await reserveTask(w,p,a,task(),2000);
 const next={...p,version:2,rates:p.rates.map(r=>({...r,price:r.price+1,version:2}))};
 w=await finishTask(w,next,a,'task_1','failure',2100);
 assert.equal(w.balance,10);assert.equal(w.holds[0].price,7);
});
test('duplicate reserve idempotent, conflict across App / unknown task denied',async()=>{
 const a=auth();let w=await initial();w=await reserveTask(w,p,a,task(),2000);
 assert.equal(await reserveTask(w,p,a,task(),2010),w);
 await assert.rejects(reserveTask(w,p,a,task('task_1','starry-tools','summarize'),2010),/TASK_CONFLICT/);
 await assert.rejects(reserveTask(w,p,a,task('t_bad','hglobal','chat'),2010),/UNAPPROVED_TASK_RATE/);
});
test('3-minute boundary never late-success double charges or grants',async()=>{
 const a=auth();let w=await initial();w=await reserveTask(w,p,a,task(),2000);
 w=await finishTask(w,p,a,'task_1','success',182000);
 assert.equal(w.balance,10);assert.equal(w.holds[0].status,'expired');
 await assert.rejects(finishTask(w,p,a,'task_1','success',182001),/STALE_OR_CONFLICTING_RESULT/);
 assert.equal(w.first_task_granted,false);
});
test('separate TTL expiry only once; premature expiry rejected',async()=>{
 const a=auth();let w=await initial();w=await reserveTask(w,p,a,task(),2000);
 await assert.rejects(expireTask(w,p,a,'task_1',181999),/NOT_EXPIRED/);
 w=await expireTask(w,p,a,'task_1',182000);
 assert.equal(w.balance,10);assert.equal(await expireTask(w,p,a,'task_1',182001),w);
});
test('two overdraft uses maximum, third denied independent of app',async()=>{
 const a=auth();let w=await initial();
 w=await reserveTask(w,p,a,task('t1','starry-tools','summarize'),2000);
 w=await reserveTask(w,p,a,task('t2'),2100);
 w=await reserveTask(w,p,a,task('t3'),2200);
 assert.equal(w.balance,-14);assert.equal(w.overdraft_used,2);
 await assert.rejects(reserveTask(w,p,a,task('t4'),2300),/OVERDRAFT_DENIED/);
});
test('debt cap is server policy; cannot exceed by additional task',async()=>{
 const a=auth();let w=await initial();
 w=await reserveTask(w,p,a,task('t1','starry-tools','summarize'),2000);
 await assert.rejects(reserveTask(w,{...p,max_debt:5,version:2},a,task('t2'),2200),/OVERDRAFT_DENIED/);
});
test('full debt repayment resets two uses; partial repayment does not',async()=>{
 const a=auth();let w=await initial();
 w=await reserveTask(w,p,a,task('t1','starry-tools','summarize'),2000);
 w=await reserveTask(w,p,a,task('t2'),2100);
 assert.equal(w.overdraft_used,1);
 w=await adminCorrect(w,p,a,{ref:'r1',delta:3,reason_code:'ADMIN_CREDIT'},2200);
 assert.equal(w.overdraft_used,1);
 w=await finishTask(w,p,a,'t2','failure',2300);
 assert.equal(w.overdraft_used,0);assert.equal(w.balance,3);
});
test('admin requires Step-up, reason, conservative cap and append-only correction',async()=>{
 const a=auth();let w=await initial();a.verifyAdminStepUp=async()=>false;
 await assert.rejects(adminCorrect(w,p,a,{ref:'r1',delta:2,reason_code:'ADMIN_FIX'},2000),/ADMIN_AUTHORITY_DENIED/);
 a.verifyAdminStepUp=async()=>true;
 w=await adminCorrect(w,p,a,{ref:'r1',delta:2,reason_code:'ADMIN_FIX'},2000);
 assert.equal(w.balance,12);assert.equal(await adminCorrect(w,p,a,{ref:'r1',delta:2,reason_code:'ADMIN_FIX'},2200),w);
 await assert.rejects(adminCorrect(w,p,a,{ref:'r1',delta:3,reason_code:'ADMIN_FIX'},2200),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(adminCorrect(w,p,a,{ref:'r2',delta:-13,reason_code:'ADMIN_FIX'},2200),/ADMIN_LIMIT_DENIED/);
});
test('server must validate task and successful outcome; deny client flags',async()=>{
 const a=auth();let w=await initial();a.verifyTaskRequest=async()=>false;
 await assert.rejects(reserveTask(w,p,a,task(),2000),/TASK_AUTHORITY_DENIED/);
 a.verifyTaskRequest=async()=>true;w=await reserveTask(w,p,a,task(),2000);
 a.verifyTaskOutcome=async()=>false;
 await assert.rejects(finishTask(w,p,a,'task_1','success',2100),/OUTCOME_AUTHORITY_DENIED/);
 assert.equal(w.holds[0].status,'held');
});
test('first-task gift denied without server eligibility evidence',async()=>{
 const a=auth();let w=await initial();w=await reserveTask(w,p,a,task(),2000);
 a.verifyFirstEligibleTask=async()=>false;
 await assert.rejects(finishTask(w,p,a,'task_1','success',2100),/FIRST_TASK_AUTHORITY_REQUIRED/);
});
test('deleted wallet revoked, no resurrection even on duplicate registration',async()=>{
 const a=auth();let w=await initial();w=await reserveTask(w,p,a,task(),2000);
 a.verifyDeletion=async()=>false;
 await assert.rejects(revokeDeleted(w,p,a,3000),/DELETION_AUTHORITY_DENIED/);
 a.verifyDeletion=async()=>true;w=await revokeDeleted(w,p,a,3000);
 assert.equal(w.revoked,true);assert.equal(w.balance,0);assert.equal(w.holds[0].status,'revoked');
 assert.equal(await revokeDeleted(w,p,a,3000),w);
 await assert.rejects(registrationGrant(w,p,a,3001),/REVOKED/);
});
test('re-registration anti-abuse must come from lawful AI-1 gate',async()=>{
 const a=auth();a.verifyRegistrationGrant=async()=>false;
 await assert.rejects(registrationGrant(newWallet({...s,member_ref:'new_account'}),p,a,2000),/REGISTRATION_GATE/);
});
test('refuse unapproved amounts, cross-brand policy, duplicate App/task rates',async()=>{
 for(const bad of [{...p,registration_grant:-1},{...p,brand_id:'hglobal'},
  {...p,rates:[...p.rates,p.rates[0]]}])
  await assert.rejects(registrationGrant(newWallet(s),bad,auth(),1000),/POLICY|DUPLICATE_RATE/);
});
