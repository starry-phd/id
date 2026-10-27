import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineAtomicTaskSettlement,ATOMIC_TASK_SETTLEMENT_LIVE,
 ATOMIC_SETTLEMENT_DRAFT_VERSION} from '../src/task-atomic-settlement.ts';
import {newWallet,registrationGrant,reserveTask,RESERVATION_TTL_MS} from '../../../packages/rebuild-ai3/src/free-battery.ts';
import {TASK_EVIDENCE_SCHEMA} from '../src/task-evidence.ts';
const s={brand_id:'starry',member_ref:'user_one'};
const policy={brand_id:'starry',version:8,registration_grant:4,first_task_grant:3,
 max_debt:2,max_task_cost:3,rates:[{app_id:'starry-ai',task_type:'summarize',price:2,version:10}]};
const proof=(state='succeeded',extra={})=>({
 schema_version:TASK_EVIDENCE_SCHEMA,brand_id:'starry',member_ref:'user_one',
 task_ref:'task_one',app_id:'starry-ai',task_type:'summarize',policy_version:8,
 rate_version:10,price:2,request_state:state,proof_state:'committed',
 proof_source:'server_task_engine',proof_revision:2,completed_at:500,...extra
});
async function opened(){
 const auth={
  authorizePolicy:async()=>true,verifyMemberActive:async()=>true,
  verifyRegistrationGrant:async()=>true,verifyTaskRequest:async()=>true,
  verifyTaskOutcome:async()=>true,verifyFirstEligibleTask:async()=>true,
  verifyAdminStepUp:async()=>false,verifyDeletion:async()=>false
 };
 let w=await registrationGrant(newWallet(s),policy,auth,0);
 w=await reserveTask(w,policy,auth,{task_ref:'task_one',app_id:'starry-ai',task_type:'summarize'},100);
 return w;
}
async function make(state='succeeded'){
 let wallet=await opened(),commits=0,reads=0,task=proof(state);
 let member={brand_id:'starry',member_ref:'user_one',status:'active',auth_version:1,revision:1};
 let p=policy,first='task_one',queue=Promise.resolve(),fail=false;
 const port={
  transact:(_scope,_ref,_now,evalOnce)=>{
   const next=queue.then(async()=>{
    reads++;
    const snapshot={wallet,policy:p,task,first_successful_task_ref:first,member};
    const proposal=await evalOnce(snapshot);
    if(proposal.decision==='deny')return {status:'denied',wallet_revision:null};
    if(proposal.decision==='unchanged')
     return {status:'unchanged',wallet_revision:wallet.revision};
    if(fail||proposal.expected_wallet_revision!==wallet.revision||
     proposal.expected_task_revision!==task.proof_revision||
     proposal.expected_policy_version!==p.version||member.status!=='active')
     return {status:'denied',wallet_revision:null};
    wallet=proposal.wallet;
    commits++;
    return {status:'committed',wallet_revision:wallet.revision};
   });
   queue=next.then(()=>{},()=>{});
   return next;
  }
 };
 return {settlement:createOfflineAtomicTaskSettlement(port),
  get wallet(){return wallet},get commits(){return commits},get reads(){return reads},
  task:(v)=>{task=v},policy:(v)=>{p=v},first:(v)=>{first=v},
  member:(v)=>{member=v},fail:()=>{fail=true}};
}
test('R9 Q109 single transaction candidate: outcome from committed SERVER proof not supplied by caller',async()=>{
 const f=await make();
 assert.equal(ATOMIC_TASK_SETTLEMENT_LIVE,false);
 assert.equal(ATOMIC_SETTLEMENT_DRAFT_VERSION,'starry.task-settlement.v0-draft');
 const first=await f.settlement.settle(s,'task_one',1000);
 assert.deepEqual(first,{outcome:'committed',wallet_revision:4,live:false});
 assert.equal(f.wallet.balance,5);
 assert.equal(f.wallet.first_task_granted,true);
 assert.equal(f.wallet.journal.filter(x=>x.kind==='first_task_grant').length,1);
 const again=await f.settlement.settle(s,'task_one',1010);
 assert.deepEqual(again,{outcome:'unchanged',wallet_revision:4,live:false});
 assert.equal(f.commits,1);
});
test('R9 fail closed: awaiting source, forged cost, foreign member, stale version and no Y authority',async()=>{
 const cases=[
  proof('accepted',{completed_at:null,proof_revision:1}),
  proof('succeeded',{member_ref:'other'}),
  proof('succeeded',{price:999}),
  proof('succeeded',{rate_version:9}),
  proof('succeeded',{policy_version:7}),
  proof('succeeded',{proof_source:'client'}),
  proof('succeeded',{proof_state:'pending'}),
  {...proof(),clientApproved:true}
 ];
 for(const t of cases){
  const f=await make();f.task(t);
  assert.equal((await f.settlement.settle(s,'task_one',1000)).outcome,'blocked');
  assert.equal(f.commits,0);
  assert.equal(f.wallet.first_task_granted,false);
 }
 const g=await make();g.first('some_other_task');
 assert.equal((await g.settlement.settle(s,'task_one',1000)).outcome,'blocked');
 assert.equal(g.commits,0);
});
test('R9 Q101 exact 3-minute timeout atomically releases without late Y or phantom debit',async()=>{
 const f=await make();
 const out=await f.settlement.settle(s,'task_one',100+RESERVATION_TTL_MS);
 assert.equal(out.outcome,'committed');
 assert.equal(f.wallet.balance,4);
 assert.equal(f.wallet.first_task_granted,false);
 assert.equal(f.wallet.holds[0].status,'expired');
 assert.equal((await f.settlement.settle(s,'task_one',100+RESERVATION_TTL_MS+50)).outcome,'unchanged');
 assert.equal(f.commits,1);
});
test('R9 Q88 suspend/delete before transaction = blocked, no writing or grant',async()=>{
 for(const status of ['deleted','suspended']){
  const f=await make();
  f.member({brand_id:'starry',member_ref:'user_one',status,auth_version:2,revision:2});
  assert.equal((await f.settlement.settle(s,'task_one',1000)).outcome,'blocked');
  assert.equal(f.commits,0);
 }
});
test('R9 failures inside atomic store roll back; no fake receipt grants',async()=>{
 const f=await make();f.fail();
 assert.equal((await f.settlement.settle(s,'task_one',1000)).outcome,'blocked');
 assert.equal(f.wallet.revision,2);
 assert.equal(f.commits,0);
 const bogus=createOfflineAtomicTaskSettlement({transact:async(_s,_r,_now,check)=>{
  await check({wallet:await opened(),policy,task:proof(),first_successful_task_ref:'task_one',
   member:{brand_id:'starry',member_ref:'user_one',status:'active',auth_version:1,revision:1}});
  return {status:'committed',wallet_revision:999};
 }});
 assert.equal((await bogus.settle(s,'task_one',1000)).outcome,'blocked');
});
test('R9 8 concurrent completion replays serialize: one candidate Wallet CAS, no multiple Y',async()=>{
 const f=await make();
 const results=await Promise.all(Array.from({length:8},()=>f.settlement.settle(s,'task_one',1000)));
 assert.equal(results.filter(x=>x.outcome==='committed').length,1);
 assert.equal(results.filter(x=>x.outcome==='unchanged').length,7);
 assert.equal(f.commits,1);
 assert.equal(f.wallet.first_task_granted,true);
 assert.equal(f.wallet.journal.filter(x=>x.kind==='first_task_grant').length,1);
});
test('R9 malicious scope/proxy/getters/injected result do not reach transaction',async()=>{
 const f=await make();
 for(const bad of [null,{},[],{...s,brand_id:'hglobal'},
  {...s,member_ref:'other'}, {...s,clientPaid:true}]){
  assert.equal((await f.settlement.settle(bad,'task_one',1000)).outcome,'blocked');
 }
 const revoked=Proxy.revocable({...s},{});revoked.revoke();
 assert.equal((await f.settlement.settle(revoked.proxy,'task_one',1000)).outcome,'blocked');
 assert.equal((await f.settlement.settle(s,'task_one',NaN)).outcome,'blocked');
 assert.equal((await f.settlement.settle(s,'task_one','1000')).outcome,'blocked');
 assert.equal((await f.settlement.settle(s,'task_one','taskSucceeded')).outcome,'blocked');
 assert.equal(f.reads,0);
 assert.throws(()=>createOfflineAtomicTaskSettlement({transact:async()=>{},admin:true}),
  /AI4_ATOMIC_PORT_REQUIRED/);
});
test('R9 failed committed task refunds held Battery without first-success gift',async()=>{
 const f=await make('failed');
 const x=await f.settlement.settle(s,'task_one',1000);
 assert.equal(x.outcome,'committed');
 assert.equal(f.wallet.balance,4);
 assert.equal(f.wallet.first_task_granted,false);
 assert.equal(f.wallet.holds[0].status,'released');
 assert.equal(f.wallet.journal.filter(y=>y.kind==='first_task_grant').length,0);
});
