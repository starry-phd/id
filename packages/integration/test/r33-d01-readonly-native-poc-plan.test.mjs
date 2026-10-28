import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const file=path=>readFileSync(new URL('../../../'+path,import.meta.url),'utf8');
const read=path=>JSON.parse(file(path));
const d01=read('docs/operations/ai0-d01-expo58-readonly-compatibility-research.v1.json');
const d08=read('docs/operations/ai0-d08-owner-approved-style-tokens-shared-ui.v1.json');
const d07=read('docs/operations/ai0-d07-owner-approved-per-app-entitlements.v1.json');
const d06=read('docs/operations/ai0-d06-owner-approved-free-first-spend-gate.v1.json');
const d04=read('docs/operations/ai0-d04-owner-approved-option-c.v1.json');
const mobile=read('apps/mobile/package.json');
const root=read('package.json');
const release=read('docs/release-readiness/release-readiness.v0.json');

test('D01 Expo58 proposal retains NO owner approval despite 2026-10-15 official SDK release',()=>{
  assert.equal(d01.decision_id,'D-01');
  assert.equal(d01.owner_approved_D01,false);
  assert.equal(d01.selected_option,null);
  assert.equal(d01.full_native_poc_started,false);
  assert.equal(d01.new_app_candidate.owner_selected_sdk58,false);
  assert.equal(d01.new_app_candidate.native_compatibility_verified,false);
  assert.equal(d08.decision_register.D01.owner_approved,false);
  assert.equal(d08.decision_register.D01.selected_option,null);
  assert.match(d01.status,/D01_OWNER_CHOICE_PENDING_NATIVE_POC_NOT_STARTED/);
  assert.ok(file('docs/adr/AI0-D01-EXPO58-NATIVE-COMPATIBILITY-RESEARCH-POC-PLAN-20261028-DRAFT.md').includes('OWNER_D01_NOT_YET_APPROVED'));
  assert.equal(d01.proposed_recommended_option,'A');
  assert.equal(d01.recommendation_is_owner_approval,false);
});

test('current public central Expo54/RN081 mobile versions actually match lock text and are untouched',()=>{
  assert.equal(mobile.dependencies.expo,d01.current_existing_central_mobile_untouched.expo);
  assert.equal(mobile.dependencies['react-native'],d01.current_existing_central_mobile_untouched.react_native);
  assert.equal(mobile.dependencies['expo-router'],d01.current_existing_central_mobile_untouched.expo_router);
  assert.equal(mobile.dependencies.react,d01.current_existing_central_mobile_untouched.react);
  assert.equal(root.workspaces[0],'apps/*');
  assert.equal(d01.current_existing_central_mobile_untouched.upgrade_executed,false);
});

test('RevenueCat mock ExpoGo is not Store, Sentry not deployed, Ads vendor not presumed AdMob',()=>{
  const n=d01.native_integration_research;
  assert.equal(n.revenuecat.D03_provider_owner_approved,true);
  assert.equal(n.revenuecat.expo_go_preview_api_mock_not_real_transaction,true);
  assert.equal(n.revenuecat.development_build_required_for_real_iap,true);
  assert.equal(n.revenuecat.sdk58_ios_android_build_verified,false);
  assert.equal(n.revenuecat.sandbox_store_flow_approved,false);
  assert.equal(n.sentry.sdk58_ios_android_build_verified,false);
  assert.equal(n.sentry.live_telemetry_enabled,false);
  assert.equal(d04.selected_option,'C');
  assert.equal(d04.ads_provider_selected,null);
  assert.equal(n.ads.final_provider_selected,null);
  assert.equal(n.ads.provider_sdk_approved,false);
  assert.equal(n.ads.real_native_ads_test_started,false);
  assert.equal(n.mobile_build.ios_android_builds_completed,0);
});

test('all native/store/paid/cloud operations stay disallowed; D02-D08 decisions unchanged',()=>{
  const allowed=new Set(['official_public_docs_readonly_research','read_existing_github_package_versions','github_source_only_draft_research_plan','offline_fail_closed_consistency_tests']);
  for(const [key,value] of Object.entries(d01.operation_authorization))assert.equal(value,allowed.has(key),key);
  assert.deepEqual(d01.prior_owner_decisions,{D02:'A',D03:'A',D04:'C',D05:'A',D06:'A',D07:'A',D08:'A'});
  assert.equal(d06.monthly_budget_amount,null);
  assert.equal(d06.no_spend_authority_from_policy,true);
  assert.equal(d07.cross_app.cross_app_subscription_approved,false);
  assert.equal(d01.steps.find(s=>s.id==='P1').status,'PENDING');
  assert.equal(d01.steps.find(s=>s.id==='P4').status,'NOT_AUTHORIZED');
  assert.equal(d01.steps.find(s=>s.id==='P5').status,'NOT_AUTHORIZED');
  assert.equal(d01.official_release_gates_blocked,11);
  assert.equal(d01.release_authorization_granted,false);
  assert.equal(d01.p05_publishable,false);
  assert.equal(release.gates.length,11);
  assert.ok(release.gates.every(g=>g.status==='blocked'));
  assert.equal(release.release_authorization.granted,false);
  assert.equal(release.deployment_automation.can_auto_deploy,false);
});
