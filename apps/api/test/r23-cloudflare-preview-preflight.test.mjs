import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {
 R23_PREVIEW_AUDIT_VERSION,R23_PREVIEW_MIN_WRANGLER,
 R23_PREVIEW_LIVE_EXECUTION_ALLOWED,R23_PREVIEW_EXPECTED_CONFIG,
 R23_PREVIEW_EXPECTED_COMMAND,auditR23CloudflarePreview
} from '../src/r23-cloudflare-preview-preflight.ts';

const safeConfig=[
 'name = "starry-id-api-preview-r23-isolated"',
 'main = "src/index.ts"',
 'compatibility_date = "2026-10-28"',
 '[previews]',
 '[previews.vars]',
 'STARRY_ENVIRONMENT = "staging"',
 'STARRY_APP_ID = "starry-id"'
].join('\n');
const proposal=()=>({
 root_directory:'/',preview_command:R23_PREVIEW_EXPECTED_COMMAND,
 branch_includes:['ai4/r23-preview-poc-isolated'],
 target_branch:'ai4/r23-preview-poc-isolated',
 worker_name:'starry-id-api-preview-r23-isolated',
 config_path:R23_PREVIEW_EXPECTED_CONFIG,wrangler_version:'4.152.0',
 config_text:safeConfig
});
const secure=(r)=>{
 assert.equal(r.contract,R23_PREVIEW_AUDIT_VERSION);
 for(const key of ['may_mutate_trigger','may_run_build','may_create_preview',
  'may_deploy_production','may_bind_real_d1','may_use_paid_services'])
  assert.equal(r[key],false,key);
 assert.equal(r.requires_human_cloudflare_approval,true);
 assert.equal(r.requires_cost_and_access_review,true);
 assert.equal(r.rollback,'NO_LIVE_CHANGE_CLOSE_DRAFT_ONLY');
 assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.reasons),true);
};
test('R23 Preview preflight is intentionally inert despite valid config candidate',()=>{
 const p=proposal(),r=auditR23CloudflarePreview(p);
 assert.equal(R23_PREVIEW_MIN_WRANGLER,'4.135.0');
 assert.equal(R23_PREVIEW_LIVE_EXECUTION_ALLOWED,false);
 assert.equal(r.state,'CONFIG_CANDIDATE_ONLY');assert.deepEqual(r.reasons,[]);
 secure(r);
});
test('real repo Wrangler config and actual build trigger fail for evidenced RCA',()=>{
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 const pkg=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8'));
 const oldVersion=pkg.devDependencies.wrangler.replace(/^[^0-9]+/,'');
 assert.match(config,/\[env\.staging\]/);
 assert.doesNotMatch(config,/\[previews\]/);
 const observed=auditR23CloudflarePreview({
  ...proposal(),preview_command:'npx wrangler preview',
  branch_includes:['ai0/sbase-20261028-five-owner-single-checkout'],
  target_branch:'ai0/sbase-20261028-five-owner-single-checkout',
  worker_name:'id-starry',
  config_path:'apps/api/wrangler.toml',wrangler_version:oldVersion,
  config_text:config
 });
 assert.equal(observed.state,'BLOCKED');
 for(const reason of ['PREVIEW_COMMAND_MISSING_EXPLICIT_CONFIG',
  'WRANGLER_PREVIEW_MIN_VERSION_NOT_MET','WORKER_MUST_BE_NEW_ISOLATED_POC',
  'BRANCH_MUST_BE_NEW_UNWATCHED_AI4_R23','CONFIG_PATH_NOT_ISOLATED',
  'PREVIEWS_SECTION_OR_SAFE_BINDINGS_MISSING'])
  assert.ok(observed.reasons.includes(reason),reason);
 secure(observed);
});
test('root directory misalignment is reported, cannot silently use app path',()=>{
 for(const root of ['', 'apps/api','./apps/api','/apps/api','../../']){
  const r=auditR23CloudflarePreview({...proposal(),root_directory:root});
  assert.ok(r.reasons.includes('ROOT_DIRECTORY_NOT_REPO_ROOT'));secure(r);
 }
});
test('Wrangler 4.134/4.45 insufficient; boundary 4.135 and newer are candidate only',()=>{
 for(const version of ['4.45.0','4.134.99','3.91.0','latest','5.0.0','4.135.0-beta']){
  const r=auditR23CloudflarePreview({...proposal(),wrangler_version:version});
  assert.equal(r.state,'BLOCKED');secure(r);
 }
 for(const version of ['4.135.0','4.135.1','4.152.0']){
  const r=auditR23CloudflarePreview({...proposal(),wrangler_version:version});
  assert.equal(r.state,'CONFIG_CANDIDATE_ONLY');secure(r);
 }
});
test('Wrangler preview must use explicit isolated config, never deploy or shell command',()=>{
 for(const command of ['npx wrangler preview',
  'npx wrangler preview --config apps/api/wrangler.toml',
  'npx wrangler deploy',
  'npx wrangler preview; npx wrangler deploy',
  'npm run api:check && npx wrangler preview',
  'npx wrangler preview --env production --config apps/api/wrangler.preview.poc.toml']){
  const r=auditR23CloudflarePreview({...proposal(),preview_command:command});
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('PREVIEW_COMMAND_MISSING_EXPLICIT_CONFIG'));secure(r);
 }
});
test('only an isolated new R23 branch can be allowlisted for future human approval',()=>{
 for(const branch of ['main','master','production',
  'ai0/sbase-20261028-five-owner-single-checkout',
  'ai4/sbase-20261028-manifest-factory-offline-contract',
  'ai4/r23-preview-poc-isolated && deploy']){
  const r=auditR23CloudflarePreview({...proposal(),
   target_branch:branch,branch_includes:[branch]});
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('BRANCH_MUST_BE_NEW_UNWATCHED_AI4_R23'));secure(r);
 }
});
test('wildcard, multiple branches, wrong branch filter cannot auto-run',()=>{
 for(const includes of [['*'],['main'],[],['ai4/r23-preview-poc-isolated','main'],
  ['ai0/sbase-20261028-five-owner-single-checkout']]){
  const r=auditR23CloudflarePreview({...proposal(),branch_includes:includes});
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('TRIGGER_MUST_TARGET_ONLY_ISOLATED_BRANCH'));secure(r);
 }
});
test('never target existing id-starry or production/staging Worker',()=>{
 for(const worker of ['id-starry','starry-id-api-staging','starry-id-api-local',
  'starry-id-api-preview-prod','hglobal-api','starry-id-api-preview-r23-isolated; rm']){
  const r=auditR23CloudflarePreview({...proposal(),worker_name:worker});
  assert.equal(r.state,'BLOCKED');secure(r);
 }
});
test('missing previews, unsafe environment or missing exact app scope is blocked',()=>{
 const configs=[
  safeConfig.replace('[previews]',''),
  safeConfig.replace('[previews.vars]',''),
  safeConfig.replace('STARRY_ENVIRONMENT = "staging"','STARRY_ENVIRONMENT = "production"'),
  safeConfig.replace('STARRY_APP_ID = "starry-id"','STARRY_APP_ID = "hglobal-id"'),
  safeConfig.replace('name = "starry-id-api-preview-r23-isolated"','name = "id-starry"'),
  safeConfig.replace('main = "src/index.ts"','main = "../../worker/prod.js"'),
  safeConfig.replace('compatibility_date = "2026-10-28"','compatibility_date = "not-a-date"')
 ];
 for(const config_text of configs){
  const r=auditR23CloudflarePreview({...proposal(),config_text});
  assert.equal(r.state,'BLOCKED');secure(r);
 }
});
test('reject D1/R2/Queue/Service/DO/Workflow/route bindings; previews do not safely isolate those by default',()=>{
 const extra=[
  '[[d1_databases]]\nbinding = "DB"',
  '[[r2_buckets]]\nbinding = "BUCKET"',
  '[[queues.producers]]\nbinding = "PUBLISHER"',
  '[[services]]\nbinding = "MEMBER_API"',
  '[[workflows]]\nbinding = "FLOW"',
  '[durable_objects]\nbindings = []',
  'route = "id.starry.phd/*"',
  'account_id = "sensitive"',
  'api_key = "danger"'
 ];
 for(const token of extra){
  const r=auditR23CloudflarePreview({...proposal(),
   config_text:safeConfig+'\n'+token});
  assert.equal(r.state,'BLOCKED');secure(r);
 }
});
test('extra arbitrary Wrangler config lines cannot bypass Preview-only fixture',()=>{
 for(const token of ['vars = {}','[env.production]','[vars]','STARRY_ENVIRONMENT = "development"',
  'STARRY_APP_ID = "other-app"','unsafe_flag = true']){
  const r=auditR23CloudflarePreview({...proposal(),config_text:safeConfig+'\n'+token});
  assert.equal(r.state,'BLOCKED');secure(r);
 }
});
test('snapshot must be exact plain data, never getters/credentials or prototype surprises',()=>{
 const a=proposal();
 let touched=false;
 Object.defineProperty(a,'worker_name',{get(){touched=true;throw Error('bad getter')}});
 const out=auditR23CloudflarePreview(a);
 assert.equal(touched,false);
 assert.deepEqual(out.reasons,['SNAPSHOT_SHAPE_OR_UNEXPECTED_FIELD']);secure(out);
 for(const input of [null,[],{},Object.assign(Object.create({bad:true}),proposal()),
  {...proposal(),auth_token:'DO_NOT_LOG'}]){
  const r=auditR23CloudflarePreview(input);
  assert.deepEqual(r.reasons,['SNAPSHOT_SHAPE_OR_UNEXPECTED_FIELD']);secure(r);
 }
});
test('untrusted snapshot never emits secret input, authorizing or deploy commands',()=>{
 const secret='sk-test-synthetic-secret-that-must-not-be-logged';
 const r=auditR23CloudflarePreview({...proposal(),
  config_text:safeConfig+'\nsecret = "'+secret+'"'});
 assert.equal(r.state,'BLOCKED');
 assert.doesNotMatch(JSON.stringify(r),/sk-test-synthetic-secret/);
 assert.equal(r.suggested_command,R23_PREVIEW_EXPECTED_COMMAND);
 secure(r);
});
test('isolated path/command must remain exact, repo root path cannot become real config',()=>{
 for(const path of ['wrangler.toml','apps/api/wrangler.toml',
  'apps/api/../wrangler.toml','/etc/secret.toml']){
  const r=auditR23CloudflarePreview({...proposal(),config_path:path});
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('CONFIG_PATH_NOT_ISOLATED'));secure(r);
 }
});
test('no preview command is ever executed during evaluation',()=>{
 let accessed=0;
 const p=proposal();
 Object.defineProperty(p,'config_text',{get(){accessed++;return safeConfig}});
 const r=auditR23CloudflarePreview(p);
 assert.equal(accessed,0);assert.equal(r.state,'BLOCKED');secure(r);
});
