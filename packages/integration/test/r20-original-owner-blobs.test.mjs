import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditR20Sources,loadR20Sources} from '../../../docs/operations/verify-r20-original-sources.mjs';
const {plan,release}=loadR20Sources();
const edit=fn=>{const p=structuredClone(plan);fn(p);return p;};
test('R20 13 original four-owner files exact Git blob bytes and 11 blocked release Gates',()=>{
 const x=auditR20Sources(plan,release);
 assert.equal(x.ok,true,x.errors.join(' | '));
 assert.equal(x.files,13);assert.equal(x.owners,4);assert.equal(x.official_blocked,11);
 assert.equal(x.cross_d1_physical_proven,false);
});
test('R20 rejects missing or swapped source PR/head/file',()=>{
 for(const fn of [
  p=>p.owners[0].pr=139,p=>p.owners[1].head_sha='a'.repeat(40),
  p=>p.owners[2].files.pop(),
  p=>p.owners[3].files[0].blob_sha='f'.repeat(40),
  p=>p.owners[3].files[1].path=p.owners[0].files[0].path
 ])assert.equal(auditR20Sources(edit(fn),release).ok,false);
});
test('R20 hashes file content not just manifest and filenames',()=>{
 const target='apps/api/src/round20-private-r19-owner-interop.ts';
 const read=p=>p===target?Buffer.from('modified') : readFileSync(new URL('../../../'+p,import.meta.url));
 const x=auditR20Sources(plan,release,read);
 assert.equal(x.ok,false);assert.match(x.errors.join('|'),/bytes mutated/);
});
test('R20 cannot fake P05/KMS/D1/ACK/Store/payment/production approval',()=>{
 for(const key of Object.keys(plan.denials))
  assert.equal(auditR20Sources(edit(p=>{p.denials[key]=true}),release).ok,false,key);
});
test('R20 blocks swapped release Gate and imaginary integrated CI proof',()=>{
 const rr=structuredClone(release);rr.gates[0].status='verified';
 assert.equal(auditR20Sources(plan,rr).ok,false);
 assert.equal(auditR20Sources(edit(p=>{p.claims.integrated_new_head_ci_requires_independent_verification=false}),release).ok,false);
});
