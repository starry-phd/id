import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {auditR18IntegratedOriginalBlobs,readR18IntegratedInputs} from '../../../docs/operations/verify-r18-owner-blob-integration.mjs';
const {manifest,official}=readR18IntegratedInputs();
const mutate=fn=>{const x=structuredClone(manifest);fn(x);return x;};
test('AI-0 R18 same-checkout contains all 14 byte-identical original Owner PR blobs with release blocked',()=>{
 const r=auditR18IntegratedOriginalBlobs(manifest,official);
 assert.equal(r.ok,true,r.errors.join(' / '));
 assert.equal(r.source_owners,4);
 assert.equal(r.exact_git_blob_files,14);
 assert.equal(r.release_blocked,11);
 assert.equal(r.release_authorized,false);
 assert.equal(r.integrated_ci_still_required,true);
});
test('R18 source blob manifest rejects fabricated SHA, cross-owner path and collision',()=>{
 for(const change of [
 p=>p.owner_provenance[1].files[0].git_blob_sha='a'.repeat(40),
 p=>p.owner_provenance[2].files[0].path='modules/starry-id-v1/ADR-ROUND18-AUTH-COMMITTED-LEGAL-SAGA-GATE.md',
 p=>p.owner_provenance[3].files[1].path=p.owner_provenance[3].files[0].path,
 p=>p.owner_provenance[0].head_sha='f84eab58e20377b5bd1ce313b969befb531b4938',
 p=>p.owner_provenance[1].files.pop()
 ])assert.equal(auditR18IntegratedOriginalBlobs(mutate(change),official).ok,false);
});
test('R18 source validator validates bytes not merely a path list or unrelated successful CI',()=>{
 const p='modules/starry-id-v1/src/round18-auth-committed-saga-preflight.ts';
 const original=readFileSync(new URL('../../../'+p,import.meta.url));
 const source=path=>path===p?Buffer.concat([original,Buffer.from('// tampered')]):
  readFileSync(new URL('../../../'+path,import.meta.url));
 const r=auditR18IntegratedOriginalBlobs(manifest,official,source);
 assert.equal(r.ok,false);assert.match(r.errors.join(';'),/differs from original Git owner blob/);
});
test('R18 integrated preflight rejects fake ACK, architecture/P05 approval, live deploy or paid usage',()=>{
 for(const field of ['queue_ack_allowed','architecture_a_or_b_approved','canonical_p05_approved','sole_live_publisher_approved','real_d1_queue_test_authorized','paid_usage_authorized','hglobal_development_authorized','deploy_authorized','free_battery_purchasable']){
  assert.equal(auditR18IntegratedOriginalBlobs(mutate(x=>{x.authorization[field]=true}),official).ok,false);
 }
});
test('R18 integrated preflight refuses fake overall CI success or release approval',()=>{
 assert.equal(auditR18IntegratedOriginalBlobs(mutate(p=>{p.ci_claims.owner_checks_only_not_sufficient=false}),official).ok,false);
 const altered=structuredClone(official);altered.gates[0].status='verified';
 assert.equal(auditR18IntegratedOriginalBlobs(manifest,altered).ok,false);
});
