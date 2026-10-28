import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const file = (p)=>readFileSync(new URL('../../../'+p,import.meta.url),'utf8');
const json = (p)=>JSON.parse(file(p));
const d06=json('docs/operations/ai0-d06-owner-approved-free-first-spend-gate.v1.json');
const d05=json('docs/operations/ai0-d05-owner-approved-optional-web.v1.json');
const d04=json('docs/operations/ai0-d04-owner-approved-option-c.v1.json');
const d03=json('docs/operations/ai0-d03-owner-approved-choice-a.v1.json');
const d02=json('docs/operations/ai0-d02-owner-approved-choice-a.v1.json');
const release=json('docs/release-readiness/release-readiness.v0.json');

test('D-06 user chose A free-first and owner-authorized incremental spending only, with no monthly amount',()=>{
  assert.equal(d06.selected_option,'A');
  assert.equal(d06.decision_id,'D-06');
  assert.ok(d06.owner_exact_choice.includes('正式選擇 A'));
  assert.equal(d06.status,'OWNER_APPROVED_FREE_FIRST_INDIVIDUAL_SPEND_APPROVAL');
  assert.equal(d06.monthly_budget_status,'UNDECIDED_SEPARATE_FUTURE_DECISION');
  assert.equal(d06.monthly_budget_amount,null);
  assert.equal(d06.monthly_budget_currency,null);
  assert.equal(d06.monthly_automatic_spending_allowance,0);
  assert.equal(d06.no_spend_authority_from_policy,true);
  assert.ok(file('docs/adr/AI0-D06-OWNER-APPROVED-FREE-FIRST-INDIVIDUAL-SPEND-APPROVAL-20261028.md').includes('OWNER_APPROVED_COST_CONTROL_POLICY'));
});

test('each additional subscription, overage, paid CI, store, EAS, Cloudflare and ads needs separate explicit approval',()=>{
  const k=Object.keys(d06.per_spend_authorization_required);
  assert.ok(k.length>=9);
  assert.ok(Object.values(d06.per_spend_authorization_required).every(x=>x===true));
  assert.equal(d06.operation_authorization.make_paid_purchase,false);
  assert.equal(d06.operation_authorization.activate_new_paid_subscription,false);
  assert.equal(d06.operation_authorization.upgrade_existing_paid_plan,false);
  assert.equal(d06.operation_authorization.authorize_usage_overage,false);
  assert.equal(d06.operation_authorization.create_billable_cloudflare_resources,false);
  assert.equal(d06.operation_authorization.start_billable_eas_native_build,false);
  assert.equal(d06.operation_authorization.connect_revenuecat_live_store,false);
  assert.ok(d06.mandatory_approval_card_fields.includes('hard_cap_vs_alert_proof'));
  assert.ok(d06.mandatory_approval_card_fields.includes('owner_explicit_amount_and_action_approval'));
});

test('free-first policy does not falsely guarantee no passive recurring / overage billing or cancel current plans',()=>{
  assert.equal(d06.existing_service_policy.do_not_cancel_existing_plans,true);
  assert.equal(d06.existing_service_policy.do_not_modify_existing_billing_or_auto_renew,true);
  assert.equal(d06.existing_service_policy.incidental_passive_billing_can_still_occur,true);
  assert.equal(d06.existing_service_policy.spending_alert_is_not_necessarily_hard_cap,true);
  assert.equal(d06.existing_service_policy.provider_overspend_cannot_be_guaranteed_prevented_without_specific_enforcement,true);
  assert.equal(d06.operation_authorization.change_existing_automatic_renewal,false);
  assert.equal(d06.operation_authorization.change_secrets_or_billing_account,false);
});

test('D-06 A preserves D-02 A / D-03 A / D-04 C / D-05 A, staging is only conditional and D-07 pending',()=>{
  assert.equal(d02.selected_option,'A');
  assert.equal(d03.selected_option,'A');
  assert.equal(d04.selected_option,'C');
  assert.equal(d05.selected_option,'A');
  assert.equal(d06.prior_owner_decisions_preserved.starry_staging,'DIRECTION_APPROVED_PRECISE_RESOURCES_AND_COSTS_NOT_APPROVED');
  assert.ok(d06.remaining_decisions.includes('D07_CROSS_APP_ENTITLEMENTS'));
  assert.ok(d06.remaining_decisions.includes('D06_MONTHLY_BUDGET_AMOUNT'));
  assert.equal(d06.actual_spending_initiated,false);
  assert.equal(d06.p05_publishable,false);
  assert.equal(d06.release_authorization_granted,false);
  assert.equal(d06.official_release_gates_blocked,11);
  assert.equal(release.gates.length,11);
  assert.ok(release.gates.every(g=>g.status==='blocked'));
  assert.equal(release.release_authorization.granted,false);
  assert.equal(release.deployment_automation.can_auto_deploy,false);
});

test('D-06 approval is only policy / read-only research / GitHub source docs and tests',()=>{
  const allowed=new Set(['cost_policy_selection','no_cost_readonly_billing_research','github_source_only_draft_docs_tests']);
  for(const [name,v] of Object.entries(d06.operation_authorization))assert.equal(v,allowed.has(name),name);
});
