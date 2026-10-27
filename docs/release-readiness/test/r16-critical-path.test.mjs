import test from 'node:test';
import assert from 'node:assert/strict';
import {auditR16CriticalPath,loadLocalJson} from '../verify-r16-critical-path.mjs';

const map=loadLocalJson('./r16-critical-path.v0.json');
const actual=loadLocalJson('./release-readiness.v0.json');
const clone=x=>JSON.parse(JSON.stringify(x));
function mustFail(change,release=actual){
 const altered=clone(map);change(altered);
 const result=auditR16CriticalPath(altered,release);
 assert.equal(result.ok,false,JSON.stringify(result));
}
test('R16 gate critical-path uses exactly 11 blocked canonical Gates without faking staging/production proof',()=>{
 const result=auditR16CriticalPath(map,actual);
 assert.equal(result.ok,true,result.errors.join('; '));
 assert.equal(result.gate_count,11);
 assert.equal(result.blocked_gates,11);
 assert.equal(result.workstreams,4);
 assert.equal(result.can_auto_deploy,false);
 assert.equal(result.external_platform_verified,false);
 assert.equal(result.release_authorized,false);
 assert.equal(result.signoff_plan_order.length,11);
 assert.equal(new Set(result.signoff_plan_order).size,11);
 for(const g of map.gates){
  for(const dep of g.signoff_dependencies)
   assert.ok(result.signoff_plan_order.indexOf(dep)<result.signoff_plan_order.indexOf(g.id));
 }
});
test('reject invented G00 owner signoff',()=>mustFail(x=>{x.manual_owner_approval_obtained=true}));
test('reject fabricated provider sandbox results',()=>mustFail(x=>{x.real_store_evidence_obtained=true}));
test('reject accidental approval for paid/cloud staging',()=>mustFail(x=>{x.paid_resources_authorized=true}));
test('reject unauthorized Wave2 admin center work',()=>mustFail(x=>{x.admin_wave2_authorized=true}));
test('reject a missing G06 canonical P05 Gate',()=>mustFail(x=>{x.gates=x.gates.filter(g=>g.id!=='G06-P05')}));
test('reject wrong owner for official G04-STORE Gate',()=>mustFail(x=>{x.gates.find(g=>g.id==='G04-STORE').owner='AI-0'}));
test('reject gate claim of approved live evidence',()=>mustFail(x=>{x.gates[0].proof_url='https://example.test/not-real'}));
test('reject unknown dependency ref',()=>mustFail(x=>{x.gates.find(g=>g.id==='G09-DEVICES').signoff_dependencies.push('G99-FAKE')}));
test('reject cyclic candidate signoff dependencies',()=>mustFail(x=>{x.gates.find(g=>g.id==='G00-SSOT').signoff_dependencies.push('G10-OPS')}));
test('reject duplicate graph dependency',()=>mustFail(x=>{x.gates.find(g=>g.id==='G08-WORKER-SDK').signoff_dependencies.push('G02-OIDC')}));
test('reject a parallel plan that quietly authorizes real operations',()=>mustFail(x=>{x.parallel_preflight[0].real_environment_action=true}));
test('reject using H-Global shared Auth as Starry planning scope',()=>mustFail(x=>{x.scope='starry_hglobal_shared'}));
test('reject tampering with the canonical release Gate',()=>{
 const official=clone(actual);official.gates.find(g=>g.id==='G00-SSOT').status='verified';
 assert.equal(auditR16CriticalPath(map,official).ok,false);
});
test('reject changing official release authorization',()=>{
 const official=clone(actual);official.release_authorization.granted=true;
 assert.equal(auditR16CriticalPath(map,official).ok,false);
});
test('reject enabling official auto-deploy',()=>{
 const official=clone(actual);official.deployment_automation.can_auto_deploy=true;
 assert.equal(auditR16CriticalPath(map,official).ok,false);
});
