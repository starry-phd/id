/**
 * AI-0 product-portfolio intake checker. Pure, read-only and fail-closed.
 * Not a release gate, billing validator, App Factory or Store approval engine.
 * Evidence links are untrusted claims until independently checked by a reviewer.
 */
export const INTAKE_REVIEW_SCHEMA = 'starry.ai0.app-intake-review.v1';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' && v.trim().length >= 8;
const publicEvidenceUrl = (v) => {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' &&
      !!u.hostname && !['example.com', 'example.org', 'example.net',
        'localhost', '127.0.0.1'].includes(u.hostname.toLowerCase()) &&
      u.username === '' && u.password === '' &&
      !u.pathname.includes('<') && !u.pathname.includes('>');
  } catch {
    return false;
  }
};
const distinct = (v) => [...new Set(v)];
const key = (v) => typeof v === 'string' ? v.trim().toLowerCase() : '';

/**
 * @param {object} args
 * @returns {object} recommendations only; never authorizes an App.
 */
export function reviewStarryAppIntake({ intake, scorecard, portfolio, existingApps, registryVerified = false } = {}) {
  const errors = [];
  const missing = [];
  const conflicts = [];
  const submittedEvidence = [];
  const source = isRecord(intake) ? intake : {};
  const catalog = isRecord(scorecard) ? scorecard : {};
  const port = isRecord(portfolio) ? portfolio : {};

  if (source.schema_version !== INTAKE_REVIEW_SCHEMA) errors.push('INTAKE_SCHEMA_INVALID');
  if (source.brand_id !== 'starry') errors.push('NON_STARRY_BRAND');
  if (source.stage !== 'PROPOSAL_ONLY') errors.push('STAGE_MUST_BE_PROPOSAL_ONLY');

  for (const flag of ['product_approved','release_approved','production_enabled','deploy_enabled',
    'payment_enabled','ads_enabled','battery_purchasable','store_submission_enabled',
    'allow_cross_app_entitlement','direct_central_d1_write']) {
    if (source[flag] !== false) errors.push('UNSAFE_OR_ABSENT_FLAG_' + flag.toUpperCase());
  }

  const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  if (!categories.some((c) => c.id === source.archetype_id)) errors.push('UNKNOWN_ARCHETYPE');
  const hypotheses = Array.isArray(port.portfolio_hypotheses) ? port.portfolio_hypotheses : [];
  if (!hypotheses.some((h) => h.id === source.hypothesis_id && h.archetype === source.archetype_id &&
    h.approved === false && h.implemented === false)) {
    errors.push('UNKNOWN_OR_UNAPPROVED_HYPOTHESIS_MISMATCH');
  }

  for (const field of ['target_audience','user_problem','core_user_flow','distinctive_advantage',
    'project_owner','data_retention_plan','maintenance_plan']) {
    if (!filled(source[field])) missing.push('MISSING_' + field.toUpperCase());
  }

  if (!/^[a-z][a-z0-9-]{4,63}$/.test(source.proposed_app_id ?? '')) missing.push('APP_ID_NOT_DESIGNATED');
  if (!filled(source.unique_product_flow_key) || !/^[a-z0-9-]{8,90}$/.test(source.unique_product_flow_key ?? '')) {
    missing.push('UNIQUE_PRODUCT_FLOW_KEY_MISSING');
  }
  if (!['none','one_time','subscription','ads','mixed'].includes(source.monetization_candidate)) {
    missing.push('MONETIZATION_MODEL_NOT_DEFINED');
  }

  // A missing or unverified real-app registry can never prove non-duplication.
  if (!registryVerified || !Array.isArray(existingApps)) {
    missing.push('VERIFIED_EXISTING_APP_REGISTRY_MISSING');
  } else {
    for (const app of existingApps) {
      if (!isRecord(app)) continue;
      if (filled(source.proposed_app_id) && key(app.app_id) === key(source.proposed_app_id)) {
        conflicts.push('APP_ID_ALREADY_USED');
      }
      if (filled(source.unique_product_flow_key) &&
          key(app.unique_product_flow_key) === key(source.unique_product_flow_key)) {
        conflicts.push('CORE_FLOW_ALREADY_EXISTS_CONSIDER_MERGE');
      }
    }
  }

  const policyLinks = isRecord(source.policy_evidence_urls) ? source.policy_evidence_urls : {};
  for (const k of ['apple_distinctiveness','google_repetitive_content','content_rights',
    'privacy_retention_deletion','store_identity_plan','cost_budget','ongoing_support']) {
    if (publicEvidenceUrl(policyLinks[k])) submittedEvidence.push('policy:' + k);
    else missing.push('POLICY_EVIDENCE_' + k.toUpperCase());
  }

  if (source.creates_account === true && !publicEvidenceUrl(policyLinks.account_deletion_path)) {
    missing.push('ACCOUNT_DELETION_PATH_EVIDENCE_REQUIRED');
  }
  if (typeof source.creates_account !== 'boolean') missing.push('ACCOUNT_CREATION_SCOPE_UNDEFINED');

  const weights = Array.isArray(catalog.scorecard?.weights) ? catalog.scorecard.weights : [];
  if (weights.length !== 7 || weights.reduce((s, w) => s + w.weight, 0) !== 100 ||
      weights.some((w) => typeof w.key !== 'string' || !Number.isInteger(w.weight) || w.weight <= 0) ||
      new Set(weights.map((w) => w.key)).size !== 7) {
    errors.push('CANONICAL_SCORECARD_INVALID');
  }
  const scores = isRecord(source.score_evidence) ? source.score_evidence : {};
  let proposedWeightedScore = 0;
  let completeScore = weights.length === 7 && !errors.includes('CANONICAL_SCORECARD_INVALID');
  for (const w of weights) {
    const item = scores[w.key];
    const valid = isRecord(item) && Number.isInteger(item.score_0_to_5) &&
      item.score_0_to_5 >= 0 && item.score_0_to_5 <= 5 &&
      Array.isArray(item.evidence_urls) && item.evidence_urls.length >= 1 &&
      item.evidence_urls.every(publicEvidenceUrl);
    if (!valid) {
      missing.push('SCORE_EVIDENCE_' + w.key.toUpperCase());
      completeScore = false;
    } else {
      proposedWeightedScore += item.score_0_to_5 * w.weight / 5;
      submittedEvidence.push('score:' + w.key);
    }
  }
  const uniqueErrors = distinct(errors), uniqueConflicts = distinct(conflicts), uniqueMissing = distinct(missing);
  let status = 'NEEDS_EVIDENCE';
  if (uniqueErrors.length) status = 'REJECT_INVALID_INTAKE';
  else if (uniqueConflicts.length) status = 'RECOMMEND_MERGE_OR_RENAME';
  else if (!uniqueMissing.length) status = 'READY_FOR_HUMAN_EVIDENCE_REVIEW';

  return Object.freeze({
    schema_version: INTAKE_REVIEW_SCHEMA,
    candidate_id: typeof source.hypothesis_id === 'string' ? source.hypothesis_id : null,
    status, errors: uniqueErrors, conflicts: uniqueConflicts, missing_evidence: uniqueMissing,
    submitted_evidence_count: submittedEvidence.length,
    // Scores are *submitted claims*, not validated user demand, revenue or rank.
    proposed_score_unverified: completeScore ? proposedWeightedScore : null,
    is_market_verified: false, is_product_approved: false, may_implement_app: false,
    may_create_repo: false, may_build_native: false, may_use_store: false,
    may_serve_ads: false, may_deploy: false, ready_to_rank: false,
    requires_independent_human_review: true,
    note: 'No URL was fetched or verified. No GitHub, Cloudflare, Store or App resource was modified.'
  });
}
