import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => JSON.parse(readFileSync(new URL('../../../' + p, import.meta.url), 'utf8'));
const current = read('docs/operations/ai0-owner-approved-wave1-decisions.v1.json');
const historical = read('docs/operations/ai0-d01-expo58-readonly-compatibility-research.v1.json');
const mobile = read('apps/mobile/package.json');
const release = read('docs/release-readiness/release-readiness.v0.json');

test('owner D01=D supersedes historical research pending; skip isolated PoC but never skip real builds', () => {
  assert.equal(current.D01.selected_option, 'D');
  assert.equal(current.D01.owner_approved, true);
  assert.equal(historical.owner_approved_D01, false); // historical as-of snapshot; not latest owner authority
  assert.equal(current.D01.isolated_predevelopment_native_poc_required, false);
  assert.equal(current.D01.real_app_ios_android_native_build_required_before_release, true);
  assert.equal(current.D01.real_app_native_plugins_and_iap_sandbox_required_before_release, true);
  assert.equal(current.D01.native_builds_claimed_completed, 0);
  assert.equal(current.scope.current_central_mobile_upgrade_authorized, false);
  assert.equal(mobile.dependencies.expo, current.scope.current_central_mobile_expo);
});

test('Store IAP is only permanent non-consumable or monthly/yearly auto renewals', () => {
  assert.deepEqual(current.D03.allowed_store_iap_product_types, ['NON_CONSUMABLE','AUTO_RENEWABLE_SUBSCRIPTION']);
  assert.deepEqual(current.D03.allowed_subscription_periods, ['MONTH','YEAR']);
  assert.ok(current.D03.excluded_store_iap_product_types.includes('CONSUMABLE'));
  assert.ok(current.D03.excluded_store_iap_product_types.includes('NON_RENEWING_SUBSCRIPTION'));
  assert.equal(current.Q3.both_may_coexist, true);
  assert.equal(current.Q3.entitlement_feature_mapping_per_app, true);
  assert.equal(current.Q2.authenticated_starry_id_required_before_store_purchase, true);
});

test('cross-platform effective rights are same-app only, Store policy and sandbox unverified', () => {
  assert.equal(current.Q1.choice,'A');
  assert.equal(current.Q1.same_app_valid_entitlement_shared_across_ios_android,true);
  assert.equal(current.Q1.store_policy_and_sandbox_verified,false);
  assert.equal(current.Q1.store_transaction_is_cross_store_transferred,false);
  assert.equal(current.D07.across_apps_entitlement_auto_shared,false);
  assert.equal(current.safety.starry_battery_for_sale,false);
});

test('Ads are off, private consumer repo is deferred, real release remains fail-closed', () => {
  assert.equal(current.D04.final_provider_selected,null);
  assert.equal(current.D04.ads_enabled,false);
  assert.equal(current.Q4.choice,'D');
  assert.equal(current.Q5.choice,'B');
  assert.equal(current.scope.new_consumer_app_private_monorepo_created,false);
  assert.equal(current.D02.create_repo_now,false);
  assert.equal(current.wave1.independent_ai_chats_auto_started,false);
  assert.equal(current.safety.any_production_deployment_authorized,false);
  assert.equal(current.safety.any_live_store_transaction_authorized,false);
  assert.equal(current.safety.new_paid_service_authorized,false);
  assert.equal(current.safety.auto_merge_main_authorized,false);
  assert.equal(release.gates.length,11);
  assert.ok(release.gates.every(g=>g.status==='blocked'));
  assert.equal(release.release_authorization.granted,false);
});
