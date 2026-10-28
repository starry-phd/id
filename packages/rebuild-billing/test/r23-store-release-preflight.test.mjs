import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectR23StoreReadiness,
 R23_STORE_PREFLIGHT_LIVE,R23_STORE_PREFLIGHT_VERSION}
 from '../src/r23-store-release-preflight.ts';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const read=p=>readFileSync(resolve(root,p),'utf8');
function reference(){
 return {
  releaseReadiness:JSON.parse(read('docs/release-readiness/release-readiness.v0.json')),
  workerToml:read('apps/api/wrangler.toml'),
  billingSource:read('packages/rebuild-billing/src/sbase-billing-client-candidate.ts')
 };
}
const ids=x=>x.blockers.map(b=>b.id);
function neverAllows(x){
 assert.equal(x.status,'blocked');
 assert.equal(x.verified_live,false);
 assert.equal(x.verified_offline_by_this_scan,false);
 for(const k of ['can_sell','can_grant','can_restore','can_ack_queue',
  'can_remove_ads','can_deploy'])assert.equal(x[k],false,k);
 assert.equal(x.central_release_blocked,true);
 assert.equal(x.no_store_or_member_data_processed,true);
}
test('real repo G04/G05 blocked with missing official Store and D1',()=>{
 const r=inspectR23StoreReadiness(reference());
 neverAllows(r);assert.equal(R23_STORE_PREFLIGHT_LIVE,false);
 assert.equal(r.schema_version,R23_STORE_PREFLIGHT_VERSION);
 assert.equal(r.observed_g04,'blocked');assert.equal(r.observed_g05,'blocked');
 assert.equal(r.code_exists,true);
 for(const id of ['APPLE_OFFICIAL_X5C_SANDBOX_MISSING',
  'GOOGLE_PLAY_API_RTDN_SANDBOX_MISSING',
  'BILLING_D1_BINDING_NOT_CONFIGURED'])assert.ok(ids(r).includes(id),id);
 assert.ok(!ids(r).includes('GATE_MANIFEST_INVALID_OR_UNSAFE'));
});
test('missing or owner-spoofed G04/G05 is a manifest failure',()=>{
 for(const id of ['G04-STORE','G05-BILLING-D1']){
  const d=reference();
  d.releaseReadiness.gates=d.releaseReadiness.gates.filter(g=>g.id!==id);
  const r=inspectR23StoreReadiness(d);neverAllows(r);
  assert.equal(r['observed_'+(id==='G04-STORE'?'g04':'g05')],
   'invalid_or_unverified');
  assert.ok(ids(r).includes('GATE_MANIFEST_INVALID_OR_UNSAFE'));
 }
 const d=reference();
 d.releaseReadiness.gates.find(g=>g.id==='G04-STORE').owner='AI-4';
 assert.ok(ids(inspectR23StoreReadiness(d))
  .includes('GATE_MANIFEST_INVALID_OR_UNSAFE'));
});
test('fabricated passed gates/owner release permission never authorize',()=>{
 const d=reference();
 for(const gate of d.releaseReadiness.gates)gate.status='passed';
 d.releaseReadiness.release_authorization.granted=true;
 d.releaseReadiness.deployment_automation.enabled=true;
 d.releaseReadiness.deployment_automation.can_auto_deploy=true;
 const r=inspectR23StoreReadiness(d);neverAllows(r);
 assert.equal(r.observed_g04,'invalid_or_unverified');
 assert.ok(ids(r).includes('GATE_MANIFEST_INVALID_OR_UNSAFE'));
});
test('self-declared evidence URLs and fake JWS are ignored/redacted',()=>{
 const d=reference();
 d.releaseReadiness.gates.find(g=>g.id==='G04-STORE').evidence=[
  {source:'apple',verified:true,url:'https://example.invalid/fake'},
  {store:'google',can_publish:true,jws:'PRIVATE_EXAMPLE_TOKEN'}
 ];
 const r=inspectR23StoreReadiness(d);neverAllows(r);
 assert.ok(ids(r).includes('APPLE_OFFICIAL_X5C_SANDBOX_MISSING'));
 assert.ok(!JSON.stringify(r).includes('PRIVATE_EXAMPLE_TOKEN'));
 assert.ok(!JSON.stringify(r).includes('example.invalid'));
});
test('commented out D1 section is NOT proof of configured D1',()=>{
 const d=reference();d.workerToml+='\n# [[env.staging.d1_databases]]';
 const r=inspectR23StoreReadiness(d);neverAllows(r);
 assert.ok(ids(r).includes('BILLING_D1_BINDING_NOT_CONFIGURED'));
});
test('configured D1 does not prove real CAS or Store verification',()=>{
 const d=reference();
 d.workerToml+='\n[[env.staging.d1_databases]]\nbinding="BILLING"\n';
 const r=inspectR23StoreReadiness(d);neverAllows(r);
 assert.ok(ids(r).includes('BILLING_D1_REAL_CAS_UNVERIFIED'));
 assert.ok(!ids(r).includes('BILLING_D1_BINDING_NOT_CONFIGURED'));
});
test('missing actual Billing source cannot be silently overlooked',()=>{
 const d=reference();d.billingSource='// no billing code';
 const r=inspectR23StoreReadiness(d);neverAllows(r);
 assert.equal(r.code_exists,false);
 assert.ok(ids(r).includes('BILLING_CANDIDATE_CODE_NOT_FOUND'));
});
test('duplicate gate ID or false authorization is rejected',()=>{
 const d=reference();d.releaseReadiness.gates[1].id='G04-STORE';
 neverAllows(inspectR23StoreReadiness(d));
 assert.ok(ids(inspectR23StoreReadiness(d))
  .includes('GATE_MANIFEST_INVALID_OR_UNSAFE'));
 const x=reference();x.releaseReadiness.release_authorization.granted=true;
 assert.ok(ids(inspectR23StoreReadiness(x))
  .includes('GATE_MANIFEST_INVALID_OR_UNSAFE'));
});
test('real checkout CLI asserts blocked and requires live proof',()=>{
 const cli=resolve(root,'packages/rebuild-billing/scripts/r23-store-preflight.mjs');
 const a=spawnSync(process.execPath,[cli,'--assert-blocked'],
  {cwd:root,encoding:'utf8'});
 assert.equal(a.status,0,a.stderr);
 neverAllows(JSON.parse(a.stdout));
 const b=spawnSync(process.execPath,[cli,'--require-live'],
  {cwd:root,encoding:'utf8'});
 assert.equal(b.status,3,b.stderr);neverAllows(JSON.parse(b.stdout));
});
test('checker does not modify source or emit raw Store/private data',()=>{
 const d=reference(),before=JSON.stringify(d);
 const r=inspectR23StoreReadiness(d);neverAllows(r);
 assert.equal(JSON.stringify(d),before);
 assert.ok(r.blockers.every(x=>!('receipt' in x)&&!('token' in x)));
});
