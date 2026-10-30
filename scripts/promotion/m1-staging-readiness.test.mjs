import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectM1StagingPlan} from './m1-staging-readiness.mjs';
const fixture=JSON.parse(readFileSync(new URL('../../docs/operations/AI4-M1-STAGING-RESOURCE-CAPABILITY.v1.json',import.meta.url),'utf8'));
const mutate=(path,value)=>{const x=structuredClone(fixture);let o=x;for(const k of path.slice(0,-1))o=o[k];o[path.at(-1)]=value;return x};
test('M1 isolated Staging draft is valid but never permission to create or deploy',()=>{
 assert.deepEqual(inspectM1StagingPlan(fixture),{valid:true,staging_authorized:false,release_authorized:false,failures:[]});
});
test('M1 Staging declaration fails closed on cross-brand, production and resource reuse',()=>{
 for(const [path,value] of [
  [['scope','brand_id'],'h-global'],[['scope','app_id'],'echo'],
  [['scope','environment'],'production'],[['scope','cross_brand_touched'],true],
  [['cloudflare','existing_production_worker'],'id-starry-m1-staging'],
  [['cloudflare','d1','reuses_echo_or_other_database'],true],
  [['cloudflare','d1','proposed_name'],'echo-starry'],
  [['cloudflare','d1','binding_verified'],true],
  [['cloudflare','worker','route_enabled'],true],
  [['cloudflare','worker','workers_dev_compatibility_verified'],true],
  [['cloudflare','secrets_configured'],true]
 ])assert.equal(inspectM1StagingPlan(mutate(path,value)).valid,false,path.join('.'));
});
test('M1 refuses fake provider readiness, broad access, changed costs and unauthorized releases',()=>{
 for(const [path,value] of [
  [['google_oidc','oauth_client_verified'],true],
  [['google_oidc','redirect_allowlist_verified'],true],
  [['google_oidc','pkce_state_nonce_required'],false],
  [['google_oidc','client_secret_in_repo'],true],
  [['access','mode'],'public'],
  [['access','deny_unlisted'],false],
  [['access','access_audit_required'],false],
  [['cost','incremental_usd_monthly_warning'],100],
  [['cost','estimated_incremental_usd_monthly'],0],
  [['cost','hard_spending_cap_verified'],true],
  [['cost','additional_charges_approved'],true],
  [['cost','pause_nonessential_testing_on_warning'],false],
  [['permissions','resource_creation_approved'],true],
  [['permissions','staging_deployment_approved'],true],
  [['safety','member_live_route_enabled'],true],
  [['safety','git_push_auto_deploy'],true],
  [['claims','staging_ready'],true]
 ])assert.equal(inspectM1StagingPlan(mutate(path,value)).valid,false,path.join('.'));
});
test('M1 rejects unknown nested configuration, forged evidence and missing fields',()=>{
 const bad=structuredClone(fixture);
 bad.cloudflare.worker.extra='unexpected';assert.equal(inspectM1StagingPlan(bad).valid,false);
 const forged=mutate(['evidence','google_oauth'],'https://example.invalid/claim');assert.equal(inspectM1StagingPlan(forged).valid,false);
 const absent=structuredClone(fixture);delete absent.access.identity_check_required;
 assert.equal(inspectM1StagingPlan(absent).valid,false);
 assert.equal(inspectM1StagingPlan(null).staging_authorized,false);
});
