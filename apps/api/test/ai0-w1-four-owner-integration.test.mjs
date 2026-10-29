import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {URL} from 'node:url';
import {W1_AUTH_SELF_PATH,W1_AUTH_PROFILE_FIELDS,W1_AUTH_EVENT_CORE_NAMES}
 from '../../../modules/starry-id-v1/src/w1-auth-boundary-contract.ts';
const root=new URL('../../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root));
const json=p=>JSON.parse(read(p).toString('utf8'));
const m=json('docs/ai/AI0-W1-FOUR-OWNER-INTEGRATION.v1.json');
const ai4=json('docs/operations/ai4-w1-shared-self-profile-contract-diff.v1.json');
const ai3=json('packages/rebuild-ai3/docs/W1-D87-D06-AUTH-INBOX-ACK-CONTRACT.v1.json');
const ai2=json('packages/rebuild-billing/docs/AI2-W1-D87-A-BILLING-AUTHORITY-INTERFACES.v0.json');
test('all four owners and eleven original Git blobs are preserved byte for byte',()=>{
 assert.equal(m.owners.length,4);
 const files=m.owners.flatMap(x=>x.files);
 assert.equal(files.length,11);assert.equal(new Set(files.map(x=>x.path)).size,11);
 for(const f of files){const b=read(f.path);
  assert.equal(createHash('sha1').update('blob '+b.byteLength+'\0').update(b).digest('hex'),f.blob,f.path);}
});
test('AI1 AI4 and actual standalone self-profile contract align without shared registration',()=>{
 const spec=json('docs/contracts/AI0-W1-ISOLATED-SELF-PROFILE.openapi.json');
 assert.deepEqual(Object.keys(spec.paths),[W1_AUTH_SELF_PATH]);
 assert.equal(ai4.reviewed_contract.canonical_path,W1_AUTH_SELF_PATH);
 assert.deepEqual(ai4.reviewed_contract.response_required_fields,[...W1_AUTH_PROFILE_FIELDS]);
 assert.deepEqual(spec.components.schemas.SelfProfile.required,[...W1_AUTH_PROFILE_FIELDS]);
 assert.equal(spec.components.schemas.SelfProfile.properties.profile_revision.minimum,1);
 assert.equal(ai4.reviewed_contract.real_worker_route_registered,false);
 assert.equal(m.review.shared_worker_registration_authorized,false);
});
test('all owner D06 business core names agree while private envelope remains nonfinal',()=>{
 assert.deepEqual(ai3.core.required_review_candidates,[...W1_AUTH_EVENT_CORE_NAMES]);
 assert.deepEqual(ai2.p05.layer1_existing_core_fields,[...W1_AUTH_EVENT_CORE_NAMES]);
 assert.equal(ai3.contract_not_final,true);
 assert.equal(ai2.p05.publishable,false);
 assert.equal(m.review.final_p05_schema_approved,false);
 assert.ok(m.unresolved.some(x=>x.id==='W1-PRIVATE-ENVELOPE-NAMES'));
});
test('new owner contracts never authorize live writers, Queue ACK, paid services or erase/restore',()=>{
 assert.ok(Object.values(ai2.operative_flags).every(x=>x===false));
 assert.ok(Object.values(ai3.flags).every(x=>x===false));
 assert.ok(ai3.state_matrix.every(x=>!x.may_live_ack&&!x.may_real_erase&&!x.may_restore));
 assert.equal(ai4.official_release.deployments_allowed,false);
 assert.equal(m.review.live_authorized,false);
});
test('receipt key scope inconsistency is explicitly held for correction, not silently approved',()=>{
 const table=ai2.proposed_tables.find(x=>x.name==='billing_verified_receipt');
 assert.notDeepEqual(ai2.identity_keys.transaction_unique_key,table.unique[0]);
 assert.equal(m.unresolved.find(x=>x.id==='W1-BILLING-KEY-SCOPE').status,
 'OWNER_CORRECTION_REQUIRED_BEFORE_WRITER_IMPLEMENTATION');
 assert.equal(m.review.physical_database_topology_approved,false);
});
test('official eleven release gates remain blocked and no evidence is fabricated',()=>{
 const r=json('docs/release-readiness/release-readiness.v0.json');
 assert.equal(r.gates.length,11);assert.ok(r.gates.every(x=>x.status==='blocked'&&x.evidence.length===0));
 assert.equal(r.release_authorization.granted,false);assert.equal(m.release.release_authorization,false);
 assert.equal(m.release.main_merge,false);assert.equal(m.release.deploy,false);
});
