import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {R002_BILLING_IDENTITY_LIVE,R002_BILLING_IDENTITY_CONTRACT}
 from '../../../modules/starry-id-v1/src/wave1-round002-auth-billing-bridge.ts';
import {WAVE1_R002_BILLING_LIVE,WAVE1_R002_BILLING_BRIDGE}
 from '../../rebuild-billing/src/wave1-r002-signed-auth-billing-bridge.ts';
import {AI3_R002_LIVE,AI3_R002_P05_VERSION}
 from '../../rebuild-ai3/src/wave1-r002-p05-audit-review.ts';
import {R002_PUBLIC_ROUTES_APPROVED,R002_QUEUE_ACK_APPROVED,
 R002_PROPOSED_ROUTES,reviewR002ProtectedProposal}
 from '../../../apps/api/src/wave1-r002-protected-route-proposal.ts';

const get=p=>readFileSync(new URL('../../../'+p,import.meta.url));
const m=JSON.parse(get('docs/operations/ai0-wave1-r002-owner-blobs.v1.json').toString());
test('Round002 imports exactly four owner Draft PRs and twelve unchanged original Git blobs',()=>{
 assert.equal(m.owners.length,4);
 const unique=new Set();
 for(const group of m.owners){
  assert.equal(group.files.length,3,group.owner);
  for(const item of group.files){
   assert.equal(unique.has(item.path),false,item.path);
   unique.add(item.path);
   const data=get(item.path);
   const sha=createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
   assert.equal(sha,item.blob,item.path);
  }
 }
 assert.equal(unique.size,12);
});
test('Round002 four proposals stay review-only, reject live payments / queues / public endpoints',()=>{
 assert.equal(R002_BILLING_IDENTITY_LIVE,false);
 assert.equal(WAVE1_R002_BILLING_LIVE,false);
 assert.equal(AI3_R002_LIVE,false);
 assert.equal(R002_PUBLIC_ROUTES_APPROVED,false);
 assert.equal(R002_QUEUE_ACK_APPROVED,false);
 assert.match(R002_BILLING_IDENTITY_CONTRACT,/offline$/);
 assert.match(WAVE1_R002_BILLING_BRIDGE,/offline$/);
 assert.match(AI3_R002_P05_VERSION,/candidate$/);
 assert.equal(R002_PROPOSED_ROUTES.length,3);
 for(const r of R002_PROPOSED_ROUTES){
  assert.equal(r.lifecycle,'PROPOSED_NOT_REGISTERED');
  assert.equal(r.response_success_disabled,true);
  assert.equal(r.has_openapi_live_path,false);
 }
 const review=reviewR002ProtectedProposal({
  brand_id:'starry',app_id:'starry-demo',environment:'staging',
  path:'/v1/billing/entitlement-review',method:'POST',caller:'server_asserted'
 });
 assert.equal(review.status,'blocked');
 assert.equal(review.live,false);
 assert.equal(review.may_grant,false);
 assert.equal(review.may_deploy,false);
 assert.equal(review.may_ack_queue,false);
});
test('AI-0 Gate1/3 remain blocked and no mock can change owner authorization',()=>{
 assert.equal(m.gate1.status,'PARTIAL_BLOCKED');
 assert.equal(m.gate1.formal_cross_owner_trust_adapter_approved,false);
 assert.equal(m.gate1.blockers.length,4);
 assert.equal(m.gate2.new_integrated_sha_ci_passed,false); // manifest records pre-CI stage
 assert.equal(m.gate3.status,'BLOCKED');
 assert.equal(m.gate3.release_g00_g10_blocked,11);
 for(const k of ['production_authorized','main_merge_authorized',
 'new_paid_resource_authorized','consumer_private_monorepo_creation_authorized_now',
 'ads_enabled','battery_can_be_sold'])assert.equal(m.gate3[k],false,k);
});
