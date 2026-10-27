import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFutureAppPortfolio,readFutureAppInputs} from '../../../docs/operations/verify-future-starry-app-portfolio.mjs';
const {plan,official}=readFutureAppInputs();
const mutate=fn=>{const x=structuredClone(plan);fn(x);return x;};
test('AI-0 future Starry App roadmap is candidate-only with 11/11 real release Gates blocked',()=>{
 const r=auditFutureAppPortfolio(plan,official);
 assert.equal(r.ok,true,r.errors.join(' / '));
 assert.equal(r.official_blocked,11);
 assert.equal(r.candidates,4);assert.equal(r.decisions_pending,8);
 assert.equal(r.journeys,8);assert.equal(r.phases,5);
 assert.equal(r.owner_r18_integrated,false);assert.equal(r.release_authorized,false);
});
test('reject changing Starry ID DEV harness into independent store app or fake consumer selection',()=>{
 for(const fn of [
  p=>p.authoritative_decisions.starry_id_is_shared_service_not_standalone_store_app=false,
  p=>p.candidate_products[0].store_publication_allowed=true,
  p=>p.candidate_products[0].role='first_consumer_candidate',
  p=>p.authoritative_decisions.first_consumer_app_selected=true,
  p=>p.authoritative_decisions.first_consumer_official_bundle_identifier='phd.starry.id.dev',
  p=>p.authoritative_decisions.first_consumer_official_market='TW',
  p=>p.candidate_products[1].has_user_consumer_value_proven=true
 ])assert.equal(auditFutureAppPortfolio(mutate(fn),official).ok,false);
});
test('reject selling/free battery conversion and invented IAP SKU/fee',()=>{
 for(const fn of [
  p=>p.authoritative_decisions.free_battery_purchase_or_conversion_permitted=true,
  p=>p.authoritative_decisions.battery_x_amount_approved=true,
  p=>p.optional_paid_features.may_exchange_free_battery=true,
  p=>p.optional_paid_features.may_sell_free_battery=true,
  p=>p.optional_paid_features.real_sku='paid_battery',
  p=>p.optional_paid_features.price=5
 ])assert.equal(auditFutureAppPortfolio(mutate(fn),official).ok,false);
});
test('reject early Wave2, HGlobal restart, stage/store/deploy and fake approved decisions',()=>{
 for(const fn of [
  p=>p.authoritative_decisions.wave2_admin_ui_approved=true,
  p=>p.authority.hglobal_development_authorized=true,
  p=>p.authority.owner_mvp_approved=true,
  p=>p.authority.eas_build_authorized=true,
  p=>p.store_readiness.expo.eas_build_authorized=true,
  p=>p.decision_queue[0].approval='YES',
  p=>p.phases[3].live_activity=true
 ].map(fn=>fn))assert.equal(auditFutureAppPortfolio(mutate(fn),official).ok,false);
});
test('reject false completed Owner R18, missing required flow/Gate and fake real store testing',()=>{
 for(const fn of [
  p=>p.claim_boundaries.new_owner_r18_code_count=4,
  p=>p.phases[1].status='done',
  p=>p.journeys.splice(4,1),
  p=>p.journeys[1].gate_ids=['FAKE-GATE'],
  p=>p.store_readiness.ios.official_testflight_completed=true,
  p=>p.store_readiness.android.play_internal_completed=true,
  p=>p.store_readiness.android.requires_off_app_deletion_link=false
 ])assert.equal(auditFutureAppPortfolio(mutate(fn),official).ok,false);
});
test('roadmap may not replace authoritative G00-G10 evidence or approvals',()=>{
 const o=structuredClone(official);
 o.release_authorization.granted=true;
 assert.equal(auditFutureAppPortfolio(plan,o).ok,false);
 const g=structuredClone(official);
 g.gates[0].status='verified';
 assert.equal(auditFutureAppPortfolio(plan,g).ok,false);
});
