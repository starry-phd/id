import test from 'node:test';
import assert from 'node:assert/strict';
import {BATTERY,CANDIDATE_VERSION} from '../src/index.ts';
import {AI3_R002_P05_VERSION,AI3_R002_LIVE} from '../src/wave1-r002-p05-audit-review.ts';
import {R002_QUEUE_ACK_APPROVED} from '../../../apps/api/src/wave1-r002-protected-route-proposal.ts';
import {R004_P05_HANDSHAKE,R004_P05_LIVE,R004_SIBLING_CONTRACTS,
 reviewR004P05Handshake} from '../src/wave1-r004-p05-canonical-claim-handshake.ts';

const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const event={...scope,schema_version:CANDIDATE_VERSION,event_id:'evt_000001',
 event_type:'notification.delivery.queued',occurred_at:'2026-10-28T16:00:00Z',
 correlation_id:'corr_1',idempotency_key:'idem_111',resource_ref:'resource_1',
 actor_ref:'actor_111',result:'queued',classification:'metadata_only'};
const bind={...scope,event_id:event.event_id},digest='a'.repeat(64);
function evidence(){
 return {
  issuer:{...bind,actor_ref:event.actor_ref,idempotency_key:event.idempotency_key,
   envelope_version:'p05.canonical.v1-proposal',kid:'kid_1',epoch:1,
   nonce:'nonce_123456789',nonce_state:'unverified_unique_candidate',
   digest,signature_state:'unverified_candidate'},
  session:{...bind,actor_ref:event.actor_ref,auth_version:3,session_version:4,
   state:'active',authority_contract:R004_SIBLING_CONTRACTS.auth},
  legal:{...bind,policy_version:2,lawful_now:true,erasure_hold:'none'},
  receipt:{...bind,idempotency_key:event.idempotency_key,event_digest:digest,
   claim_ref:'claim_1',claim_revision:10,ledger_ref:'d1_primary',
   cas_state:'committed_unverified_candidate'},
  claim:{...bind,claim_ref:'claim_1',attempt_ref:'attempt_1',attempt_revision:10,
   competing_claim:'none_observed_candidate'},
  witness:{...bind,claim_ref:'claim_1',event_digest:digest,floor_revision:10,
   ledger_ref:'external_ledger',witness_ref:'witness_1',
   independence:'external_unverified_candidate'},
  queue:{...bind,delivery_ref:'delivery_1',ack_attempted:false,
   phase:'awaiting_real_commit'},
  ports:{canonical:'unconnected_candidate',auth:'unconnected_candidate',
   legal:'unconnected_candidate',receipt:'unconnected_candidate',
   witness:'unconnected_candidate',queue:'unconnected_candidate'}
 };
}
function review(before=evidence(),after=structuredClone(before),ev=event,sc=scope){
 return reviewR004P05Handshake({scope:sc,event:ev,before,after});
}
function noRights(x){
 assert.equal(x.contract,R004_P05_HANDSHAKE);
 for(const k of ['may_ack','may_send','may_retry','may_enqueue','may_write_d1',
  'may_grant_battery','may_sell_battery','may_publish','live'])
  assert.equal(x[k],false,k);
 for(const secret of [event.event_id,event.actor_ref,event.idempotency_key,digest,
  'kid_1','claim_1'])assert.equal(JSON.stringify(x).includes(secret),false);
}
test('R004 genuine inherited contract imports remain candidate and Battery free',()=>{
 assert.match(AI3_R002_P05_VERSION,/r002/);
 assert.equal(AI3_R002_LIVE,false);
 assert.equal(R002_QUEUE_ACK_APPROVED,false);
 assert.equal(R004_P05_LIVE,false);
 assert.equal(BATTERY.price,'free');
 assert.equal(BATTERY.purchasable,false);
 assert.equal(R004_SIBLING_CONTRACTS.issuer,'AI0_CANONICAL_P05_UNAPPROVED');
 assert.match(R004_SIBLING_CONTRACTS.transport,/r003/);
});
test('all structurally consistent snapshots still NEVER ACK or send',()=>{
 const r=review();assert.equal(r.state,'review_only');
 assert.equal(r.reason,'CANDIDATE_ONLY');noRights(r);
});
test('fake signature_verified cannot become cryptographic evidence',()=>{
 const x=evidence();x.issuer.signature_verified=true;
 const r=review(x);assert.equal(r.reason,'ISSUER_UNTRUSTED');noRights(r);
});
test('unapproved signer KID epoch nonce replay and digest mismatch deny',()=>{
 for(const mutate of [
  x=>x.issuer.kid='',x=>x.issuer.epoch=0,
  x=>x.issuer.nonce='replay',x=>x.issuer.nonce_state='replayed',
  x=>x.issuer.signature_state='verified',x=>x.issuer.digest='wrong',
  x=>x.issuer.actor_ref='actor_other',x=>x.issuer.event_id='evt_other',
  x=>x.issuer.idempotency_key='different']){
  const x=evidence();mutate(x);
  const r=review(x);assert.equal(r.reason,'ISSUER_UNTRUSTED');noRights(r);
 }
});
test('wrong actor event and revoked deleted or unknown active session deny',()=>{
 for(const mutate of [
  x=>x.session.actor_ref='other',x=>x.session.event_id='other',
  x=>x.session.state='revoked',x=>x.session.state='deleted',
  x=>x.session.state='unknown',x=>x.session.auth_version=0,
  x=>x.session.authority_contract='billing_q2_not_p05']){
  const x=evidence();mutate(x);
  const r=review(x);assert.equal(r.reason,'ACTOR_OR_SESSION_INVALID');noRights(r);
 }
});
test('late revoke and switch between snapshots close TOCTOU gap',()=>{
 for(const mutate of [
  x=>{x.session.state='revoked';x.session.auth_version=5;},
  x=>x.session.session_version=9,x=>x.issuer.kid='kid_2',
  x=>{x.receipt.claim_revision=11;x.claim.attempt_revision=11;
   x.witness.floor_revision=11;} ]){
  const a=evidence(),b=evidence();mutate(b);
  const r=review(a,b);assert.equal(r.state,'blocked');noRights(r);
 }
});
test('delete requires current deleted status and separate erasure hold',()=>{
 const ev={...event,event_type:'identity.member.deleted'};
 const x=evidence();x.session.state='deleted';
 assert.equal(review(x,structuredClone(x),ev).reason,'LEGAL_POLICY_PENDING');
 x.legal.erasure_hold='active';
 const r=review(x,structuredClone(x),ev);assert.equal(r.state,'review_only');noRights(r);
});
test('retention denied, policy drift and extra private fields deny',()=>{
 for(const mutate of [
  x=>x.legal.lawful_now=false,x=>x.legal.policy_version=0,
  x=>x.legal.actor_email='private@example.invalid']){
  const x=evidence();mutate(x);
  const r=review(x);assert.equal(r.reason,'LEGAL_POLICY_PENDING');noRights(r);
 }
 const a=evidence(),b=evidence();b.legal.policy_version=3;
 const r=review(a,b);assert.equal(r.reason,'LATE_CHANGE_OR_REORDER');noRights(r);
});
test('CAS missing/incorrect, out of order revision and replay idempotency deny',()=>{
 for(const mutate of [
  x=>x.receipt.cas_state='pending',x=>x.receipt.claim_revision=0,
  x=>x.receipt.idempotency_key='replayed_other',
  x=>x.receipt.event_digest='b'.repeat(64),
  x=>x.receipt.claim_ref='']){
  const x=evidence();mutate(x);const r=review(x);
  assert.equal(r.reason,'RECEIPT_OR_CAS_PENDING');noRights(r);
 }
});
test('two simultaneous same-event claims must not be interpreted as exclusive',()=>{
 for(const mutate of [
  x=>x.claim.competing_claim='second_claim',
  x=>x.claim.claim_ref='claim_racer',
  x=>x.claim.attempt_revision=11]){
  const x=evidence();mutate(x);const r=review(x);
  assert.equal(r.reason,'COMPETING_CLAIM');noRights(r);
 }
 const a=evidence(),b=evidence();b.claim.attempt_ref='attempt_2';
 const r=review(a,b);assert.equal(r.reason,'LATE_CHANGE_OR_REORDER');noRights(r);
});
test('same-ledger witness, PITR rollback floor and digest conflict deny',()=>{
 for(const mutate of [
  x=>x.witness.ledger_ref='d1_primary',x=>x.witness.floor_revision=9,
  x=>x.witness.claim_ref='unrelated',x=>x.witness.event_digest='b'.repeat(64),
  x=>x.witness.independence='self_reported']){
  const x=evidence();mutate(x);
  const r=review(x);assert.equal(r.reason,'WITNESS_OR_PITR_UNVERIFIED');noRights(r);
 }
});
test('ACK before independently proven commit and double ACK deny',()=>{
 for(const mutate of [
  x=>x.queue.ack_attempted=true,x=>x.queue.phase='acked',
  x=>x.queue.delivery_ref='',x=>x.queue.event_id='other']){
  const x=evidence();mutate(x);const r=review(x);
  assert.equal(r.reason,'ACK_PREMATURE');noRights(r);
 }
});
test('upstream signed issuer / Auth / D1 / witness / Queue outage all deny',()=>{
 for(const key of ['canonical','auth','legal','receipt','witness','queue']){
  const x=evidence();x.ports[key]='outage';
  const r=review(x);assert.equal(r.reason,'UPSTREAM_PORT_OUTAGE');noRights(r);
 }
});
test('scope mismatch, production, malformed event and unsupported kind deny',()=>{
 for(const sc of [{...scope,brand_id:'hglobal'},
   {...scope,environment:'production'}, {...scope,app_id:'other'}]){
  const r=review(evidence(),evidence(),event,sc);
  assert.equal(r.state,'blocked');noRights(r);
 }
 const r=review(evidence(),evidence(),{...event,event_type:'billing.store_state_observed'});
 assert.equal(r.reason,'INVALID_INPUT');noRights(r);
});
test('malicious getters, unknown fields and nested prototypes never authorize',()=>{
 const x=evidence();
 Object.defineProperty(x,'issuer',{enumerable:true,get(){throw Error('getter');}});
 const a=review(x,evidence());assert.equal(a.state,'blocked');noRights(a);
 const y=evidence();y.receipt.pii='forbidden';
 const b=review(y);assert.equal(b.reason,'RECEIPT_OR_CAS_PENDING');noRights(b);
 const z=evidence();Object.setPrototypeOf(z.claim,new Date());
 const c=review(z);assert.equal(c.reason,'COMPETING_CLAIM');noRights(c);
});
test('there is no executable ACK, sender, signer or grant endpoint',()=>{
 for(const op of ['ack','send','sign','dispatch','grantBattery','claimD1'])
  assert.equal(op in reviewR004P05Handshake,false);
 noRights(review());
});
