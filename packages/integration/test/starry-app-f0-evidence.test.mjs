import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAppF0Evidence,readAppF0Inputs} from '../../../docs/product/verify-starry-app-f0-decision-evidence.mjs';
const inputs=readAppF0Inputs();
const audit=(p,r=inputs.release,o=inputs.portfolio,u=inputs.ux,a=inputs.app)=>
 auditAppF0Evidence(p,r,o,u,a);
const copy=fn=>{const p=structuredClone(inputs.plan);fn(p);return p;};
test('AI-0 F0: 3 hypotheses, 4 unrun experiments, 4 candidate decisions BLOCKED and all 11 release Gates BLOCKED',()=>{
 const r=audit(inputs.plan);
 assert.equal(r.ok,true,r.errors.join('; '));
 assert.equal(r.hypotheses,3);
 assert.equal(r.proposed_experiments,4);
 assert.equal(r.decision_gates_blocked,4);
 assert.equal(r.official_release_blocked,11);
 assert.equal(r.evidence_count,0);
 assert.equal(r.product_approved,false);
});
test('cannot invent first consumer App name, official bundle, user segment or Battery price',()=>{
 for(const fn of [
 p=>p.product_boundary.first_consumer_app_selected=true,
 p=>p.product_boundary.specific_task='official model',
 p=>p.product_boundary.official_name='Launch Now',
 p=>p.product_boundary.target_audience='Taiwan',
 p=>p.product_boundary.official_android_package='com.starry.new',
 p=>p.product_boundary.battery_x_amount=30,
 p=>p.product_boundary.published_battery_rate=2,
 p=>p.product_boundary.ai_model_cost_verified=true,
 p=>p.product_boundary.free_battery_sale_allowed=true
 ])assert.equal(audit(copy(fn)).ok,false);
});
test('cannot claim qualitative research, recruits or costs existed',()=>{
 for(const fn of [
 p=>p.proposed_evaluation.actual_market_evidence_count=1,
 p=>p.proposed_evaluation.actual_interviews_completed=5,
 p=>p.proposed_evaluation.actual_usability_sessions_completed=1,
 p=>p.proposed_evaluation.actual_cost_benchmarks_completed=1,
 p=>p.proposed_evaluation.evidences.push({url:'invented'}),
 p=>p.proposed_experiments[0].executed=true,
 p=>p.proposed_experiments[1].actual_participants=1,
 p=>p.proposed_experiments[2].status='success',
 p=>p.proposed_experiments[3].live_recruitment_authorized=true
 ])assert.equal(audit(copy(fn)).ok,false);
});
test('proposed weights and user scorecards cannot auto-select a product',()=>{
 for(const fn of [
 p=>p.proposed_evaluation.axes[0].weight=50,
 p=>p.proposed_evaluation.auto_select_allowed=true,
 p=>p.proposed_evaluation.numerical_threshold_can_approve_product=true,
 p=>p.proposed_evaluation.scorecards[0].scores={value:5},
 p=>p.proposed_evaluation.scorecards[1].selected=true,
 p=>p.hypothesis_catalog[2].approved=true,
 p=>p.hypothesis_catalog[0].status='proven'
 ])assert.equal(audit(copy(fn)).ok,false);
});
test('F0 product gates cannot unblock G00, turn Dev harness into real App or bypass product UX',()=>{
 const r=structuredClone(inputs.release);r.gates[0].status='verified';
 assert.equal(audit(inputs.plan,r).ok,false);
 const p=structuredClone(inputs.portfolio);p.decision_queue[0].approval='APPROVED';
 assert.equal(audit(inputs.plan,inputs.release,p).ok,false);
 const u=structuredClone(inputs.ux);u.candidate.approved=true;
 assert.equal(audit(inputs.plan,inputs.release,inputs.portfolio,u).ok,false);
 const a=structuredClone(inputs.app);a.expo.slug='starry-first-real-app';
 assert.equal(audit(inputs.plan,inputs.release,inputs.portfolio,inputs.ux,a).ok,false);
});
test('no accidental live development, paid tools, HGlobal or R20 owner interference',()=>{
 for(const field of ['product_decision_approved','ui_implemented','real_market_test_completed',
 'real_cost_model_validated','release_authorized','live_db_authorized',
 'queue_ack_authorized','paid_usage_authorized','hglobal_development_authorized',
 'main_merge_authorized','cloudflare_deploy_authorized','publishable'])
 assert.equal(audit(copy(p=>{p.mvp_boundary[field]=true})).ok,false);
 assert.equal(audit(copy(p=>p.gates[0].status='passed')).ok,false);
 assert.equal(audit(copy(p=>p.mvp_boundary.r20_owners_in_progress=false)).ok,false);
});
