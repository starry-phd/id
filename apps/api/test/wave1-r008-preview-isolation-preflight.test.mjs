import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {URL} from 'node:url';
import {handleRequest} from '../src/index.ts';
import {
 R008_VERSION,R008_LIMITS,reviewR008PreviewProposal
} from '../src/wave1-r008-preview-isolation-preflight.ts';
import {R007_PROTECTED_PINS} from '../src/wave1-r007-worker-protected-denial.ts';

const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
const snapshot=JSON.parse(read('../../../docs/operations/ai0-r008-cloudflare-builds-disabled-audit.v1.json'));
const PROPOSAL_CONF=[
 '[previews]',
 '[previews.vars]',
 'STARRY_ENVIRONMENT = "preview"',
 'STARRY_APP_ID = "starry-id"'
].join('\n')+'\n';
function candidate(changes={}){
 return {worker:'id-starry',repository:'starry-phd/id',
  config_path:'apps/api/wrangler.toml',
  preview_command:'npx wrangler preview --config apps/api/wrangler.toml',
  preview_config_text:PROPOSAL_CONF,
  requested_binding_names:[],...changes};
}
function blocked(v,reason,shape=false){
 assert.equal(v.version,R008_VERSION);
 assert.equal(v.state,'blocked');
 assert.equal(v.reason,reason);
 assert.equal(v.proposal_shape_reviewed,shape);
 assert.equal(v.assessment,'offline_static_only_not_wrangler_validation');
 for(const f of ['may_reenable_preview','may_create_preview','may_deploy',
  'may_bind_resource','may_ack_queue','may_send','may_grant',
  'may_initialize_ads','publishable'])assert.equal(v[f],false,f);
 assert.ok(Object.isFrozen(v));
}
test('R008 exact planned text is shape-reviewable but never authorized',()=>{
 blocked(reviewR008PreviewProposal(candidate()),
   'SEPARATE_OWNER_AUTHORIZATION_REQUIRED',true);
});
test('historical AI-0 audit records Preview and auto builds OFF without claiming live state',()=>{
 assert.equal(snapshot.record_kind,'HISTORICAL_SNAPSHOT_NOT_A_LIVE_CLOUDFLARE_QUERY');
 assert.equal(snapshot.cloudflare.worker_name,'id-starry');
 assert.equal(snapshot.cloudflare.git_repository,'starry-phd/id');
 assert.equal(snapshot.cloudflare.observed_after_patch.previews_enabled,false);
 assert.equal(snapshot.cloudflare.observed_after_patch.auto_build_enabled,false);
 assert.equal(snapshot.phase2.previews_reenabled,false);
 assert.equal(snapshot.phase2.preview_deploy_authorized,false);
});
test('current Wrangler config is not a safe proposed Preview config',()=>{
 const cfg=read('../wrangler.toml');
 assert.match(cfg,/^\[env\.staging\]$/m);
 blocked(reviewR008PreviewProposal(candidate({preview_config_text:cfg})),
   'PREVIEW_CONFIG_INCOMPLETE');
});
test('root Preview command misses actual config and fails closed',()=>{
 for(const command of ['npx wrangler preview',
  'npx wrangler preview --config wrangler.toml',
  'npx wrangler deploy --config apps/api/wrangler.toml',
  'npx wrangler preview --config apps/api/wrangler.toml --env production',
  'npm run api:check','npx wrangler preview --config apps/api/wrangler.toml; echo trusted']){
  blocked(reviewR008PreviewProposal(candidate({preview_command:command})),
    'UNSAFE_PREVIEW_COMMAND');
 }
});
test('cross-brand Worker and repository impersonation fail closed',()=>{
 for(const x of [{worker:'id-hglobal'},{repository:'other/id'},
  {worker:'id-starry-preview'},{repository:'starry-phd/consumer-app'}])
  blocked(reviewR008PreviewProposal(candidate(x)),'SCOPE_DENIED');
});
test('alternate, root, absolute and traversal config paths cannot be approved',()=>{
 for(const config_path of ['wrangler.toml','/apps/api/wrangler.toml',
 '../apps/api/wrangler.toml','apps/api/../wrangler.toml',
 'apps/api/wrangler.toml.backup'])
  blocked(reviewR008PreviewProposal(candidate({config_path})),
    'UNSAFE_PREVIEW_COMMAND');
});
test('no requested resource bindings even mock/test storage without separate review',()=>{
 for(const requested_binding_names of [
  ['DB'],['PAYMENTS'],['KV'],['TEST_ONLY_QUEUE'],null,{},42,'none'
 ])blocked(reviewR008PreviewProposal(candidate({requested_binding_names})),
   'UNREVIEWED_BINDING_OR_ROUTE');
});
test('array own keys cannot sneak hidden bindings or prototype keys',()=>{
 const hidden=[];hidden.extra='secret';
 blocked(reviewR008PreviewProposal(candidate({requested_binding_names:hidden})),
  'UNREVIEWED_BINDING_OR_ROUTE');
 blocked(reviewR008PreviewProposal(candidate({requested_binding_names:
  new Proxy([], {get(){throw Error('hostile array');}})})),
  'UNREVIEWED_BINDING_OR_ROUTE');
});
test('D1, R2, Queue, DO, service bindings and production routes are always rejected',()=>{
 for(const line of ['[[previews.d1_databases]]','[[previews.r2_buckets]]',
  '[[previews.queues.producers]]','[[previews.services]]',
  '[[previews.durable_objects.bindings]]','[[previews.kv_namespaces]]',
  '[[previews.workflows]]','route = "secure.example"','[env.production]',
  'services = []','secretS_store = "x"','[[previews.containers]]']){
  blocked(reviewR008PreviewProposal(candidate({
   preview_config_text:PROPOSAL_CONF+line+'\n'
  })),'UNREVIEWED_BINDING_OR_ROUTE');
 }
});
test('Preview environment and app scope are explicitly test-only, not staging or production',()=>{
 for(const config of [
  '[previews]\n[previews.vars]\nSTARRY_ENVIRONMENT = "staging"\nSTARRY_APP_ID = "starry-id"',
  '[previews]\n[previews.vars]\nSTARRY_ENVIRONMENT = "preview"',
  '[previews]\nSTARRY_ENVIRONMENT = "preview"\nSTARRY_APP_ID = "starry-id"',
  'previews = {}','[vars]\nSTARRY_ENVIRONMENT = "preview"\nSTARRY_APP_ID = "starry-id"'
 ])blocked(reviewR008PreviewProposal(candidate({preview_config_text:config})),
  'PREVIEW_CONFIG_INCOMPLETE');
});
test('current actual Worker rejects preview environment, even GET liveness',async()=>{
 const env={STARRY_ENVIRONMENT:'preview',STARRY_APP_ID:'starry-id'};
 for(const path of ['/v1/health',...R007_PROTECTED_PINS.map(x=>x.path)]){
  for(const method of ['GET','POST']){
   const r=handleRequest(new Request('https://preview.invalid'+path,{method}),env);
   assert.equal(r.status,503);
   const body=await r.text();
   assert.equal(JSON.parse(body).error.code,'ENVIRONMENT_DISABLED');
   assert.doesNotMatch(body,/mac_hex|issuer_kid|actor_ref|token|session_version/);
  }
 }
});
test('stage-2 owner approvals cannot be forged as metadata in proposed input',()=>{
 for(const field of ['owner_approved','access_granted','billing_approved',
  'preview_enabled','authorized','publishable']){
  blocked(reviewR008PreviewProposal({...candidate(),[field]:true}),
   'INVALID_INPUT');
 }
});
test('hostile getter, inherited property, unknown field and spoofed prototype denied',()=>{
 let reads=0;
 const getter=candidate();
 Object.defineProperty(getter,'preview_config_text',{enumerable:true,get(){
  reads++;throw Error('should never execute');
 }});
 blocked(reviewR008PreviewProposal(getter),'INVALID_INPUT');
 assert.equal(reads,0);
 blocked(reviewR008PreviewProposal(Object.assign(Object.create({admin:true}),candidate())),
  'INVALID_INPUT');
 const withSymbol=candidate();withSymbol[Symbol('authorized')]=true;
 blocked(reviewR008PreviewProposal(withSymbol),'INVALID_INPUT');
});
test('nonobject and too-large config proposal cannot escape fail-closed behavior',()=>{
 for(const raw of [null,false,[],12,'x',{},Object.freeze({})])
  blocked(reviewR008PreviewProposal(raw),'INVALID_INPUT');
 blocked(reviewR008PreviewProposal(candidate({preview_config_text:'x'.repeat(
  R008_LIMITS.max_config_characters+1)})),'INVALID_INPUT');
});
test('frozen denial cannot be turned into Preview publish permission',()=>{
 const result=reviewR008PreviewProposal(candidate());
 assert.equal(result.may_reenable_preview,false);
 assert.equal(result.may_deploy,false);
 assert.equal(R008_LIMITS.preview_builds_enabled,false);
 assert.equal(R008_LIMITS.production_auto_builds_enabled,false);
 assert.equal(R008_LIMITS.ads_enabled,false);
 assert.equal(R008_LIMITS.release_authorized,false);
 assert.ok(Object.isFrozen(R008_LIMITS));
});
test('current repository is still dry-run only with no Preview config/wiring',()=>{
 assert.equal(existsSync(new URL('../../../wrangler.toml',import.meta.url)),false);
 assert.equal(existsSync(new URL('../../../wrangler.jsonc',import.meta.url)),false);
 const pkg=JSON.parse(read('../../../package.json'));
 assert.equal(pkg.scripts['api:check'],
  'wrangler deploy --dry-run --config apps/api/wrangler.toml --env staging');
 const cfg=read('../wrangler.toml');
 assert.doesNotMatch(cfg,/\[previews(?:\.|\])/);
 const wf=read('../../../.github/workflows/ai0-current-offline-gate.yml');
 assert.match(wf,/npm test/);assert.match(wf,/npm run api:check/);
});
test('safety proposal source has no network call, shell, signer, real Queue or sdk',()=>{
 const source=read('../src/wave1-r008-preview-isolation-preflight.ts');
 assert.doesNotMatch(source,/\bfetch\s*\(/);
 assert.doesNotMatch(source,/\bexec(?:Sync)?\s*\(/);
 assert.doesNotMatch(source,/crypto\.subtle\.(?:sign|verify)/);
 assert.doesNotMatch(source,/\.send\s*\(|\.ack\s*\(/);
 assert.doesNotMatch(source,/from ['"]react-native-google-mobile-ads/);
});
