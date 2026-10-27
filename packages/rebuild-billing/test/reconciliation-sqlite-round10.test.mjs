import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createOfflineBillingReconciler} from '../src/reconciliation.ts';
import {createOfflineReconciliationD1Ports,RECONCILIATION_SQL}
 from '../src/reconciliation-d1-ports.ts';
const now=1793100000,ref='r_'+'a'.repeat(64);
const scope={brandId:'starry',appId:'starry.alpha',environment:'staging',
 storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.alpha'};
const d='d'.repeat(64);
const schema=readFileSync(new URL('../schema/0005_reconciliation_lease_DRAFT.sql',import.meta.url),'utf8');
function setup(options={}){
 const db=new DatabaseSync(':memory:');db.exec(schema);
 db.prepare('INSERT INTO billing_reconcile_job_DRAFT (job_ref,app_id,environment,store,store_app_id,offer_id,kind,source_version,next_due_sec) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(ref,scope.appId,scope.environment,scope.store,scope.storeAppId,'alpha.monthly','monthly',7,now-1);
 const state={clock:now,queries:0};
 const adapter={prepare(sql){
  assert.ok(Object.values(RECONCILIATION_SQL).includes(sql));
  return {args:[],bind(...a){this.args=a;return this;},
   async first(){const row=db.prepare(sql).get(...this.args);return row===undefined?null:{...row};},
   async all(){return {results:db.prepare(sql).all(...this.args).map(x=>({...x}))};}};
 }};
 const ports=createOfflineReconciliationD1Ports({
  db:adapter,scope,enabledSandbox:true,maxAttempts:5,retryAfterSeconds:300,
  nowSeconds:()=>state.clock,
  readCommittedSource:async job=>options.missing?null:{
   jobRef:job.jobRef,brandId:'starry',appId:scope.appId,store:scope.store,
   storeAppId:scope.storeAppId,offerId:job.offerId,kind:job.kind,
   version:7,isDeleted:false,latestEffectiveSec:now-100,
   latestEventDigest:'c'.repeat(64)},
  requerySandbox:async job=>{
   state.queries++;
   if(options.storeDown)throw Error('provider unavailable');
   return {store:scope.store,storeAppId:scope.storeAppId,offerId:job.offerId,
    kind:job.kind,state:options.state??'RENEWED',
    effectiveSec:options.old?now-150:now-1,eventDigest:d};
  },
 });
 const runner=()=>createOfflineBillingReconciler({scope,enabledSandbox:true,
  batchLimit:10,leaseSeconds:60,maxAttempts:5,ports});
 const row=()=>({...db.prepare('SELECT * FROM billing_reconcile_job_DRAFT').get()});
 return {db,state,ports,runner,row,close:()=>db.close()};
}
test('REAL SQLite: UPDATE RETURNING lease and CAS review work; successful requery resets attempts',async t=>{
 const a=setup();t.after(a.close);
 assert.deepEqual(await a.runner().runOnce(),{status:'ran',claimed:1,
  reviewed:0,candidateObservations:1,retry:0,publishable:false});
 assert.equal(a.row().status,'pending');assert.equal(a.row().attempts,0);
 assert.equal(a.row().next_due_sec,now+300);
 assert.equal(a.row().last_review_digest,d);
 assert.equal(a.row().lease_token,null);
 assert.equal((await a.runner().runOnce()).claimed,0);
});
test('REAL SQLite: two contenders can claim only once',async t=>{
 const a=setup();t.after(a.close);
 const results=await Promise.all([a.runner().runOnce(),a.runner().runOnce()]);
 assert.equal(results.reduce((sum,x)=>sum+x.candidateObservations,0),1);
 assert.equal(a.state.queries,1);
});
test('REAL SQLite: new owner after expired lease fences out original token',async t=>{
 const a=setup();t.after(a.close);
 const old=(await a.ports.leaseDueJobs(scope,now,1,60))[0];
 a.state.clock=now+60;
 const newer=(await a.ports.leaseDueJobs(scope,now+60,1,60))[0];
 assert.notEqual(old.leaseToken,newer.leaseToken);
 assert.equal(await a.ports.recordReviewCAS({
  jobRef:ref,leaseToken:old.leaseToken,expectedVersion:old.version,
  observedAtSec:now,result:'candidate_observation',
  reason:'SANDBOX_REQUERY_OBSERVED',newState:'PAID',eventDigest:d,publishable:false}),false);
 assert.equal(a.row().status,'leased');
});
test('REAL SQLite: deletion or source version bump before CAS cannot restore rights',async t=>{
 for(const sql of ['is_deleted=1','source_version=8']){
  const a=setup();t.after(a.close);
  const lease=(await a.ports.leaseDueJobs(scope,now,1,60))[0];
  a.db.exec('UPDATE billing_reconcile_job_DRAFT SET '+sql);
  assert.equal(await a.ports.recordReviewCAS({
   jobRef:ref,leaseToken:lease.leaseToken,expectedVersion:7,observedAtSec:now,
   result:'candidate_observation',reason:'SANDBOX_REQUERY_OBSERVED',
   newState:'RENEWED',eventDigest:d,publishable:false}),false);
  assert.equal(a.row().last_review_result,null);
 }
});
test('REAL SQLite: missing committed source cannot produce a review receipt',async t=>{
 const a=setup({missing:true});t.after(a.close);
 assert.equal((await a.runner().runOnce()).retry,1);
 assert.equal(a.row().status,'leased');
 assert.equal(a.row().last_review_result,null);
});
test('REAL SQLite: reordered refund becomes review_only and stops auto requery',async t=>{
 const a=setup({old:true,state:'REFUNDED'});t.after(a.close);
 assert.equal((await a.runner().runOnce()).reviewed,1);
 assert.equal(a.row().status,'review_only');
 a.state.clock=now+500;
 assert.equal((await a.runner().runOnce()).claimed,0);
});
test('REAL SQLite: 5 retries exhaust attempt budget',async t=>{
 const a=setup({missing:true});t.after(a.close);
 for(let i=0;i<5;i++){
  assert.equal((await a.runner().runOnce()).retry,1);
  a.state.clock+=60;
 }
 assert.equal(a.row().attempts,5);
 assert.equal((await a.runner().runOnce()).claimed,0);
});
test('REAL SQLite DRAFT schema refuses paid Battery, HGlobal and production',async t=>{
 const a=setup();t.after(a.close);
 for(const [column,value] of [
  ['offer_id','paid.battery'],['brand_id','hglobal'],
  ['environment','production'],['store_environment','production'],['attempts',6]]){
  assert.throws(()=>a.db.prepare('UPDATE billing_reconcile_job_DRAFT SET '+column+'=?').run(value));
 }
});
test('Malformed second due row is rejected BEFORE partial claim',async()=>{
 let claims=0;
 const port=createOfflineReconciliationD1Ports({
  scope,enabledSandbox:true,maxAttempts:5,retryAfterSeconds:300,nowSeconds:()=>now,
  readCommittedSource:async()=>null,requerySandbox:async()=>{throw Error('never');},
  db:{prepare(){return {bind(){return this;},
   async all(){return {results:[{job_ref:ref,source_version:7},{job_ref:'oops',source_version:7}]};},
   async first(){claims++;return null;}};}}
 });
 await assert.rejects(port.leaseDueJobs(scope,now,5,60),/RECONCILE_D1_LIST_DENIED/);
 assert.equal(claims,0);
});
test('Malformed reordered conflict cannot mutate durable review',async t=>{
 const a=setup();t.after(a.close);
 const lease=(await a.ports.leaseDueJobs(scope,now,1,60))[0];
 await assert.rejects(a.ports.recordReviewCAS({jobRef:ref,
  leaseToken:lease.leaseToken,expectedVersion:7,observedAtSec:now,
  result:'review_required',reason:'REORDERED_OR_CONFLICT',
  newState:'PAID',eventDigest:'spoof',publishable:false}),
 /RECONCILE_D1_RECEIPT_DENIED/);
 assert.equal(a.row().last_review_result,null);
});
