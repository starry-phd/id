import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const file=p=>readFileSync(new URL('../../../'+p,import.meta.url),'utf8');
const parse=p=>JSON.parse(file(p));
const d07=parse('docs/operations/ai0-d07-owner-approved-per-app-entitlements.v1.json');
const d06=parse('docs/operations/ai0-d06-owner-approved-free-first-spend-gate.v1.json');
const d05=parse('docs/operations/ai0-d05-owner-approved-optional-web.v1.json');
const d04=parse('docs/operations/ai0-d04-owner-approved-option-c.v1.json');
const d03=parse('docs/operations/ai0-d03-owner-approved-choice-a.v1.json');
const d02=parse('docs/operations/ai0-d02-owner-approved-choice-a.v1.json');
const release=parse('docs/release-readiness/release-readiness.v0.json');

test('D07 owner chose A per-App commerce isolation, not combined VIP or global paid rights',()=>{
  assert.equal(d07.decision_id,'D-07');
  assert.equal(d07.selected_option,'A');
  assert.match(d07.owner_exact_choice,/正式選擇方案 A/);
  assert.equal(d07.decision_status,'OWNER_APPROVED_PER_APP_PAID_ENTITLEMENTS_NOT_IMPLEMENTED');
  assert.equal(d07.cross_app.policy,'DENY_PAID_ENTITLEMENT_PORTABILITY_ACROSS_DIFFERENT_APPS');
  assert.equal(d07.cross_app.cross_app_subscription_approved,false);
  assert.equal(d07.cross_app.global_vip_approved,false);
  assert.equal(d07.cross_app.cross_app_nonconsumable_approved,false);
  assert.equal(d07.cross_app.cross_app_remove_ads_approved,false);
  assert.equal(d07.cross_app.same_central_user_id_does_not_grant_cross_app_entitlement,true);
  assert.equal(d07.cross_app.app_scope_required_for_every_grant_revoke_restore,true);
  assert.ok(file('docs/adr/AI0-D07-OWNER-APPROVED-PER-APP-PAID-ENTITLEMENT-ISOLATION-20261028.md').includes('CROSS_APP_PAID_ENTITLEMENTS_DENIED_BY_DEFAULT'));
});
test('cross-App denial does not imply either approval or prohibition of same-App cross-platform access',()=>{
  const p=d07.same_app_cross_platform;
  assert.equal(p.policy,'UNDECIDED_PENDING_STORE_POLICY_AND_NATIVE_SANDBOX');
  assert.equal(p.same_app_ios_android_entitlement_access_approved,false);
  assert.equal(p.same_app_web_entitlement_access_approved,false);
  assert.equal(p.same_app_cross_platform_access_possible_if_future_reviewed,true);
  assert.equal(p.actual_ios_android_web_store_compatibility_verified,false);
  assert.equal(p.cross_store_receipt_must_not_be_pretended_native_to_other_store,true);
  assert.equal(p.native_store_restore_and_same_app_cross_platform_access_are_distinct,true);
  assert.equal(p.android_cannot_directly_restore_apple_app_store_transaction_as_google_play_transaction,true);
  assert.equal(p.ios_cannot_directly_restore_google_play_transaction_as_app_store_transaction,true);
  assert.ok(d07.same_app_cross_platform_validation_required.includes('real_StoreKit_GooglePlay_sandbox_purchase_and_restore'));
});
test('App scoped Store entitlements cannot cross brand/environment/identity; central Battery remains free',()=>{
  for(const key of ['brand_id','app_id','ios_bundle_id','android_application_id','product_id','entitlement_key','environment','user_id'])assert.ok(d07.product_scope_fields.includes(key),key);
  for(const invariant of ['no_paid_entitlement_from_App_A_grants_App_B','no_cross_app_no_ads_on_shared_member_login','no_cross_environment_sandbox_to_production_entitlement','permanently_free_Starry_Battery_not_for_sale','no_duplicate_Billing_Auth_Battery_writers'])assert.ok(d07.safety_invariants.includes(invariant),invariant);
  assert.ok(d07.trusted_owner.billing_entitlement_writer.startsWith('AI-2/DEV-B'));
  assert.ok(d07.trusted_owner.permanently_free_battery.startsWith('AI-3'));
});
test('D07 is consistent with D02 A, D03 A, D04 C, D05 A, D06 A and D08 pending',()=>{
  assert.equal(d02.selected_option,'A');
  assert.equal(d03.selected_option,'A');
  assert.equal(d04.selected_option,'C');
  assert.equal(d05.selected_option,'A');
  assert.equal(d06.selected_option,'A');
  assert.equal(d07.prior_decisions.D08,'PENDING');
  assert.equal(d07.operation_authorization.paid_services_or_upgrades,false);
});
test('selection authorizes only ADR/rules/tests and never Store, revenue, infra or central release',()=>{
  const allowed=new Set(['cross_app_isolation_policy_selection','owner_approved_per_app_business_rules_planning','offline_github_source_only_documentation_and_tests']);
  for(const [key,val] of Object.entries(d07.operation_authorization))assert.equal(val,allowed.has(key),key);
  assert.equal(d07.p05_publishable,false);
  assert.equal(d07.release_authorization_granted,false);
  assert.equal(d07.official_central_release_gates_blocked,11);
  assert.equal(release.gates.length,11);
  assert.ok(release.gates.every(g=>g.status==='blocked'));
  assert.equal(release.release_authorization.granted,false);
  assert.equal(release.deployment_automation.can_auto_deploy,false);
});
