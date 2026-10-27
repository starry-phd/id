import test from 'node:test';
import assert from 'node:assert/strict';
import {auditR18,readR18Inputs} from '../../../docs/operations/verify-r18-cross-d1-preflight.mjs';
const {plan,official}=readR18Inputs();
const altered=fn=>{const x=structuredClone(plan);fn(x);return x;};
test('R18 existing R17 exact SHA and cross-D1 offline preflight keep 11 official Gates blocked',()=>{
 const v=auditR18(plan,official);
 assert.equal(v.ok,true,v.errors.join(' / '));
 assert.equal(v.blocked_gates,11);
 assert.equal(v.owner_tasks,4);assert.ok(v.scenarios>=9);
 assert.equal(v.architecture_decided,false);assert.equal(v.release_authorized,false);
 assert.equal(v.queue_ack_allowed,false);assert.equal(v.live,false);
});
test('reject pretending a physical architecture or P05 live publisher was approved',()=>{
 for(const mutate of [
  p=>p.decision.physical_consistency_architecture='B_DURABLE_OUTBOX_SAGA',
  p=>p.decision.unique_live_publisher_approved=true,
  p=>p.decision.cross_d1_atomicity_proven=true,
  p=>p.decision.true_exactly_once_proven=true,
  p=>p.decision.rollback_resistant_witness_proven=true,
  p=>p.decision.canonical_p05_approved=true
 ])assert.equal(auditR18(altered(mutate),official).ok,false);
});
test('reject ACK, paid, deployment, owner release and H-Global activation',()=>{
 for(const field of ['queue_ack_authorized','paid_usage_authorized','deployment_authorized','owner_approval_obtained','publishable'])
  assert.equal(auditR18(altered(p=>{p.authorization[field]=true}),official).ok,false);
 assert.equal(auditR18(altered(p=>{p.authorization.hglobal_paused=false}),official).ok,false);
});
test('reject wrong owner identity, inherited PR, missing task or path overlap',()=>{
 for(const mutate of [
  p=>p.owners[0].issue=3,
  p=>p.owners[1].last_verified_owner_pr=112,
  p=>p.owners[2].path_prefix='modules/starry-id-v1/',
  p=>p.owners[3].negative_cases=[],
  p=>p.owners[3].id='AI-1'
 ])assert.equal(auditR18(altered(mutate),official).ok,false);
});
test('reject unsafe failure-matrix outcome, omitted crash/PITR and fake foreign Gate',()=>{
 for(const mutate of [
  p=>p.scenario_matrix[0].may_ack_queue=true,
  p=>p.scenario_matrix[1].may_regrant=true,
  p=>p.scenario_matrix[2].live=true,
  p=>p.scenario_matrix[3].may_restore=true,
  p=>p.scenario_matrix.splice(5,1),
  p=>p.scenario_matrix[6].gate_ids=['FAKE-GATE'],
  p=>p.scenario_matrix[7].expected='release_ready'
 ])assert.equal(auditR18(altered(mutate),official).ok,false);
});
test('reject mutation to official blocked Gate or synthetic authorization',()=>{
 const fake=structuredClone(official);
 fake.gates[0].status='verified';
 assert.equal(auditR18(plan,fake).ok,false);
 const fake2=structuredClone(official);
 fake2.release_authorization.granted=true;
 assert.equal(auditR18(plan,fake2).ok,false);
});
