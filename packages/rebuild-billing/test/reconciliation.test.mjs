import test from 'node:test';
import assert from 'node:assert/strict';
import {
 BILLING_RECONCILIATION_PUBLISHABLE,
 BILLING_RECONCILIATION_VERSION,createOfflineBillingReconciler,
} from '../src/reconciliation.ts';
const clock=1793100000;
const ref='r_'+'a'.repeat(64);
const lease='r_'+'b'.repeat(64);
const dig='c'.repeat(64);
const scope={brandId:'starry',appId:'starry.alpha',
 environment:'staging',storeEnvironment:'sandbox',
 store:'apple',storeAppId:'phd.starry.alpha'};
const job={jobRef:ref,leaseToken:lease,appId:scope.appId,store:scope.store,
 storeAppId:scope.storeAppId,offerId:'alpha.monthly',kind:'monthly',
 dueAtSec:clock-1,leaseUntilSec:clock+60,attempts:1,version:7};
const source={jobRef:ref,brandId:'starry',appId:scope.appId,store:scope.store,
 storeAppId:scope.storeAppId,offerId:job.offerId,kind:job.kind,
 version:7,isDeleted:false,latestEffectiveSec:clock-100,
 latestEventDigest:dig};
const observed={store:scope.store,storeAppId:scope.storeAppId,
 offerId:job.offerId,kind:job.kind,state:'RENEWED',
 effectiveSec:clock-1,eventDigest:'d'.repeat(64)};
function fixture(opts={}){
 const calls={leased:0,read:0,queried:0,cas:0,receipts:[],scope:null};
 const ports={
  nowSeconds:()=>opts.clock??clock,
  async leaseDueJobs(s,now,batchSize,leaseSeconds){
   calls.leased++;calls.scope=s;
   assert.equal(now,opts.clock??clock);
   assert.ok(batchSize>=1&&batchSize<=25);
   assert.ok(leaseSeconds>=10&&leaseSeconds<=300);
   if(opts.leaseThrow)throw new Error('db down');
   return opts.jobs??[opts.job??job];
  },
  async readCommittedSource(j){
   calls.read++;assert.ok(j.jobRef.startsWith('r_'));
   if(opts.sourceThrow)throw new Error('read down');
   return opts.source===undefined?source:opts.source;
  },
  async requerySandbox(j){
   calls.queried++;assert.equal(j.appId,scope.appId);
   if(opts.storeThrow)throw new Error('fake-offline-store-off');
   return opts.observation??observed;
  },
  async recordReviewCAS(receipt){
   calls.cas++;calls.receipts.push(receipt);
   if(opts.casThrow)throw new Error('cas failed');
   return opts.casOk??true;
  },
 };
 return {calls,executor:createOfflineBillingReconciler({
  scope:opts.scope??scope,enabledSandbox:opts.enabledSandbox??true,
  batchLimit:opts.batchLimit??5,leaseSeconds:60,maxAttempts:5,ports,
 })};
}
test('Q113 sandbox periodic requery never grants rights or marks P05 publishable',async()=>{
 const {calls,executor}=fixture();
 const got=await executor.runOnce();
 assert.deepEqual(got,{status:'ran',claimed:1,reviewed:0,
  candidateObservations:1,retry:0,publishable:false});
 assert.equal(BILLING_RECONCILIATION_PUBLISHABLE,false);
 assert.match(BILLING_RECONCILIATION_VERSION,/candidate$/);
 assert.deepEqual(calls.receipts,[{
  jobRef:ref,leaseToken:lease,expectedVersion:7,
  observedAtSec:clock,result:'candidate_observation',
  reason:'SANDBOX_REQUERY_OBSERVED',newState:'RENEWED',
  eventDigest:observed.eventDigest,publishable:false,
 }]);
 assert.equal('entitlement'in calls.receipts[0],false);
 assert.equal('ownerUserId'in calls.receipts[0],false);
});
test('default-disabled sandbox executor cannot open store, lease or write DB',async()=>{
 const {executor,calls}=fixture({enabledSandbox:false});
 assert.deepEqual(await executor.runOnce(),{
  status:'disabled',claimed:0,reviewed:0,
  candidateObservations:0,retry:0,publishable:false,
 });
 assert.equal(calls.leased,0);assert.equal(calls.cas,0);
 assert.equal(calls.queried,0);
});
test('uncommitted Billing source / D1 failure is retry ONLY, no store call and no CAS',async()=>{
 for(const x of [{source:null},{sourceThrow:true}]){
  const {executor,calls}=fixture(x);
  assert.equal((await executor.runOnce()).retry,1);
  assert.equal(calls.queried,0);
  assert.equal(calls.cas,0);
 }
});
test('Q88 delete causes review-only restriction; never requery or revive purchase',async()=>{
 const {executor,calls}=fixture({source:{...source,isDeleted:true}});
 const got=await executor.runOnce();
 assert.equal(got.reviewed,1);
 assert.equal(calls.queried,0);
 assert.equal(calls.receipts[0].reason,'DELETED_OR_FOREIGN');
 assert.equal(calls.receipts[0].newState,null);
});
test('Q113 authoritative later-period refund is metadata-only, not a local grant',async()=>{
 const {executor,calls}=fixture({observation:{...observed,state:'REFUNDED'}});
 assert.equal((await executor.runOnce()).candidateObservations,1);
 assert.equal(calls.receipts[0].newState,'REFUNDED');
 assert.equal('right'in calls.receipts[0],false);
});
test('reordered old refund and same-time conflicting digest are review-only',async()=>{
 for(const update of [
  {effectiveSec:source.latestEffectiveSec-1,state:'REFUNDED'},
  {effectiveSec:source.latestEffectiveSec,eventDigest:'e'.repeat(64)},
 ]){
  const {executor,calls}=fixture({observation:{...observed,...update}});
  const got=await executor.runOnce();
  assert.equal(got.reviewed,1);
  assert.equal(calls.receipts[0].reason,'REORDERED_OR_CONFLICT');
 }
});
test('same-time same-digest duplicate does not change a right or create an event',async()=>{
 const {executor,calls}=fixture({observation:{...observed,
  effectiveSec:source.latestEffectiveSec,eventDigest:source.latestEventDigest}});
 assert.equal((await executor.runOnce()).candidateObservations,1);
 assert.equal(calls.cas,1);
});
test('unavailable provider / invalid or untrusted provider result retries without writing',async()=>{
 for(const override of [
  {storeThrow:true},{observation:{...observed,storeAppId:'wrong.app'}},
  {observation:{...observed,store:'google'}},
  {observation:{...observed,kind:'one_time'}},
  {observation:{...observed,effectiveSec:clock+1}},
  {observation:{...observed,eventDigest:'bad'}},
  {observation:{...observed,state:'new_paid'}},
  {observation:Object.create(null)},
  {observation:new Proxy({}, {getPrototypeOf(){throw Error('revoked')}})},
 ]){
  const {executor,calls}=fixture(override);
  assert.equal((await executor.runOnce()).retry,1);
  assert.equal(calls.cas,0);
 }
});
test('cross-brand / foreign app / stale version source cannot authorize store query',async()=>{
 for(const update of [
  {brandId:'hglobal'},{appId:'hglobal.app'},{store:'google'},
  {storeAppId:'wrong.app'},{offerId:'unlisted'},
  {version:8},{jobRef:'r_'+'9'.repeat(64)},
  {latestEventDigest:'bad'},
 ]){
  const {executor,calls}=fixture({source:{...source,...update}});
  assert.equal((await executor.runOnce()).retry,1);
  assert.equal(calls.queried,0);
  assert.equal(calls.cas,0);
 }
});
test('database CAS rejected after lease expiry/race must retry, never acknowledge completion',async()=>{
 for(const opts of [{casOk:false},{casThrow:true}]){
  const {executor,calls}=fixture(opts);
  const result=await executor.runOnce();
  assert.equal(result.retry,1);
  assert.equal(result.candidateObservations,0);
  assert.equal(calls.cas,1);
 }
});
test('Q113 job leases are strictly scoped, must be due and fresh, with bounded attempts',async()=>{
 for(const j of [
  {...job,appId:'hglobal.app'},{...job,store:'google'},
  {...job,storeAppId:'wrong'},{...job,offerId:'paid.battery'},
  {...job,dueAtSec:clock+1},{...job,leaseUntilSec:clock},
  {...job,attempts:0},{...job,attempts:6},{...job,attempts:1.2},
  {...job,version:0},{...job,leaseToken:'forge'},
  {...job,jobRef:'client'},Object.create(null),
 ]){
  const {executor,calls}=fixture({job:j});
  await assert.rejects(executor.runOnce(),/RECONCILE_LEASE_DENIED/);
  assert.equal(calls.queried,0);
  assert.equal(calls.cas,0);
 }
});
test('duplicate jobRef in batch is rejected before any provider query',async()=>{
 const {executor,calls}=fixture({jobs:[job,{...job,leaseToken:'r_'+'d'.repeat(64)}]});
 await assert.rejects(executor.runOnce(),/RECONCILE_LEASE_DENIED/);
 assert.equal(calls.read,0);
 assert.equal(calls.queried,0);
});
test('malformed or too-large leased batch fails closed with no DB writes',async()=>{
 for(const jobs of [[job,job,job,job,job,job],{0:job,length:1}]){
  const {executor,calls}=fixture({jobs});
  await assert.rejects(executor.runOnce(),/RECONCILE_LEASE_DENIED/);
  assert.equal(calls.cas,0);
 }
});
test('Provider outage and D1 leasing outage produce retry/reject, never assume healthy',async()=>{
 const {executor,calls}=fixture({leaseThrow:true});
 await assert.rejects(executor.runOnce(),/RECONCILE_LEASE_UNAVAILABLE/);
 assert.equal(calls.queried,0);
});
test('constructor fails closed for production/H-Global/paid Battery/unsafe lease policy',()=>{
 const base=fixture();
 // Build independent ports from the same offline executor fixture behavior.
 const fakePorts={leaseDueJobs:async()=>[],readCommittedSource:async()=>null,
  requerySandbox:async()=>observed,recordReviewCAS:async()=>false,nowSeconds:()=>clock};
 for(const changes of [
  {scope:{...scope,brandId:'hglobal'}},
  {scope:{...scope,environment:'production'}},
  {scope:{...scope,storeEnvironment:'production'}},
  {scope:{...scope,store:'hglobal'}},
  {batchLimit:26},{leaseSeconds:301},{maxAttempts:100},
 ]){
  assert.throws(()=>createOfflineBillingReconciler({
   scope,enabledSandbox:true,batchLimit:5,leaseSeconds:60,maxAttempts:5,ports:fakePorts,...changes,
  }),/RECONCILE_CONFIG_DENIED/);
 }
 assert.ok(base.executor);
});
