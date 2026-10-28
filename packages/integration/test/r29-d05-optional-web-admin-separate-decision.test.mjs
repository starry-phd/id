import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const file = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const json = p => JSON.parse(file(p));
const d05 = json('docs/operations/ai0-d05-owner-approved-optional-web.v1.json');
const d04 = json('docs/operations/ai0-d04-owner-approved-option-c.v1.json');
const d03 = json('docs/operations/ai0-d03-owner-approved-choice-a.v1.json');
const d02 = json('docs/operations/ai0-d02-owner-approved-choice-a.v1.json');
const release = json('docs/release-readiness/release-readiness.v0.json');

test('D05 owner formally approves per-App optional web only, never auto-enables every App', () => {
  assert.equal(d05.decision_id,'D-05');
  assert.equal(d05.selected_option,'A');
  assert.ok(d05.owner_exact_choice.includes('每款 App 網頁版選配'));
  assert.equal(d05.status,'OWNER_APPROVED_APP_WEB_OPTIONAL_ADMIN_SEPARATE_NOT_IMPLEMENTED');
  assert.equal(d05.consumer_app_web.scope,'PER_APP_OPTIONAL_WEB');
  assert.equal(d05.consumer_app_web.default_web_enabled,false);
  assert.equal(d05.consumer_app_web.auto_web_for_all_apps,false);
  assert.equal(d05.consumer_app_web.specific_apps_approved_for_web,0);
  assert.equal(d05.consumer_app_web.rn_web_implementation,'PREFERRED_CANDIDATE_NOT_MANDATORY_NOT_VERIFIED');
  assert.ok(file('docs/adr/AI0-D05-OWNER-APPROVED-OPTIONAL-APP-WEB-ADMIN-SEPARATE-20261028.md').includes('OWNER_APPROVED_OPTION_A'));
});
test('Web manifest example is synthetic, no approved domains, no deployed, paid or ads state', () => {
  const m=d05.consumer_app_web.manifest_candidate_only;
  assert.equal(m.app_id,'synthetic-future-app');
  assert.equal(m.web.requested,false);
  assert.equal(m.web.approved,false);
  assert.equal(m.web.enabled,false);
  assert.equal(m.web.domain,null);
  assert.equal(m.web.platform,null);
  assert.equal(m.web.verified_browser_auth,false);
  assert.equal(m.web.verified_store_entitlements,false);
  assert.equal(m.web.verified_ads_consent,false);
  assert.equal(m.web.deployed,false);
  assert.equal(d05.consumer_app_web.app_web_domain_approved,false);
  assert.equal(d05.consumer_app_web.web_purchase_implementation_approved,false);
  assert.equal(d05.consumer_app_web.web_ads_implementation_approved,false);
});
test('existing independent Starry second-wave admin V2.1 stack not overridden or started', () => {
  const a=d05.central_admin;
  assert.equal(a.stack_approval_preserved,true);
  assert.equal(a.web_technology,'React + Vite + TypeScript');
  assert.equal(a.ui,'Tailwind CSS + shadcn/ui');
  assert.equal(a.router,'TanStack Router');
  assert.equal(a.query,'TanStack Query');
  assert.equal(a.table,'TanStack Table');
  assert.equal(a.forms,'React Hook Form + Zod');
  assert.equal(a.dashboard_chart_lib,'ECharts_OR_Recharts_Pending_Second_Wave_Decision');
  assert.equal(a.admin_not_replaced_by_react_native_web,true);
  assert.equal(a.admin_not_inside_consumer_app_factory,true);
  assert.equal(a.second_wave_admin_ui_started_by_d05,false);
  assert.equal(a.admin_deployment_approved,false);
  assert.equal(a.hglobal_admin_separate_and_paused,true);
});
test('D05 preserves prior approved choices and release Gate', () => {
  assert.equal(d02.selected_option,'A');
  assert.equal(d03.selected_option,'A');
  assert.equal(d04.selected_option,'C');
  assert.ok(d05.related_decisions.D02.startsWith('OWNER_APPROVED_A_'));
  assert.ok(d05.related_decisions.D03.startsWith('OWNER_APPROVED_A_'));
  assert.ok(d05.related_decisions.D04.startsWith('OWNER_APPROVED_C_'));
  assert.equal(d05.related_decisions.D06,'PENDING');
  assert.equal(d05.related_decisions.D07,'PENDING');
  assert.equal(d05.related_decisions.D08,'PENDING');
  assert.ok(d05.architecture_boundaries.includes('auth_billing_free_battery_unique_writers_not_duplicated'));
  assert.ok(d05.architecture_boundaries.includes('app_web_uses_versioned_client_API_not_raw_central_D1'));
  assert.ok(d05.architecture_boundaries.includes('Web_Store_payment_flow_not_assumed_same_as_native'));
  assert.equal(release.gates.length,11);
  assert.ok(release.gates.every(g=>g.status==='blocked'));
  assert.equal(release.release_authorization.granted,false);
  assert.equal(release.deployment_automation.can_auto_deploy,false);
});
test('D05 selection allows only writing ADR/tests; no new Repo, Web, Admin or money/cloud action', () => {
  const allowed=new Set(['web_optional_policy_selection','preserve_approved_Starry_Admin_Web_stack','source_only_draft_ADR_test']);
  for(const [key,v] of Object.entries(d05.operation_authorization)){
    assert.equal(v,allowed.has(key),key);
  }
  assert.equal(d05.release_authorization_granted,false);
  assert.equal(d05.official_central_release_gates_blocked,11);
});
