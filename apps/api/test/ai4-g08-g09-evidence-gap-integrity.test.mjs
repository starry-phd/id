import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {handleRequest} from '../src/index.ts';

const root=new URL('../../../',import.meta.url);
const at=p=>new URL(p,root);
const read=p=>readFileSync(at(p),'utf8');
const json=p=>JSON.parse(read(p));
const inventory=json('docs/operations/ai4-post-r008-g08-g09-evidence-provenance.v1.json');
const release=json('docs/release-readiness/release-readiness.v0.json');

test('source-linked AI-4 evidence inventory is historical and explicitly non-authoritative',()=>{
 assert.equal(inventory.schema_version,'starry.ai4.post-r008.g08-g09.evidence-provenance.v1');
 assert.equal(inventory.record_class,'SOURCE_LINKED_STATIC_AUDIT_NOT_A_LIVE_GATE_NOT_AN_APPROVAL');
 assert.equal(inventory.repository,'starry-phd/id');
 assert.equal(inventory.upstream.pr,237);
 assert.equal(inventory.upstream.sha,'ac99611e00c32c0f5945fb9989807b0dd2dda1a9');
 assert.equal(inventory.upstream.all_owner_r008_pr,234);
 assert.equal(inventory.upstream.original_ai4_r008_pr,229);
});

test('G08 and G09 retain EXACT official required evidence, owner and all-blocked release states',()=>{
 const sourceGates=release.gates.filter(g=>['G08-WORKER-SDK','G09-DEVICES'].includes(g.id));
 assert.equal(sourceGates.length,2);
 assert.equal(inventory.gates.length,2);
 for(const gate of sourceGates){
  const recorded=inventory.gates.find(g=>g.id===gate.id);
  assert.ok(recorded);
  assert.equal(gate.owner,'AI-4');
  assert.equal(recorded.owner,gate.owner);
  assert.equal(recorded.status,'blocked');
  assert.equal(recorded.status,gate.status);
  assert.equal(recorded.release_evidence_count,0);
  assert.deepEqual(recorded.required_evidence,gate.required_evidence);
  assert.deepEqual(gate.evidence,[]);
  assert.ok(recorded.not_proven.length>2);
 }
 assert.equal(release.gates.length,11);
 assert.ok(release.gates.every(g=>g.status==='blocked' && g.evidence.length===0));
 assert.equal(release.release_authorization.granted,false);
 assert.equal(release.deployment_automation.can_auto_deploy,false);
});

test('evidence manifest release permission flags cannot be misread as deploy approval',()=>{
 const r=inventory.release;
 assert.equal(r.gate1,'PARTIAL_BLOCKED');
 assert.equal(r.gate2,'R008_SAME_SHA_OFFLINE_PASS_ONLY');
 assert.equal(r.gate3,'G00_G10_11_OF_11_BLOCKED');
 assert.equal(r.p05_publishable,false);
 for(const f of ['release_authorization_granted','release_gate_ssot_modified',
  'main_merge_authorized','cloudflare_preview_reenable_authorized',
  'staging_deploy_authorized','production_deploy_authorized',
  'new_paid_resources_authorized','ads_enabled',
  'hglobal_scope_authorized','starry_battery_charged'])assert.equal(r[f],false,f);
});

test('each exact Git source blob matches the immutable inventory, not inferred from a file title',()=>{
 assert.equal(inventory.source_inventory.length,8);
 const seen=new Set();
 for(const record of inventory.source_inventory){
  assert.equal(typeof record.path,'string');
  assert.equal(typeof record.git_blob_sha,'string');
  assert.match(record.git_blob_sha,/^[0-9a-f]{40}$/);
  assert.ok(!seen.has(record.path));seen.add(record.path);
  const data=readFileSync(at(record.path));
  const digest=createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
  assert.equal(digest,record.git_blob_sha,record.path);
 }
});

test('actual Worker only exposes development/staging liveness; no protected route or preview env is live',async()=>{
 const url='https://example.invalid';
 const env={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
 let response=handleRequest(new Request(url+'/v1/health'),env);
 assert.equal(response.status,200);
 assert.equal((await response.json()).kind,'liveness-only');
 for(const endpoint of ['/v1/members','/v1/admin','/v1/p05/events']){
  assert.equal(handleRequest(new Request(url+endpoint),env).status,404);
  assert.equal(handleRequest(new Request(url+endpoint,{method:'POST'}),env).status,405);
 }
 response=handleRequest(new Request(url+'/v1/health'),{...env,STARRY_ENVIRONMENT:'preview'});
 assert.equal(response.status,503);
 response=handleRequest(new Request(url+'/v1/health'),{...env,STARRY_ENVIRONMENT:'production'});
 assert.equal(response.status,503);
});

test('public OpenAPI and SDK cannot be misrepresented as protected Auth/Store clients',()=>{
 const openapi=read('apps/api/openapi.yaml');
 const sdk=read('packages/sdk/src/index.ts');
 assert.match(openapi,/\/v1\/health:/);
 assert.match(openapi,/liveness \(NOT readiness\)/);
 assert.doesNotMatch(openapi,/^\s+\/v1\/(?:members|admin|auth|billing|events):/m);
 assert.match(sdk,/Public liveness client only/);
 assert.match(sdk,/FEATURE_DISABLED/);
 assert.match(sdk,/credentials:\s*'omit'/);
});

test('Expo dev identity, no known EAS configuration path and toolchain remain explicit',()=>{
 const app=json('apps/mobile/app.json');
 const pkg=json('apps/mobile/package.json');
 const conf=inventory.local_configuration_inventory;
 assert.equal(app.expo.ios.bundleIdentifier,'phd.starry.id.dev');
 assert.equal(app.expo.android.package,'phd.starry.id.dev');
 assert.equal(conf.dev_ios_bundle_identifier,app.expo.ios.bundleIdentifier);
 assert.equal(conf.dev_android_package,app.expo.android.package);
 assert.equal(pkg.dependencies.expo,'~54.0.20');
 assert.equal(pkg.main,'expo-router/entry');
 assert.equal(existsSync(at('eas.json')),false);
 assert.equal(existsSync(at('apps/mobile/eas.json')),false);
 assert.equal(conf.root_eas_json_found,false);
 assert.equal(conf.mobile_eas_json_found,false);
 assert.equal(conf.production_app_id_approved,false);
 assert.equal(conf.official_store_test_account_mapping_verified,false);
});

test('Wrangler is a local dry-run only, not an authenticated external Cloudflare success',()=>{
 const wrangler=read('apps/api/wrangler.toml');
 const scripts=json('package.json').scripts;
 const ci=read('.github/workflows/ai0-current-offline-gate.yml');
 assert.match(wrangler,/workers_dev\s*=\s*false/);
 assert.match(wrangler,/^\[env\.staging\]/m);
 assert.doesNotMatch(wrangler,/^\[env\.production\]/m);
 assert.doesNotMatch(wrangler,/^\[previews\]/m);
 assert.equal(scripts['api:check'],'wrangler deploy --dry-run --config apps/api/wrangler.toml --env staging');
 assert.match(ci,/npm run api:check/);
 assert.match(ci,/npm run mobile:config/);
 assert.doesNotMatch(ci,/\bnpx\s+wrangler\s+preview\b/);
 assert.doesNotMatch(ci,/\bnpx\s+eas\s+(?:build|update|submit)\b/);
 assert.equal(inventory.local_configuration_inventory.cloudflare_live_read_reperformed_in_this_audit,false);
});

test('G08/G09 future provider actions remain dependent on explicit human approval, not synthetic CI',()=>{
 assert.ok(inventory.decisions_pending.length>=4);
 assert.ok(inventory.gates.every(g=>g.blocked_by.length>=2));
 assert.ok(inventory.gates.every(g=>g.proven_offline_only.length>=2));
 const doc=read('docs/operations/AI4-POST-R008-G08-G09-SOURCE-LINKED-RELEASE-EVIDENCE.md');
 for(const anchor of ['#234','#235','#236','#237','G08','G09','evidence=[]',
  'TestFlight','Play Internal','Staging','H-Global','Rollback']){
  assert.ok(doc.includes(anchor),'missing review dependency: '+anchor);
 }
});
