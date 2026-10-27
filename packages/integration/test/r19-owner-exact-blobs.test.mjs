import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditR19FourOwnerOriginalBlobs,readR19Inputs} from '../../../docs/operations/verify-r19-owner-blob-integration.mjs';
const {plan,official}=readR19Inputs();
const change=fn=>{const cp=structuredClone(plan);fn(cp);return cp;};
test('R19 four actual Owner GitHub blobs are byte-identical across one checkout and all official Gates blocked',()=>{
 const r=auditR19FourOwnerOriginalBlobs(plan,official);
 assert.equal(r.ok,true,r.errors.join(' | '));
 assert.equal(r.original_owner_blobs,14);
 assert.equal(r.owner_sources,4);
 assert.equal(r.official_release_gates_blocked,11);
 assert.equal(r.integrated_ci_proven_by_manifest,false);
});
test('R19 cannot silently replace PR, fixed source SHA, file or wrong owner',()=>{
 const wrong=[
  p=>p.source_owners[0].pr=127,
  p=>p.source_owners[0].head_sha='f'.repeat(40),
  p=>p.source_owners[1].files[0].git_blob_sha='a'.repeat(40),
  p=>p.source_owners[2].files[1].path='apps/api/src/injected.ts',
  p=>p.source_owners[3].files.pop(),
  p=>p.source_owners[1].owner='AI-4',
  p=>p.source_owners.reverse()
 ];
 for(const fn of wrong)assert.equal(auditR19FourOwnerOriginalBlobs(change(fn),official).ok,false);
});
test('R19 verifier hashes real content not filename-only list',()=>{
 const target='apps/api/src/round19-offline-four-domain-wiring.ts';
 const read=(p)=>p===target?Buffer.concat([readFileSync(new URL('../../../'+p,import.meta.url)),Buffer.from('tampered')]):readFileSync(new URL('../../../'+p,import.meta.url));
 const res=auditR19FourOwnerOriginalBlobs(plan,official,read);
 assert.equal(res.ok,false);
 assert.match(res.errors.join(' | '),/byte content differs/);
});
test('R19 cannot mark architecture, queue ACK, paid Battery, Stage or Production authorized',()=>{
 for(const key of ['merge_main','production','preview','staging','live_d1','real_queue_ack','real_dlq','canonical_p05','physical_a_or_b_chosen','lawful_retention_q104_q119','external_floor_or_kms','free_battery_sales','paid_usage','hglobal_work','publishable']){
  const res=auditR19FourOwnerOriginalBlobs(change(p=>{p.release_authorizations[key]=true}),official);
  assert.equal(res.ok,false,key);
 }
});
test('R19 cannot turn R18 or UX candidate into official customer App release',()=>{
 const r=auditR19FourOwnerOriginalBlobs(change(p=>{p.genuine_cross_d1_atomicity_proven=true}),official);
 assert.equal(r.ok,false);
 const r2=auditR19FourOwnerOriginalBlobs(change(p=>{p.baseline.ai0_product_candidate_sha='changed'}),official);
 assert.equal(r2.ok,false);
 const other=structuredClone(official);other.release_authorization.granted=true;
 assert.equal(auditR19FourOwnerOriginalBlobs(plan,other).ok,false);
});
