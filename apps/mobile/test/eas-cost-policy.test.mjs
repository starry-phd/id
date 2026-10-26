import test from 'node:test';
import assert from 'node:assert/strict';
import {planUnapprovedEasOperation} from '../src/eas-cost-policy.ts';
const proposal={brand_id:'starry',app_id:'starry-id',platform:'ios',environment:'staging',
 repo:'starry-phd/id',pr:41,commit_sha:'a'.repeat(40),
 trigger_reason:'Native OAuth login verification after Gate',
 operation:'build',runtime_version:'54.0.0'};
test('DEV-I rule: every PR may run CI, never auto-spend EAS Build, Update or Workflows',()=>{
 for(const operation of ['build','update','workflow']){
  const r=planUnapprovedEasOperation({...proposal,operation});
  assert.equal(r.execution_allowed,false);assert.equal(r.approved,false);
  assert.equal(r.evidence.status,'not_started');
  assert.equal(r.evidence.eas_build_id,null);assert.equal(r.evidence.eas_update_id,null);
  assert.equal(r.evidence.actual_billed_usd,null);assert.equal(r.evidence.estimated_usd,null);
 }
});
test('DEV-I release evidence rejects other brand, forged prices, unauthorized build ID and bad sha',()=>{
 for(const bad of [
  {brand_id:'hglobal'},{app_id:'other'},{environment:'sandbox'},
  {commit_sha:'unknown'},{repo:'wrong/repo'},{trigger_reason:'x'}, {operation:'pay'},
  {eas_build_id:'faked'}, {estimated_usd:0},{billing_source:'fabricated'}
 ]){
  assert.throws(()=>planUnapprovedEasOperation({...proposal,...bad}),/EAS_INVALID_EVIDENCE/);
 }
});
