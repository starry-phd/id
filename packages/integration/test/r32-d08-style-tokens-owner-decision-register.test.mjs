import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = path => readFileSync(new URL('../../../' + path, import.meta.url), 'utf8');
const read = path => JSON.parse(file(path));
const d08 = read('docs/operations/ai0-d08-owner-approved-style-tokens-shared-ui.v1.json');
const d07 = read('docs/operations/ai0-d07-owner-approved-per-app-entitlements.v1.json');
const d06 = read('docs/operations/ai0-d06-owner-approved-free-first-spend-gate.v1.json');
const d05 = read('docs/operations/ai0-d05-owner-approved-optional-web.v1.json');
const d04 = read('docs/operations/ai0-d04-owner-approved-option-c.v1.json');
const d03 = read('docs/operations/ai0-d03-owner-approved-choice-a.v1.json');
const d02 = read('docs/operations/ai0-d02-owner-approved-choice-a.v1.json');
const release = read('docs/release-readiness/release-readiness.v0.json');

test('D08 owner formally approves native StyleSheet + semantic tokens + owned shared UI library, NOT implemented', () => {
  assert.equal(d08.decision_id, 'D-08');
  assert.equal(d08.selected_option, 'A');
  assert.ok(d08.owner_exact_choice.includes('正式選擇方案 A'));
  assert.equal(d08.status, 'OWNER_APPROVED_STYLESHEET_DESIGN_TOKENS_SHARED_UI_ARCHITECTURE_NOT_IMPLEMENTED');
  assert.equal(d08.ui_baseline.native_style_system, 'React Native StyleSheet');
  assert.equal(d08.ui_baseline.semantic_design_tokens, true);
  assert.equal(d08.ui_baseline.versioned_owned_shared_ui_component_library, true);
  assert.equal(d08.ui_baseline.packages_created, false);
  assert.equal(d08.ui_baseline.style_runtime_or_ui_library_installed, false);
  assert.equal(d08.ui_baseline.per_app_theme_override_allowed, true);
  assert.equal(d08.ui_baseline.global_single_visual_identity_required, false);
  assert.equal(d08.ui_baseline.nativewind_as_first_phase_default, false);
  assert.equal(d08.ui_baseline.tamagui_as_first_phase_default, false);
  assert.ok(file('docs/adr/AI0-D08-OWNER-APPROVED-STYLESHEET-DESIGN-TOKENS-UI-LIBRARY-20261028.md').includes('OWNER_APPROVED_UI_ARCHITECTURE_ONLY'));
});

test('new consumer UI decision does not modify independent Starry Admin V2.1 or central business writers', () => {
  const admin = d08.independent_admin_preserved;
  assert.ok(admin.approved_second_wave_stack.includes('React+Vite+TypeScript'));
  assert.ok(admin.approved_second_wave_stack.includes('TanStack Router+Query+Table'));
  assert.equal(admin.admin_replaced_by_RN_StyleSheet, false);
  assert.equal(admin.second_wave_admin_started, false);
  assert.equal(admin.HGlobal_admin_merged, false);
  assert.equal(d08.ui_baseline.component_library_writer_cannot_modify_central_auth_billing_or_battery, true);
  assert.equal(d08.operation_authorization.modify_central_auth_writer, false);
  assert.equal(d08.operation_authorization.modify_central_billing_writer, false);
  assert.equal(d08.operation_authorization.modify_permanently_free_battery_writer, false);
  assert.equal(d08.operation_authorization.second_wave_admin_work, false);
  assert.equal(d08.operation_authorization.touch_HGlobal, false);
});

test('D01-D08 register accurately distinguishes pending D01 from seven owner-approved choices', () => {
  const register = d08.decision_register;
  assert.deepEqual(Object.keys(register), ['D01','D02','D03','D04','D05','D06','D07','D08']);
  assert.equal(register.D01.selected_option, null);
  assert.equal(register.D01.owner_approved, false);
  const prior=[d02,d03,d04,d05,d06,d07];
  for (let i=0; i<prior.length; ++i) {
    const item=register['D0'+(i+2)];
    assert.equal(item.owner_approved, true);
    assert.equal(item.selected_option, prior[i].selected_option);
  }
  assert.equal(register.D08.owner_approved, true);
  assert.equal(register.D08.selected_option, 'A');
  assert.equal(register.D04.selected_option, 'C');
  assert.match(register.D04.status, /FINAL_PROVIDER_UNDECIDED/);
  assert.match(register.D06.status, /MONTHLY_BUDGET_UNDECIDED/);
  assert.match(register.D07.status, /SAME_APP_CROSS_PLATFORM_UNDECIDED/);
  assert.equal(d06.monthly_budget_amount, null);
  assert.equal(d04.ads_provider_selected, null);
  assert.equal(d07.same_app_cross_platform.same_app_ios_android_entitlement_access_approved, false);
});

test('no private repo, native upgrade, UI implementation, paid action, admin build or app release is authorized by D08',()=>{
  const allow=new Set(['D08_ui_architecture_choice','shared_UI_component_contract_planning','source_only_draft_ADR_json_and_offline_tests']);
  for(const [key,value] of Object.entries(d08.operation_authorization)){
    assert.equal(value, allow.has(key),key);
  }
  assert.equal(d08.actual_new_ui_packages_created, false);
  assert.equal(d08.actual_new_apps_approved, false);
  assert.equal(d08.cost_approved, false);
  assert.equal(d08.p05_publishable, false);
  assert.equal(d08.release_authorization_granted, false);
  assert.equal(d08.official_release_gates_blocked, 11);
  assert.equal(release.gates.length, 11);
  assert.ok(release.gates.every(g=>g.status==='blocked'));
  assert.equal(release.release_authorization.granted, false);
  assert.equal(release.deployment_automation.can_auto_deploy, false);
});

test('existing D02-D07 guards continue: isolated App, RevenueCat thin, ads pending, Web optional, free-first, no global VIP',()=>{
  assert.equal(d02.selected_option, 'A');
  assert.equal(d02.actual_private_repo_created, false);
  assert.equal(d03.selected_option, 'A');
  assert.equal(d03.provider, 'RevenueCat');
  assert.equal(d04.selected_option, 'C');
  assert.equal(d05.selected_option, 'A');
  assert.equal(d05.central_admin.stack_approval_preserved, true);
  assert.equal(d06.selected_option, 'A');
  assert.equal(d06.no_spend_authority_from_policy, true);
  assert.equal(d07.selected_option, 'A');
  assert.equal(d07.cross_app.cross_app_subscription_approved, false);
  assert.equal(d07.cross_app.cross_app_remove_ads_approved, false);
  assert.equal(d08.ui_baseline.per_app_content_navigation_product_design_separate, true);
});
