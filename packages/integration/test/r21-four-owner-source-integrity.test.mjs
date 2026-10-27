import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditR21ExactSources,loadR21Sources} from '../../../docs/operations/verify-r21-original-sources.mjs';
const {plan,release}=loadR21Sources();
const change=fn=>{const v=structuredClone(plan);fn(v);return v;};
test('R21 authentic four-owner originals 13/13 with authoritative 11 blocked G00-G10',()=>{
 const out=auditR21ExactSources(plan,release);
 assert.equal(out.ok,true,out.errors.join(' | '));
 assert.equal(out.owner_count,4);
 assert.equal(out.original_owner_blobs_hash_verified,13);
 assert.equal(out.official_release_gates_blocked,11);
 assert.equal(out.live_ui_implemented,false);
});
test('R21 rejects swapped Owner fixed head, omitted path or invented Git Blob SHA',()=>{
 for(const f of [
  p=>p.owner_inputs[0].head_sha='f'.repeat(40),
  p=>p.owner_inputs[1].files[2].blob_sha='a'.repeat(40),
  p=>p.owner_inputs[2].files.pop(),
  p=>p.owner_inputs[3].files[0].path=p.owner_inputs[0].files[0].path,
  p=>p.owner_inputs[0].pr=138,
  p=>p.baseline.r20_integration_sha='a'.repeat(40)
 ])assert.equal(auditR21ExactSources(change(f),release).ok,false);
});
test('R21 recalculates byte-exact Git blobs, not trusting Owner manifest',()=>{
 const path='apps/api/src/round21-candidate-consumer-ui-state-resolver.ts';
 const read=p=>p===path?Buffer.from('fake owner code'):
  readFileSync(new URL('../../../'+p,import.meta.url));
 const out=auditR21ExactSources(plan,release,read);
 assert.equal(out.ok,false);assert.match(out.errors.join(' | '),/original Git owner blob changed/);
});
test('R21 never falsely claims live Auth/Billing/Task, Echo native routes, P05 or Store',()=>{
 for(const key of Object.keys(plan.denials))
  assert.equal(auditR21ExactSources(change(p=>p.denials[key]=true),release).ok,false,key);
});
test('R21 cannot reinterpret candidate UX as positive cross-owner live authority or approved CI',()=>{
 for(const key of Object.keys(plan.claims))
  assert.equal(auditR21ExactSources(change(p=>p.claims[key]=false),release).ok,false,key);
 const rr=structuredClone(release);rr.gates[0].status='verified';
 assert.equal(auditR21ExactSources(plan,rr).ok,false);
});
