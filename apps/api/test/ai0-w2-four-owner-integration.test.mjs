import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {URL} from 'node:url';
import {W2_AUTH_OUTCOME_LIVE_ENABLED,takeW2VerifiedPrincipal}
 from '../../../modules/starry-id-v1/src/w2-r23-auth-outcome-adapter.ts';
import {LOCAL_WORKER_COMPOSITION_IS_DEPLOYED}
 from '../test-support/ai4-w2-local-worker-composition.ts';
const root=new URL('../../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root));
const json=p=>JSON.parse(read(p).toString('utf8'));
const m=json('docs/ai/AI0-W2-INTEGRATION.v1.json');
const billing=json('packages/rebuild-billing/docs/AI2-W1-D87-RECEIPT-IDENTITY-SCOPE-AMENDMENT.v1.json');
const privateVocabulary=json('packages/rebuild-ai3/docs/W2-D06-PRIVATE-ENVELOPE-VOCAB-AMENDMENT.v1.json');
test('W2 four owners ten new original blobs preserved byte for byte',()=>{
 const files=m.owners.flatMap(o=>o.files);
 assert.equal(m.owners.length,4);assert.equal(files.length,10);
 assert.equal(new Set(files.map(x=>x.path)).size,10);
 for(const f of files){const b=read(f.path);
 assert.equal(createHash('sha1').update('blob '+b.byteLength+'\0').update(b).digest('hex'),f.blob,f.path);}
});
test('Billing amendment distinguishes authoritative receipt identity from legacy scope projection',()=>{
 const old=json('packages/rebuild-billing/docs/AI2-W1-D87-A-BILLING-AUTHORITY-INTERFACES.v0.json');
 const receipt=old.proposed_tables.find(x=>x.name==='billing_verified_receipt');
 assert.deepEqual(billing.correction.authoritative_receipt_unique_fields,receipt.unique[0]);
 assert.deepEqual(billing.correction.legacy_expanded_scope_lookup_fields,old.identity_keys.transaction_unique_key);
 assert.equal(billing.correction.no_runtime_or_migration_approved,true);
 assert.ok(!billing.related_identities.first_claim_lineage.authoritative_unique_fields.includes('s_user_id'));
 assert.equal(billing.canonical_store_namespace.necessary_verified_dimensions.length,6);
});
test('private envelope twelve-pair review keeps source and observed versions distinct',()=>{
 assert.equal(privateVocabulary.field_reconciliation.length,12);
 const pair=privateVocabulary.field_reconciliation.find(x=>x.ai1==='session_version');
 assert.equal(pair.mapping,'NO_ALIAS');
 assert.ok(privateVocabulary.delivery_modes.some(x=>x.member_session_requirement==='DO_NOT_REQUIRE_ACTIVE_MEMBER_SESSION_AFTER_REVOKE'));
 assert.ok(privateVocabulary.delivery_modes.every(x=>!x.may_ack&&!x.may_send&&!x.may_erase&&!x.may_restore));
 assert.equal(privateVocabulary.release.may_sign,false);
});
test('typed Auth outcome and local Worker cannot enable production or trust JSON copies',()=>{
 assert.equal(W2_AUTH_OUTCOME_LIVE_ENABLED,false);
 assert.equal(LOCAL_WORKER_COMPOSITION_IS_DEPLOYED,false);
 assert.equal(takeW2VerifiedPrincipal({status:'verified'}),null);
 assert.equal(m.review.public_worker_registered,false);
 assert.equal(m.review.live_gates_verified,false);
});
test('new owner operation permission is distinct from missing live proof and paid resources',()=>{
 assert.equal(m.operational_authorization.ai0_may_merge_after_checks,true);
 assert.equal(m.operational_authorization.ai0_may_deploy_after_checks,true);
 assert.equal(m.operational_authorization.new_paid_services_authorized,false);
 assert.equal(m.operational_authorization.new_real_resources_authorized,false);
 assert.equal(m.release.release_granted,false);
});
test('actual public Worker and official eleven blocked release gates remain unchanged',()=>{
 const b=read('apps/api/src/index.ts');
 assert.equal(createHash('sha1').update('blob '+b.byteLength+'\0').update(b).digest('hex'),
 'a9addff8a16c351ee8cbf3900c8aee52e7fb012b');
 const r=json('docs/release-readiness/release-readiness.v0.json');
 assert.equal(r.gates.length,11);
 assert.ok(r.gates.every(x=>x.status==='blocked'&&x.evidence.length===0));
 assert.equal(r.release_authorization.granted,false);
});
