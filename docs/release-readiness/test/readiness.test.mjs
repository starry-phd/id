import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preflight,validate} from '../check-release-readiness.mjs';
const base=JSON.parse(readFileSync(new URL('../release-readiness.v0.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(base);
test('source manifests are valid, blocked, never auto-deploy',()=>{
 const a=preflight(base); assert.equal(a.valid,true);assert.equal(a.can_auto_deploy,false);
 assert.equal(a.manual_review_eligible,false);assert.equal(a.blocked.length,11);
});
test('one green offline CI, editing a single gate, or self-asserted owner approval cannot unlock release',()=>{
 const x=copy();x.release_authorization.granted=true;
 assert.equal(preflight(x).manual_review_eligible,false);
 assert.ok(validate(x).some(s=>s.includes('cannot authorize')));
 const y=copy();y.gates[0].status='verified';
 assert.equal(preflight(y).valid,false);
 assert.equal(preflight(y).manual_review_eligible,false);
 const z=copy();z.requirements.reconciliation_complete=true;
 assert.equal(preflight(z).valid,false);
});
test('forbid eliminating guard, omitting gates, cross-brand deployment or violating DEV-I',()=>{
 for(const mutation of [
  x=>x.deployment_automation.can_auto_deploy=true,
  x=>x.gates.pop(),x=>x.gates[0].id='G06-P05',
  x=>x.system='both H-Global and Starry',
  x=>x.eas_cost_policy.automatic_native_build_on_every_pr=true,
  x=>x.eas_cost_policy.requires_owner_approval_for_paid=false,
 ]){
  const x=copy();mutation(x);
  assert.equal(preflight(x).valid,false);
 }
});
