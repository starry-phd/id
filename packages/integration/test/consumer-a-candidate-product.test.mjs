import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCandidateUx,readCandidateUxInputs} from '../../../docs/product/verify-consumer-a-candidate.mjs';
const current=readCandidateUxInputs();
const changed=modify=>{const x=structuredClone(current.plan);modify(x);return x;};
test('AI-0 Consumer-A UX plan: 12 screens, 5 journeys, 9 safe messages, 12 future QA, 8 unapproved decisions',()=>{
 const a=auditCandidateUx(...Object.values(current));
 assert.equal(a.ok,true,a.errors.join(' / '));
 assert.equal(a.screen_count,12);
 assert.equal(a.journey_count,5);
 assert.equal(a.blocked_state_count,9);
 assert.equal(a.acceptance_spec_count,12);
 assert.equal(a.decisions_pending,8);
 assert.equal(a.release_gates_blocked,11);
 assert.equal(a.ui_implemented,false);
});
test('candidate UX cannot invent product name, specific task, official App ID or market validation',()=>{
 for(const modify of [
 p=>p.candidate.approved=true,
 p=>p.candidate.display_name='My New Store App',
 p=>p.candidate.specific_task='production AI task',
 p=>p.candidate.ios_bundle_id='com.some.production',
 p=>p.candidate.market_validated=true,
 p=>p.candidate.price=5,
 p=>p.release.production_app_selected=true
 ])assert.equal(auditCandidateUx(changed(modify),current.release,current.portfolio,current.devApp).ok,false);
});
test('screen access cannot expose wallet, deletion or results to guest without strong auth',()=>{
 for(const modify of [
 p=>p.screens.find(x=>x.id==='BATTERY_LEDGER').access='public_preview',
 p=>p.screens.find(x=>x.id==='DELETE_ACCOUNT').access='member',
 p=>p.screens.find(x=>x.id==='TASK_RESULT').allowed_without_login=true,
 p=>p.screens.push(p.screens[1]),
 p=>p.journeys[1].live_execution=true,
 p=>p.journeys[2].screens=['REAL_STORE_PAYMENTS']
 ])assert.equal(auditCandidateUx(changed(modify),current.release,current.portfolio,current.devApp).ok,false);
});
test('unverifiable task and deletion state never announces success/Queue ACK or grants Battery',()=>{
 for(const modify of [
 p=>p.ux_failure_states.find(x=>x.id==='TASK_UNKNOWN').success_allowed=true,
 p=>p.ux_failure_states.find(x=>x.id==='RECEIPT_MISMATCH').grant_allowed=true,
 p=>p.ux_failure_states.find(x=>x.id==='DELETION_PENDING').queue_ack_allowed=true,
 p=>p.ux_failure_states.splice(1,1),
 p=>p.acceptance_scenarios[0].status='live_verified',
 p=>p.release.cross_d1_physical_approved=true
 ])assert.equal(auditCandidateUx(changed(modify),current.release,current.portfolio,current.devApp).ok,false);
});
test('no underivable IAP, Battery sale, wave2 admin, HGlobal deployment, or real API calls',()=>{
 for(const field of ['backend_calls_authorized','paid_features_authorized','free_battery_purchasable',
 'wave2_admin_approved','hglobal_development_authorized','deploy_authorized',
 'store_listing_authorized','paid_usage_authorized'])
  assert.equal(auditCandidateUx(changed(p=>{p.release[field]=true}),current.release,current.portfolio,current.devApp).ok,false);
});
test('original release status and product portfolio must remain unresolved',()=>{
 const r=structuredClone(current.release);r.gates[0].status='verified';
 assert.equal(auditCandidateUx(current.plan,r,current.portfolio,current.devApp).ok,false);
 const po=structuredClone(current.portfolio);po.decision_queue[0].approval='YES';
 assert.equal(auditCandidateUx(current.plan,current.release,po,current.devApp).ok,false);
 const app=structuredClone(current.devApp);app.expo.name='Starry Consumer Pro';
 assert.equal(auditCandidateUx(current.plan,current.release,current.portfolio,app).ok,false);
});
