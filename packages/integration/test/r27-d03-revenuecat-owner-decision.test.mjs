import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const load = p => readFileSync(new URL('../../../'+p, import.meta.url), 'utf8');
const choice = JSON.parse(load('docs/operations/ai0-d03-owner-approved-choice-a.v1.json'));
const d02 = JSON.parse(load('docs/operations/ai0-d02-owner-approved-choice-a.v1.json'));
const release = JSON.parse(load('docs/release-readiness/release-readiness.v0.json'));

test('D-03 user expressly approves RevenueCat plus owned thin BillingClient as architecture',()=>{
  assert.equal(choice.decision_id,'D-03');
  assert.equal(choice.selected_option,'A');
  assert.equal(choice.provider,'RevenueCat');
  assert.equal(choice.decision_status,'OWNER_APPROVED_PROVIDER_ARCHITECTURE_NOT_IMPLEMENTED');
  assert.ok(choice.owner_explicit_choice.includes('正式選擇方案 A'));
  assert.equal(choice.consumer_contract,'Starry-owned versioned thin BillingClient');
  assert.ok(choice.client_api_names_concept_only.includes('restorePurchases()'));
  assert.ok(load('docs/adr/AI0-D03-OWNER-APPROVED-REVENUECAT-BILLINGCLIENT-20261028.md').includes('OWNER_APPROVED_ARCHITECTURE'));
});

test('D-03 RevenueCat cannot displace AI-2 sole entitlement writer or falsely monetize free Battery',()=>{
  assert.match(choice.authoritative_boundaries.business_entitlement_projection,/AI-2/);
  assert.match(choice.authoritative_boundaries.free_battery_role,/never purchasable/);
  assert.ok(choice.safe_invariants.includes('one_store_entitlement_authority_not_two_competing_sources'));
  assert.ok(choice.safe_invariants.includes('no_client_self_reported_purchase_grant'));
  assert.ok(choice.safe_invariants.includes('no_unverified_webhook_notification_grant'));
  assert.ok(choice.safe_invariants.includes('no_purchase_based_battery_gift_or_balance'));
  assert.ok(choice.safe_invariants.includes('no_cross_app_purchased_entitlement_without_D07'));
  assert.equal(choice.authoritative_boundaries.cross_app_subscription_decided,false);
});

test('D-03 stays consistent with D-02 approved private monorepo and per-App isolation',()=>{
  assert.equal(d02.selected_option,'A');
  assert.equal(d02.actual_private_repo_created,false);
  assert.match(choice.authoritative_boundaries.app_repo_d02,/Option A/);
  assert.equal(choice.authoritative_boundaries.monetization_app_scoped,true);
  for(const key of ['app_id','ios_bundle_id','android_package_name','store_product_id','entitlement_key','environment']) {
    assert.ok(choice.app_isolation_fields.includes(key), key);
  }
});

test('provider choice does not authorize accounts, spend, real Store, deployments, or official release',()=>{
  const actions=choice.operation_authorization;
  assert.equal(actions.provider_selection,true);
  assert.equal(actions.billing_client_interface_planning,true);
  for(const [key,approved] of Object.entries(actions)) {
    if(['provider_selection','billing_client_interface_planning'].includes(key)) continue;
    assert.equal(approved,false,key);
  }
  assert.equal(choice.actual_implementation,false);
  assert.equal(choice.official_p05_publishable,false);
  assert.equal(choice.remaining_gates.D04_ad_provider,'PENDING');
  assert.equal(choice.remaining_gates.D06_provider_costs,'PENDING');
  assert.equal(choice.remaining_gates.D07_cross_app_subscriptions,'PENDING');
  assert.equal(choice.remaining_gates.official_release_gates_blocked,11);
  assert.equal(choice.remaining_gates.release_authorization_granted,false);
  assert.equal(release.gates.length,11);
  assert.ok(release.gates.every(x=>x.status==='blocked'));
  assert.equal(release.release_authorization.granted,false);
  assert.equal(release.deployment_automation.can_auto_deploy,false);
});
