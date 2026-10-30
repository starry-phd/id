// AI-4 M1: review-only staging capability declaration. No credentials, Cloudflare calls,
// deployment grants, or release gate mutations. Independently verify live evidence.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value, expected) => record(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function inspectM1StagingPlan(plan) {
  const failures = [];
  const deny = text => failures.push(text);
  const requireKeys = (obj, expected, path) => {
    if (!sameKeys(obj, expected)) deny(path + ': missing/unknown keys');
    return record(obj) ? obj : {};
  };
  if (!record(plan)) return {valid:false, staging_authorized:false, release_authorized:false, failures:['plan must be object']};
  requireKeys(plan,['schema','purpose','status','source','scope','cloudflare','google_oidc','access','cost','evidence','permissions','safety','claims'],'root');
  if (plan.schema !== 'starry.ai4.m1.staging-capability.v1' ||
    plan.purpose !== 'review_only_no_resource_or_deployment_authority' ||
    plan.status !== 'proposed_unprovisioned') deny('source-only review status required');
  const source=requireKeys(plan.source,['repo','baseline_main_sha','issue','specification'],'source');
  if(source.repo!=='starry-phd/id' || !/^[0-9a-f]{40}$/.test(source.baseline_main_sha||'') ||
    source.issue!=='https://github.com/starry-phd/id/issues/220' ||
    source.specification!=='latest-development-integrated-v1.0-process-v3.0-2026-10-30-S2') deny('unreviewed source authority');
  const scope=requireKeys(plan.scope,['brand_id','app_id','environment','production_touched','cross_brand_touched'],'scope');
  if(scope.brand_id!=='starry'||scope.app_id!=='starry-id'||scope.environment!=='staging'||
    scope.production_touched!==false||scope.cross_brand_touched!==false) deny('cross-brand/production scope denied');
  const cf=requireKeys(plan.cloudflare,['account_id','account_verified','existing_production_worker','worker','d1','secrets_configured'],'cloudflare');
  const worker=requireKeys(cf.worker,['proposed_name','exists_verified','route_enabled','workers_dev_compatibility_verified','deploy_allowed'],'cloudflare.worker');
  const d1=requireKeys(cf.d1,['proposed_name','binding_name','exists_verified','binding_verified','migration_applied','reuses_echo_or_other_database'],'cloudflare.d1');
  if(cf.account_id!==null||cf.account_verified!==false||
    cf.existing_production_worker!=='id-starry'||cf.secrets_configured!==false||
    worker.proposed_name!=='id-starry-m1-staging'||worker.exists_verified!==false||
    worker.route_enabled!==false||worker.workers_dev_compatibility_verified!==false||
    worker.deploy_allowed!==false||d1.proposed_name!=='id-starry-m1-staging-db'||
    d1.binding_name!=='STARRY_SESSION_DB'||d1.exists_verified!==false||
    d1.binding_verified!==false||d1.migration_applied!==false||
    d1.reuses_echo_or_other_database!==false)
    deny('unverified/mutated Cloudflare plan or cross-service resource');
  const oidc=requireKeys(plan.google_oidc,['provider','oauth_client_verified','redirect_allowlist_verified','issuer_audience_verified','test_identity_verified','pkce_state_nonce_required','client_secret_in_repo'],'google_oidc');
  if(oidc.provider!=='google'||oidc.oauth_client_verified!==false||
    oidc.redirect_allowlist_verified!==false||oidc.issuer_audience_verified!==false||
    oidc.test_identity_verified!==false||oidc.pkce_state_nonce_required!==true||
    oidc.client_secret_in_repo!==false) deny('OIDC must remain unprovisioned with PKCE/state/nonce');
  const access=requireKeys(plan.access,['mode','allowlist_approved','deny_unlisted','identity_check_required','access_audit_required'],'access');
  if(access.mode!=='owner_and_explicit_test_identities_only'||access.allowlist_approved!==false||
    access.deny_unlisted!==true||access.identity_check_required!==true||
    access.access_audit_required!==true) deny('staging requires invite-only verified identity and audit');
  const cost=requireKeys(plan.cost,['incremental_usd_monthly_warning','estimated_incremental_usd_monthly','billing_plan_verified','hard_spending_cap_verified','additional_charges_approved','pause_nonessential_testing_on_warning'],'cost');
  if(cost.incremental_usd_monthly_warning!==10||cost.estimated_incremental_usd_monthly!==null||
    cost.billing_plan_verified!==false||cost.hard_spending_cap_verified!==false||
    cost.additional_charges_approved!==false||cost.pause_nonessential_testing_on_warning!==true)
    deny('unapproved/uncapped cost or missing US$10 warning rule');
  const evidence=requireKeys(plan.evidence,['cloudflare_account','d1_binding','google_oauth','access_control','cost_and_rollback'],'evidence');
  if(Object.values(evidence).some(v=>v!==null))deny('live evidence must be externally verified, not fabricated in plan');
  const perms=requireKeys(plan.permissions,['resource_creation_approved','oauth_configuration_changes_approved','staging_deployment_approved','production_release_approved'],'permissions');
  if(Object.values(perms).some(v=>v!==false))deny('resource/config/deployment approval cannot be self-declared');
  const safety=requireKeys(plan.safety,['git_push_auto_deploy','member_live_route_enabled','release_gates_all_verified','requires_separate_ai0_and_owner_review'],'safety');
  if(safety.git_push_auto_deploy!==false||safety.member_live_route_enabled!==false||
    safety.release_gates_all_verified!==false||safety.requires_separate_ai0_and_owner_review!==true)
    deny('unsafe release or live member route');
  const claims=requireKeys(plan.claims,['staging_ready','production_ready'],'claims');
  if(claims.staging_ready!==false||claims.production_ready!==false)deny('local plan is not remote readiness');
  // Even a syntactically valid document is never an authorization to create,
  // configure or deploy resources. Live platform evidence + explicit approvals are external.
  return {valid:failures.length===0,staging_authorized:false,release_authorized:false,failures};
}
