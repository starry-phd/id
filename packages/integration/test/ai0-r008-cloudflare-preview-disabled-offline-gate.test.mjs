import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const snapshot=JSON.parse(read('docs/operations/ai0-r008-cloudflare-builds-disabled-audit.v1.json'));

test('R008 Cloudflare observed disablement is strictly a historical, scoped audit snapshot',()=>{
 assert.equal(snapshot.schema_version,'starry.ai0.cloudflare-builds-r008-offline-governance.v1');
 assert.equal(snapshot.record_kind,'HISTORICAL_SNAPSHOT_NOT_A_LIVE_CLOUDFLARE_QUERY');
 assert.equal(snapshot.cloudflare.connection,'starry.phd');
 assert.equal(snapshot.cloudflare.worker_name,'id-starry');
 assert.equal(snapshot.cloudflare.git_repository,'starry-phd/id');
 assert.equal(snapshot.cloudflare.production_branch,'main');
 assert.equal(snapshot.cloudflare.write_operation,'PATCH previews_enabled=false only');
 assert.equal(snapshot.cloudflare.patch_result,'HTTP_200_SUCCESS_POST_PATCH_GET_VERIFIED');
 assert.equal(snapshot.cloudflare.observed_after_patch.previews_enabled,false);
 assert.equal(snapshot.cloudflare.observed_after_patch.auto_build_enabled,false);
 assert.equal(snapshot.cloudflare.no_deploy_api_called,true);
});

test('R008 production cannot be falsely claimed safe or deployed based on disabled Preview setting',()=>{
 assert.equal(snapshot.cloudflare.observed_after_patch.production_deploy_command,'npx wrangler deploy');
 assert.equal(snapshot.cloudflare.observed_after_patch.production_root_directory,'/');
 assert.equal(snapshot.phase2.production_auto_build_authorized,false);
 assert.equal(snapshot.phase2.production_deploy_authorized,false);
 assert.equal(snapshot.phase2.preview_deploy_authorized,false);
 assert.equal(snapshot.phase2.previews_reenabled,false);
 assert.equal(snapshot.phase2.preview_bindings_authorized,false);
 for(const key of ['live_d1_authorized','live_queue_authorized','store_authorized',
  'paid_resource_authorized','ads_authorized','hglobal_authorized',
  'access_exposure_review_completed','cost_review_completed']){
  assert.equal(snapshot.phase2[key],false,key);
 }
});

test('R008 root Wrangler mismatch and offline-only named config remain visible',()=>{
 for(const name of ['wrangler.toml','wrangler.json','wrangler.jsonc'])
  assert.equal(existsSync(resolve(root,name)),false,name);
 const config=read('apps/api/wrangler.toml');
 assert.match(config,/^workers_dev\s*=\s*false\s*$/m);
 assert.match(config,/^\[env\.staging\]$/m);
 assert.doesNotMatch(config,/^\[env\.production\]$/m);
 assert.doesNotMatch(config,/^\[previews(?:\.[^\]]+)?\]$/m);
 assert.doesNotMatch(config,/^\[\[(?:d1_databases|r2_buckets|queues\.producers|queues\.consumers)\]\]$/m);
 const rootPkg=JSON.parse(read('package.json'));
 assert.equal(rootPkg.scripts['api:check'],
  'wrangler deploy --dry-run --config apps/api/wrangler.toml --env staging');
 assert.equal(rootPkg.scripts['api:dev'],
  'wrangler dev --config apps/api/wrangler.toml --env staging');
});

test('R008 current AI0 workflow uses read-only offline CI, not Cloudflare Preview or production deployment',()=>{
 const wf=read('.github/workflows/ai0-current-offline-gate.yml');
 const ci=read('docs/operations/verify-ci-consolidation.mjs');
 assert.match(wf,/permissions:\n  contents: read/);
 assert.match(wf,/npm run api:check/);
 assert.match(wf,/node docs\/release-readiness\/check-release-readiness\.mjs --assert-blocked/);
 assert.doesNotMatch(wf,/\bnpx\s+wrangler\s+(preview|deploy)\b/);
 assert.doesNotMatch(wf,/\bnpx\s+eas\s+(build|update)\b/);
 assert.match(ci,/verify-ai0-critical-tests\.mjs/);
});

test('R008 external R007 failure and same-SHA offline PASS must be independently preserved',()=>{
 assert.equal(snapshot.source.r007_offline_integrated_head_sha,
  '766ee89cc9991d8c17c6f610e6bdbbdb4aa78172');
 assert.equal(snapshot.source.cloudflare_r007_build_uuid,
  'a5d6e3a0-4319-4fb5-9db1-45f2a7d3fe7c');
 assert.equal(snapshot.source.cloudflare_r007_build_result,'FAIL_MISSING_PREVIEWS_BLOCK');
 assert.equal(snapshot.source.github_r007_same_sha_offline_result,'PASS');
 assert.equal(snapshot.gates.gate1,'PARTIAL_BLOCKED');
 assert.equal(snapshot.gates.gate3,'BLOCKED_11_OF_11');
 assert.equal(snapshot.gates.p05_publishable,false);
 assert.equal(snapshot.gates.release_authorization_granted,false);
 const r7=JSON.parse(read('docs/operations/ai0-wave1-r007-owner-blobs.v1.json'));
 assert.equal(r7.gate3.g00_g10_blocked,11);
 assert.equal(r7.gate3.p05_publishable,false);
});

test('R008 offline governance never upgrades preview setup to an approved live release',()=>{
 const doc=read('docs/operations/AI0-R008-CLOUDFLARE-SAFE-OFFLINE-BUILDS-PLAN.md');
 for(const phrase of ['HISTORICAL','separate owner approval','no production','rollback',
 'no D1','no Queue','no Store','no Ads']){
  assert.ok(doc.includes(phrase),'required scope: '+phrase);
 }
 assert.equal(snapshot.phase2.preview_deploy_authorized,false);
 assert.equal(snapshot.phase2.paid_resource_authorized,false);
});
