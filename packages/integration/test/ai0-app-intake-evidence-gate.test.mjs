import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewStarryAppIntake, INTAKE_REVIEW_SCHEMA } from '../../../docs/portfolio/ai0-app-intake-evidence-gate.mjs';

const readJson = (file) => JSON.parse(readFileSync(new URL('../../../docs/portfolio/' + file, import.meta.url), 'utf8'));
const catalog = readJson('starry-app-portfolio-candidates.v0.json');
const portfolio = readJson('starry-app-p0-governance.v0.json');
const evidence = 'https://github.com/starry-phd/id/issues/158';
const flags = ['product_approved','release_approved','production_enabled','deploy_enabled',
  'payment_enabled','ads_enabled','battery_purchasable','store_submission_enabled',
  'allow_cross_app_entitlement','direct_central_d1_write'];
function candidate() {
  const c = {
    schema_version: INTAKE_REVIEW_SCHEMA, brand_id: 'starry', stage: 'PROPOSAL_ONLY',
    hypothesis_id: 'H01', archetype_id: 'ARC07',
    proposed_app_id: 'starry-synth-intake-a',
    unique_product_flow_key: 'synth-distinctive-workflow-a',
    target_audience: 'synthetic sample audience', user_problem: 'synthetic sample user problem',
    core_user_flow: 'synthetic local reference search and versioned results',
    distinctive_advantage: 'synthetic distinct offline and verifiable source workflow',
    project_owner: 'synthetic-review-owner',
    data_retention_plan: 'synthetic data minimization and deletion plan',
    maintenance_plan: 'synthetic support and lifecycle plan',
    monetization_candidate: 'none', creates_account: false,
    policy_evidence_urls: {
      apple_distinctiveness: evidence, google_repetitive_content: evidence,
      content_rights: evidence, privacy_retention_deletion: evidence,
      store_identity_plan: evidence, cost_budget: evidence, ongoing_support: evidence
    },
    score_evidence: Object.fromEntries(catalog.scorecard.weights.map((w) =>
      [w.key, { score_0_to_5: 3, evidence_urls: [evidence] }]))
  };
  for (const k of flags) c[k] = false;
  return c;
}
const review = (intake, opts = {}) => reviewStarryAppIntake({
  intake, scorecard: catalog, portfolio, existingApps: [], registryVerified: true, ...opts
});

test('reads exactly original 8 archetypes, 100-point weights, 12 unapproved hypotheses', () => {
  assert.equal(catalog.categories.length, 8);
  assert.equal(catalog.scorecard.weights.reduce((s,w) => s + w.weight,0),100);
  assert.equal(portfolio.portfolio_hypotheses.length, 12);
  assert.ok(portfolio.portfolio_hypotheses.every((h) => h.approved === false && h.score === null));
});

test('even all submitted fields and a numeric score never authorize App, Store, Ads, Repo, native or ranking', () => {
  const r = review(candidate());
  assert.equal(r.status, 'READY_FOR_HUMAN_EVIDENCE_REVIEW');
  assert.equal(r.proposed_score_unverified, 60);
  for (const k of ['is_market_verified','is_product_approved','may_implement_app',
    'may_create_repo','may_build_native','may_use_store','may_serve_ads','may_deploy','ready_to_rank']) {
    assert.equal(r[k],false,k);
  }
  assert.equal(r.requires_independent_human_review,true);
});

test('missing verified existing-App registry blocks uniqueness conclusion', () => {
  const r = review(candidate(), { registryVerified: false });
  assert.equal(r.status,'NEEDS_EVIDENCE');
  assert.ok(r.missing_evidence.includes('VERIFIED_EXISTING_APP_REGISTRY_MISSING'));
});

test('same distinctive workflow in verified existing app recommends merging, not generating clone', () => {
  const r = review(candidate(), { existingApps: [{app_id:'other',unique_product_flow_key:'SYNTH-distinctive-workflow-a'}]});
  assert.equal(r.status,'RECOMMEND_MERGE_OR_RENAME');
  assert.ok(r.conflicts.includes('CORE_FLOW_ALREADY_EXISTS_CONSIDER_MERGE'));
  assert.equal(r.may_implement_app,false);
});

test('proposed App ID collision also blocks independent listing', () => {
  const r = review(candidate(), {existingApps:[{app_id:'starry-synth-intake-a',unique_product_flow_key:'unrelated-flow-111'}]});
  assert.equal(r.status,'RECOMMEND_MERGE_OR_RENAME');
  assert.ok(r.conflicts.includes('APP_ID_ALREADY_USED'));
});

test('missing or forged approval flags reject candidate rather than becoming release permission', () => {
  const x = candidate();
  x.battery_purchasable = true;
  assert.equal(review(x).status, 'REJECT_INVALID_INTAKE');
  const y = candidate();
  delete y.production_enabled;
  assert.ok(review(y).errors.includes('UNSAFE_OR_ABSENT_FLAG_PRODUCTION_ENABLED'));
  const z = candidate();
  z.store_submission_enabled = true;
  assert.equal(review(z).may_use_store,false);
});

test('reject cross-brand, invalid stage and mismatch among H01-H12 archetypes', () => {
  const x = candidate();
  x.brand_id = 'hglobal'; x.stage = 'APPROVED'; x.archetype_id = 'ARC06';
  const r = review(x);
  assert.equal(r.status,'REJECT_INVALID_INTAKE');
  assert.ok(r.errors.includes('NON_STARRY_BRAND'));
  assert.ok(r.errors.includes('STAGE_MUST_BE_PROPOSAL_ONLY'));
  assert.ok(r.errors.includes('UNKNOWN_OR_UNAPPROVED_HYPOTHESIS_MISMATCH'));
});

test('subscription/account creation requires deletion link; privacy cannot be assumed', () => {
  const x=candidate();
  x.creates_account = true;
  x.monetization_candidate = 'subscription';
  const r=review(x);
  assert.equal(r.status,'NEEDS_EVIDENCE');
  assert.ok(r.missing_evidence.includes('ACCOUNT_DELETION_PATH_EVIDENCE_REQUIRED'));
});

test('scores cannot be invented without all seven valid HTTPS links, numeric 0..5 and weights', () => {
  const x=candidate();
  x.score_evidence.feasibility.score_0_to_5 = 6;
  x.score_evidence.problem_evidence.evidence_urls = ['https://example.com/demo'];
  const r=review(x);
  assert.equal(r.status,'NEEDS_EVIDENCE');
  assert.equal(r.proposed_score_unverified,null);
  assert.ok(r.missing_evidence.includes('SCORE_EVIDENCE_FEASIBILITY'));
  assert.ok(r.missing_evidence.includes('SCORE_EVIDENCE_PROBLEM_EVIDENCE'));
});

test('unverified policy links cannot be treated as validated unique content or costs', () => {
  const x=candidate();
  x.policy_evidence_urls.apple_distinctiveness = 'http://bad.test/thing';
  x.policy_evidence_urls.cost_budget = 'https://example.com/fiction';
  const r=review(x);
  assert.equal(r.status,'NEEDS_EVIDENCE');
  assert.ok(r.missing_evidence.includes('POLICY_EVIDENCE_APPLE_DISTINCTIVENESS'));
  assert.ok(r.missing_evidence.includes('POLICY_EVIDENCE_COST_BUDGET'));
});

test('tampered scorecard and malformed inputs fail closed', () => {
  const bad=structuredClone(catalog);
  bad.scorecard.weights[0].weight = 200;
  const r=review(candidate(),{scorecard:bad});
  assert.equal(r.status,'REJECT_INVALID_INTAKE');
  assert.ok(r.errors.includes('CANONICAL_SCORECARD_INVALID'));
  assert.equal(r.proposed_score_unverified,null);
  const malformed=reviewStarryAppIntake({intake:null,scorecard:null,portfolio:null});
  assert.equal(malformed.status,'REJECT_INVALID_INTAKE');
  assert.equal(malformed.may_deploy,false);
});

test('even a zero-score with evidence is numeric, but still never ranking or market validation', () => {
  const x=candidate();
  for(const w of catalog.scorecard.weights) x.score_evidence[w.key].score_0_to_5 = 0;
  const r=review(x);
  assert.equal(r.proposed_score_unverified,0);
  assert.equal(r.ready_to_rank,false);
});
