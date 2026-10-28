import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AI0_WAVE1_EXPECTED_WORKFLOWS,AI0_WAVE1_EVIDENCE_SCHEMA,
 evaluateAi0Wave1Evidence} from '../src/ai0-wave1-ci-evidence-gate.ts';

const sha='84a23e6ed31fd5a91675ac46b3ab012d01567df6';
const snapshot=()=>({
 expected_sha:sha,
 workflows:AI0_WAVE1_EXPECTED_WORKFLOWS.map((name,id)=>({
  name,head_sha:sha,id:id+100,status:'completed',conclusion:'success'
 })),
 external_check:{
  name:'Workers Builds: id-starry',head_sha:sha,
  status:'completed',conclusion:'failure'
 }
});
function notLive(result){
 assert.equal(result.schema_version,AI0_WAVE1_EVIDENCE_SCHEMA);
 assert.equal(result.contract_gate,'blocked');
 assert.equal(result.store_sandbox_gate,'blocked');
 assert.equal(result.release_gate,'blocked');
 for(const flag of ['may_merge_main','may_deploy','may_open_store',
   'may_grant_entitlement','may_ack_queue','live'])assert.equal(result[flag],false,flag);
 assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.reasons));
}
test('three same-SHA GitHub offline workflows PASS, Cloudflare external FAIL independently',()=>{
 const v=evaluateAi0Wave1Evidence(snapshot());
 assert.equal(v.offline_gate,'verified');
 assert.equal(v.exact_sha_offline_ci_verified,true);
 assert.equal(v.external_worker_build,'fail');
 assert.equal(v.independent_external_check_verified,false);
 assert.ok(v.reasons.includes('CLOUDFLARE_BUILD_FAILED'));
 notLive(v);
});
test('any missing, duplicate, unknown, or wrong SHA workflow invalidates offline gate',()=>{
 const mutations=[
  s=>s.workflows.pop(),
  s=>{s.workflows[1]={...s.workflows[0],id:104};},
  s=>{s.workflows[1].head_sha='f'.repeat(40);},
  s=>{s.workflows[1].name='unexpected';},
  s=>{s.workflows[1].id=s.workflows[0].id;},
  s=>{s.workflows[2].status='queued';s.workflows[2].conclusion=null;},
  s=>{s.workflows[2].status='completed';s.workflows[2].conclusion='failure';}
 ];
 for(const fn of mutations){
  const s=snapshot();fn(s);const result=evaluateAi0Wave1Evidence(s);
  assert.equal(result.offline_gate,'unverified',JSON.stringify(s));
  notLive(result);
 }
});
test('a successful Cloudflare build is a separate observation, never a live release grant',()=>{
 const s=snapshot();s.external_check.conclusion='success';
 const v=evaluateAi0Wave1Evidence(s);
 assert.equal(v.offline_gate,'verified');
 assert.equal(v.external_worker_build,'pass');
 assert.equal(v.independent_external_check_verified,true);
 notLive(v);
});
test('wrong-SHA, missing or pending external check cannot be called a pass',()=>{
 const s=snapshot();s.external_check.head_sha='f'.repeat(40);
 assert.equal(evaluateAi0Wave1Evidence(s).external_worker_build,'unknown');
 s.external_check=null;
 assert.equal(evaluateAi0Wave1Evidence(s).external_worker_build,'unknown');
 s.external_check={name:'Workers Builds: id-starry',head_sha:sha,
  status:'in_progress',conclusion:null};
 assert.equal(evaluateAi0Wave1Evidence(s).external_worker_build,'pending');
});
test('external failures must not erase independently verified GitHub actions success',()=>{
 const s=snapshot();s.external_check.conclusion='failure';
 const v=evaluateAi0Wave1Evidence(s);
 assert.equal(v.offline_gate,'verified');
 assert.equal(v.external_worker_build,'fail');
 notLive(v);
});
test('untrusted accessor, invalid payload, or an injected merge approval fails closed',()=>{
 for(const bad of [null,{},[],{...snapshot(),may_merge_main:true}]){
  const v=evaluateAi0Wave1Evidence(bad);
  assert.equal(v.offline_gate,'unverified');notLive(v);
 }
 const s=snapshot();Object.defineProperty(s,'workflows',{enumerable:true,get(){throw Error('should not access')}});
 const denied=evaluateAi0Wave1Evidence(s);
 assert.equal(denied.offline_gate,'unverified');notLive(denied);
});

test('frozen real GitHub API R001 #191 observation is offline PASS while Cloudflare FAIL',()=>{
 const historic=JSON.parse(readFileSync(new URL('../../../docs/operations/ai0-wave1-r001-verified-ci-observation.v1.json',import.meta.url),'utf8'));
 assert.equal(historic.source_commit,sha);
 const result=evaluateAi0Wave1Evidence(historic.observation);
 assert.equal(result.expected_sha,historic.source_commit);
 assert.equal(result.offline_gate,'verified');
 assert.equal(result.external_worker_build,'fail');
 notLive(result);
});
