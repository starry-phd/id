import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineBillingReconciler} from '../src/reconciliation.ts';
import {createOfflineReconciliationD1Ports,RECONCILIATION_SQL,RECONCILIATION_D1_PUBLISHABLE}
 from '../src/reconciliation-d1-ports.ts';
const NOW=1793100000,REF='r_'+'a'.repeat(64);
const S={brandId:'starry',appId:'starry.alpha',environment:'staging',storeEnvironment:'sandbox',
 store:'apple',storeAppId:'phd.starry.alpha'};
function setup(opts={}){
 const row={job_ref:REF,source_version:7,offer_id:'alpha.monthly',kind:'monthly',
  app_id:S.appId,store:S.store,store_app_id:S.storeAppId,next_due_sec:NOW-1,
  lease_token:null,lease_until_sec:null,attempts:0,status:'pending',is_deleted:0,
  ...(opts.initial??{})};
 const h={row,reads:0,queries:0,writes:0,clock:NOW};
 const db={prepare(sql){return {args:[],bind(...a){this.args=a;return this;},
  async all(){
   assert.equal(sql,RECONCILIATION_SQL.due);
   if(opts.badList)return {results:[{job_ref:REF}]};
   const a=this.args;
   const valid=row.is_deleted===0&&row.next_due_sec<=a[4]&&row.attempts<a[5]
    &&(row.status==='pending'||row.status==='leased'&&row.lease_until_sec<=a[6]);
   return {results:valid?[{job_ref:REF,source_version:row.source_version}]:[]};
  },
  async first(){
   h.writes++;const a=this.args;
   if(sql===RECONCILIATION_SQL.claim){
    if(opts.race)return null;
    if(a[2]!==REF||row.source_version!==a[7]||row.is_deleted!==0
      ||row.attempts>=a[9]||row.next_due_sec>a[8]
      ||row.status==='leased'&&row.lease_until_sec>a[10])return null;
    row.lease_token=a[0];row.lease_until_sec=a[1];row.attempts++;row.status='leased';
    return {job_ref:REF,offer_id:row.offer_id,kind:row.kind,app_id:row.app_id,
     store:row.store,store_app_id:row.store_app_id,
     due_at_sec:row.next_due_sec,lease_token:a[0],lease_until_sec:a[1],
     version:row.source_version,attempts:row.attempts};
   }
   if(sql===RECONCILIATION_SQL.review){
    if(opts.reviewFail)throw Error('d1-down');
    if(row.lease_token!==a[7]||row.source_version!==a[8]||row.is_deleted!==0
     ||row.status!=='leased'||row.lease_until_sec<=a[13])return null;
    row.status=a[0]==='review_required'?'review_only':'pending';
    row.next_due_sec=a[1];row.lease_token=null;row.lease_until_sec=null;
    if(a[0]==='candidate_observation')row.attempts=0;
    row.last_review_result=a[3];row.last_review_digest=a[4];
    return {job_ref:REF};
   }
   throw Error('unexpected SQL');
  },
 }}};
 const setupPorts={db,scope:S,enabledSandbox:true,maxAttempts:5,
  retryAfterSeconds:3600,nowSeconds:()=>h.clock,
  readCommittedSource:async job=>{
   h.reads++;
   if(opts.sourceMissing)return null;
   if(opts.sourceFails)throw Error('source down');
   return {jobRef:job.jobRef,brandId:'starry',appId:S.appId,store:S.store,
    storeAppId:S.storeAppId,offerId:job.offerId,kind:job.kind,version:7,
    isDeleted:opts.deleted??false,latestEffectiveSec:NOW-100,
    latestEventDigest:'c'.repeat(64)};
  },
  requerySandbox:async job=>{
   h.queries++;
   if(opts.storeFails)throw Error('Store down');
   return {store:S.store,storeAppId:S.storeAppId,offerId:job.offerId,
    kind:job.kind,state:opts.state??'RENEWED',
    effectiveSec:opts.old?NOW-150:NOW-1,eventDigest:'d'.repeat(64)};
  },
 };
 const ports=createOfflineReconciliationD1Ports(setupPorts);
 const run=createOfflineBillingReconciler({scope:S,enabledSandbox:true,batchLimit:3,
  leaseSeconds:60,maxAttempts:5,ports});
 return {h,run,ports,setupPorts};
}
test('D1-shaped SQL fenced lease + metadata-only CAS with reset attempt budget',async()=>{
 const {h,run}=setup();
 assert.deepEqual(await run.runOnce(),{status:'ran',claimed:1,reviewed:0,
  candidateObservations:1,retry:0,publishable:false});
 assert.equal(h.writes,2);assert.equal(h.row.attempts,0);
 assert.equal(h.row.status,'pending');assert.equal(h.row.next_due_sec,NOW+3600);
 assert.equal(h.row.last_review_result,'candidate_observation');
 assert.equal(RECONCILIATION_D1_PUBLISHABLE,false);
 assert.equal(Object.hasOwn(h.row,'entitlement'),false);
});
test('No due, deletion, over limit or manual review: no store call or DB write',async()=>{
 for(const initial of [{next_due_sec:NOW+1},{is_deleted:1},{attempts:5},{status:'review_only'}]){
  const {h,run}=setup({initial});
  assert.equal((await run.runOnce()).claimed,0);
  assert.equal(h.queries,0);assert.equal(h.writes,0);
 }
});
test('Concurrent D1 claim loser must not query Store or write review',async()=>{
 const {h,run}=setup({race:true});
 assert.equal((await run.runOnce()).claimed,0);
 assert.equal(h.queries,0);assert.equal(h.writes,1);
});
test('No committed row or Store outage: only lease, no false ACK or grant',async()=>{
 for(const v of [{sourceMissing:true},{sourceFails:true},{storeFails:true}]){
  const {h,run}=setup(v);
  assert.equal((await run.runOnce()).retry,1);
  assert.equal(h.writes,1);assert.equal(h.row.status,'leased');
 }
});
test('Reordered refund goes to review_only, never updates entitlement',async()=>{
 const {h,run}=setup({old:true,state:'REFUNDED'});
 assert.equal((await run.runOnce()).reviewed,1);
 assert.equal(h.row.status,'review_only');
});
test('Delete, version race, expired lease reject stale review receipt',async()=>{
 for(const mutate of [h=>h.row.is_deleted=1,h=>h.row.source_version=8,h=>h.clock=NOW+60]){
  const {h,ports}=setup();
  const orig=ports.recordReviewCAS;
  const patched={...ports,recordReviewCAS:async r=>{mutate(h);return orig(r);}};
  const run=createOfflineBillingReconciler({scope:S,enabledSandbox:true,batchLimit:3,
   leaseSeconds:60,maxAttempts:5,ports:patched});
  assert.equal((await run.runOnce()).retry,1);
  assert.equal(h.row.last_review_result,undefined);
 }
});
test('Foreign scope or H-Global/production config cannot query or lease',async()=>{
 const {h,ports,setupPorts}=setup();
 await assert.rejects(ports.leaseDueJobs({...S,appId:'hglobal.app'},NOW,3,60),
  /RECONCILE_D1_SCOPE_DENIED/);
 for(const scope of [{...S,brandId:'hglobal'},{...S,environment:'production'},
  {...S,storeEnvironment:'production'}]){
  assert.throws(()=>createOfflineReconciliationD1Ports({...setupPorts,scope}),
   /RECONCILE_D1_CONFIG_DENIED/);
 }
 assert.equal(h.writes,0);
});
test('Untrusted client receipt cannot generate Store proof',async()=>{
 const {h,ports}=setup();
 await assert.rejects(ports.recordReviewCAS({jobRef:REF,leaseToken:'fake',
  expectedVersion:7,observedAtSec:NOW,result:'candidate_observation',
  reason:'SANDBOX_REQUERY_OBSERVED',newState:'PAID',
  eventDigest:'d'.repeat(64),publishable:false}),/RECONCILE_D1_RECEIPT_DENIED/);
 assert.equal(h.writes,0);
});
test('Malformed due list and failed review are never treated as success',async()=>{
 await assert.rejects(setup({badList:true}).run.runOnce(),/RECONCILE_LEASE_UNAVAILABLE/);
 const {h,run}=setup({reviewFail:true});
 assert.equal((await run.runOnce()).retry,1);
 assert.equal(h.row.status,'leased');
});
