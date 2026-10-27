import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineTaskRecoveryReview,createOfflineTaskBoundRecovery,
 LIVE_TASK_RECOVERY_ENABLED,TASK_RECOVERY_SCHEMA,MAX_REVIEW_TASKS}
 from '../src/task-recovery-integrity.ts';
import {FENCE_NAMES,LIVE_RECOVERY_ENABLED,RESTORE_MUTATION_ALLOWED}
 from '../../../packages/rebuild-ai3/src/recovery-guard.ts';

const scope={brand_id:'starry',environment:'isolated-test',dataset:'battery'};
const row=(o={})=>({task_ref:'task_01',member_ref:'member_01',app_id:'starry-ai',
 task_type:'generate',policy_version:2,rate_version:3,price:2,proof_revision:5,
 completed_ms:1000,outcome:'succeeded',...o});
const rows=()=>[row(),row({task_ref:'task_02',outcome:'failed',completed_ms:1020})];
function source(){
 let current=rows(),pitr=rows(),backup=rows(),verified=true,anchorCalls=0;
 const ports={
  readCurrentCommittedTasks:async()=>current,
  readPitrCommittedTasks:async()=>pitr,
  readIndependentCommittedTasks:async()=>backup,
  verifyProtectedTaskAnchor:async(_scope,digest,count)=>{
   anchorCalls++;
   return verified&&/^[a-f0-9]{64}$/.test(digest)&&count===current.length;
  }
 };
 return {ports,review:createOfflineTaskRecoveryReview(ports),
  current:v=>{current=v},pitr:v=>{pitr=v},backup:v=>{backup=v},
  anchor:v=>{verified=v},get anchorCalls(){return anchorCalls}};
}
const allFences=()=>Object.fromEntries(FENCE_NAMES.map(k=>[k,5]));
const artifact=(source,id,hash)=>({source,artifact_ref:id,manifest_sha256:hash,
 captured_ms:1000,checkpoints:allFences()});
const bundle=()=>({
 scope,artifacts:[artifact('d1_pitr','pitr_one','a'.repeat(64)),
 artifact('independent_backup','backup_one','b'.repeat(64))],
 request_ref:'request_one',requested_ms:1500
});
const restorePorts=()=>({
 verifyPitr:async()=>true,verifyIndependentBackup:async()=>true,
 readAuthoritativeFences:async()=>allFences(),
 readLegalHold:async()=> 'clear',
 verifyOperatorStepUp:async()=>true,recordReviewEvidence:async()=>true
});
test('R10 deep row digest checks 3 sources + separate anchor, never authorizes restore',async()=>{
 const x=source(),r=await x.review.review(scope);
 assert.equal(TASK_RECOVERY_SCHEMA,'starry.task-recovery.v0-draft');
 assert.equal(LIVE_TASK_RECOVERY_ENABLED,false);
 assert.equal(LIVE_RECOVERY_ENABLED,false);
 assert.equal(RESTORE_MUTATION_ALLOWED,false);
 assert.equal(r.disposition,'review_only');assert.equal(r.may_restore,false);
 assert.equal(x.anchorCalls,1);
});
test('same watermark and row-count but changed task content is blocked',async()=>{
 for(const modified of [
  row({price:3}),row({outcome:'failed'}),row({member_ref:'member_02'}),
  row({rate_version:4}),row({completed_ms:1001}),row({proof_revision:6})
 ]){
  const x=source();
  x.backup([modified,row({task_ref:'task_02',outcome:'failed',completed_ms:1020})]);
  assert.equal((await x.review.review(scope)).reason,'TASK_RECORD_DRIFT_OR_REPLAY');
  assert.equal(x.anchorCalls,0);
 }
});
test('deleted row, duplicate ID, out-of-order with identical records and alternate task fail safe',async()=>{
 const x=source();x.pitr([row()]);
 assert.equal((await x.review.review(scope)).disposition,'blocked');
 const y=source();y.backup([row(),row()]);
 assert.equal((await y.review.review(scope)).reason,'TASK_SOURCE_UNAVAILABLE_OR_INVALID');
 const z=source();z.backup([...rows()].reverse());
 assert.equal((await z.review.review(scope)).disposition,'review_only');
 const w=source();w.current([row({task_ref:'task_99'}),row({task_ref:'task_02',
  outcome:'failed',completed_ms:1020})]);
 assert.equal((await w.review.review(scope)).disposition,'blocked');
});
test('protected independent anchor deny/failure fails closed even if all rows equal',async()=>{
 const x=source();x.anchor(false);
 assert.equal((await x.review.review(scope)).reason,'PROTECTED_ANCHOR_UNVERIFIED');
 const y=source();
 const ports={...y.ports,verifyProtectedTaskAnchor:async()=>{throw Error('unavailable')}};
 assert.equal((await createOfflineTaskRecoveryReview(ports).review(scope)).disposition,'blocked');
});
test('malformed task rows, policy flags, secret fields, accessors and revoked proxies are denied',async()=>{
 const revoked=Proxy.revocable(row(),{});revoked.revoke();
 for(const invalid of [null,{},[row({proof_revision:0})],
  [row({outcome:'accepted'})],[row({brand_id:'hglobal'})],
  [row({clientApproved:true})],[row(),row()],
  [revoked.proxy],Array.from({length:MAX_REVIEW_TASKS+1},(_,i)=>
    row({task_ref:'t'+i}))]){
  const x=source();x.current(invalid);
  assert.equal((await x.review.review(scope)).disposition,'blocked');
  assert.equal(x.anchorCalls,0);
 }
 const z=source(),bad=row();
 Object.defineProperty(bad,'price',{enumerable:true,get(){throw Error('accessor')}});
 z.backup([bad]);
 assert.equal((await z.review.review(scope)).disposition,'blocked');
});
test('bad scope, hidden fields or revoked scope, and malicious ports denied before readers',async()=>{
 const x=source();
 for(const s of [null,[],{}, {...scope,brand_id:'hglobal'},
  {...scope,environment:'production'},{...scope,clientApproved:true}]){
  assert.equal((await x.review.review(s)).disposition,'blocked');
 }
 const rv=Proxy.revocable({...scope},{});rv.revoke();
 assert.equal((await x.review.review(rv.proxy)).disposition,'blocked');
 assert.equal(x.anchorCalls,0);
 assert.throws(()=>createOfflineTaskRecoveryReview({...x.ports,
  canRestore:true}),/AI4_TASK_RECOVERY_PORT_DENIED/);
});
test('R10 integrates REAL AI-3 Q116 7-domain isolated review, but never physical restore',async()=>{
 const x=source();
 const reviewer=createOfflineTaskBoundRecovery(x.ports,restorePorts());
 const out=await reviewer.review(bundle(),2000);
 assert.deepEqual(out,{disposition:'review_only',
  reason:'DEEP_TASK_RECONCILIATION_REVIEW_ONLY',may_restore:false});
 const stale=source();stale.pitr([row()]);
 const blocked=createOfflineTaskBoundRecovery(stale.ports,restorePorts());
 assert.equal((await blocked.review(bundle(),2000)).disposition,'blocked');
});
test('AI-3 legal hold, stale 7-domain fence and missing review evidence stay blocked',async()=>{
 const x=source();const b=bundle();
 for(const changed of [
  {...restorePorts(),readLegalHold:async()=> 'held'},
  {...restorePorts(),recordReviewEvidence:async()=>false},
  {...restorePorts(),readAuthoritativeFences:async()=>({...allFences(),
   committed_ai_tasks:6})}
 ]){
  const result=await createOfflineTaskBoundRecovery(x.ports,changed).review(b,2000);
  assert.equal(result.disposition,'blocked');
  assert.equal(result.may_restore,false);
 }
});
test('source faults and refused protected anchor never produce sensitive task output',async()=>{
 const x=source();
 const bad={...x.ports,readPitrCommittedTasks:async()=>{throw Error('read failed')}};
 const result=await createOfflineTaskRecoveryReview(bad).review(scope);
 assert.deepEqual(result,{disposition:'blocked',reason:'TASK_AUTHORITY_UNAVAILABLE',
  may_restore:false});
 assert.equal(JSON.stringify(result).includes('member_01'),false);
});
