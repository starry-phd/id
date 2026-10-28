import test from 'node:test';
import assert from 'node:assert/strict';
import {BATTERY,CANDIDATE_VERSION} from '../src/index.ts';
import {AI3_R002_P05_VERSION,AI3_R002_LIVE} from '../src/wave1-r002-p05-audit-review.ts';
import {R002_P05_QUEUE_BOUNDARY,R002_QUEUE_ACK_APPROVED} from '../../../apps/api/src/wave1-r002-protected-route-proposal.ts';
import {R003_P05_ACK_CONTRACT,R003_LIVE_ENABLED,reviewR003CommitBeforeAck} from '../src/wave1-r003-p05-ack-interop.ts';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const event={...scope,schema_version:CANDIDATE_VERSION,event_id:'evt_123',
 event_type:'notification.delivery.queued',occurred_at:'2026-10-28T13:00:00Z',
 correlation_id:'corr_1',idempotency_key:'idempotent_123',resource_ref:'anon_resource',
 actor_ref:'anon_actor',result:'queued',classification:'metadata_only'};
const digest='a'.repeat(64),identity={...scope,event_id:event.event_id};
const snapshot=()=>({
 source:{...identity,issuer_version:1,issuer_state:'candidate_unverified',event_digest:digest},
 session:{...identity,actor_ref:event.actor_ref,auth_version:4,session_version:7,state:'active'},
 legal:{...identity,policy_version:2,lawful_now:true,erasure_hold:'none'},
 receipt:{...identity,idempotency_key:event.idempotency_key,event_digest:digest,
  commit_ref:'commit_1',commit_revision:10,ledger_ref:'d1_primary',state:'committed'},
 witness:{...identity,commit_ref:'commit_1',event_digest:digest,
  witness_ref:'witness_1',witness_revision:10,ledger_ref:'external_witness',
  kind:'independent_anti_pitr_candidate'},
 queue:{...identity,delivery_ref:'delivery_1',ack_attempted:false,phase:'unacknowledged'}
});
const review=(before=snapshot(),after=structuredClone(before),e=event,s=scope)=>
 reviewR003CommitBeforeAck({scope:s,event:e,before,after});
function inert(r){
 assert.equal(r.contract,R003_P05_ACK_CONTRACT);
 for(const k of ['may_ack_queue','may_send','may_enqueue','may_retry','may_write_d1',
  'may_grant_battery','may_sell_battery','may_publish','live'])assert.equal(r[k],false,k);
 assert.equal(JSON.stringify(r).includes(event.actor_ref),false);
 assert.equal(JSON.stringify(r).includes(digest),false);
}
test('source-parity: actual R002 AI3 / AI4 are not live authorities',()=>{
 assert.match(AI3_R002_P05_VERSION,/r002/);
 assert.equal(AI3_R002_LIVE,false);
 assert.equal(R002_QUEUE_ACK_APPROVED,false);
 assert.equal(R002_P05_QUEUE_BOUNDARY.may_ack,false);
 assert.equal(BATTERY.price,'free');assert.equal(BATTERY.purchasable,false);
 assert.equal(R003_LIVE_ENABLED,false);
});
test('synthetic two-snapshot consistency NEVER grants ACK or a notification',()=>{
 const r=review();assert.equal(r.status,'review_only');
 assert.equal(r.reason,'OFFLINE_ONLY_NO_ACK');inert(r);
});
test('client-supplied signature_verified flag is not cryptographic proof',()=>{
 const x=snapshot();x.source.signature_verified=true;
 const r=review(x);assert.equal(r.reason,'CANONICAL_SIGNER_PENDING');inert(r);
});
test('wrong issuer scope, unknown signer and digest deny',()=>{
 const variants=[
  x=>x.source.app_id='foreign',
  x=>x.source.issuer_version=0,
  x=>x.source.issuer_state='verified',
  x=>x.source.event_digest='not-a-hash'];
 for(const change of variants){const x=snapshot();change(x);
  const r=review(x);assert.equal(r.reason,'CANONICAL_SIGNER_PENDING');inert(r);}
});
test('wrong actor, revocation and invalid session version deny notification',()=>{
 const variants=[x=>x.session.actor_ref='other',x=>x.session.state='revoked',
  x=>x.session.auth_version=0,x=>x.session.event_id='replayed'];
 for(const change of variants){const x=snapshot();change(x);
  const r=review(x);assert.equal(r.reason,'SESSION_NOT_CURRENT');inert(r);}
});
test('erasure requires explicit legal hold and matching deleted state',()=>{
 const deleted={...event,event_type:'identity.member.deleted'};
 const a=snapshot();a.session.state='deleted';
 assert.equal(review(a,structuredClone(a),deleted).reason,'LAWFUL_POLICY_PENDING');
 a.legal.erasure_hold='active';
 assert.equal(review(a,structuredClone(a),deleted).status,'review_only');
 inert(review(a,structuredClone(a),deleted));
});
test('retention denied, unknown version and extra PII block',()=>{
 for(const change of [
  x=>x.legal.lawful_now=false,x=>x.legal.policy_version=0,
  x=>x.legal.email='unsafe']){
  const x=snapshot();change(x);const r=review(x);
  assert.equal(r.reason,'LAWFUL_POLICY_PENDING');inert(r);}
});
test('missing commit, duplicate digest and old revision do not permit ACK',()=>{
 for(const change of [
  x=>x.receipt.state='missing',x=>x.receipt.commit_revision=0,
  x=>x.receipt.event_digest='b'.repeat(64),x=>x.receipt.idempotency_key='other']){
  const x=snapshot();change(x);const r=review(x);
  assert.equal(r.reason,'RECEIPT_NOT_COMMITTED');inert(r);}
});
test('same-ledger witness and PITR rollback floor are insufficient',()=>{
 for(const change of [
  x=>x.witness.ledger_ref='d1_primary',x=>x.witness.witness_revision=9,
  x=>x.witness.commit_ref='wrong',x=>x.witness.kind='self_asserted']){
  const x=snapshot();change(x);const r=review(x);
  assert.equal(r.reason,'INDEPENDENT_WITNESS_MISSING');inert(r);}
});
test('ACK observed before authoritative durable commit gate is denied',()=>{
 for(const change of [
  x=>x.queue.ack_attempted=true,x=>x.queue.phase='acked',
  x=>x.queue.event_id='other']){
  const x=snapshot();change(x);const r=review(x);
  assert.equal(r.reason,'ACK_ALREADY_ATTEMPTED');inert(r);}
});
test('late revoke, receipt race, witness revision and legal drift deny',()=>{
 for(const change of [
  x=>{x.session.state='revoked';x.session.auth_version=5;},
  x=>x.receipt.commit_revision=11,x=>x.witness.witness_revision=11,
  x=>x.legal.lawful_now=false]){
  const after=snapshot();change(after);
  const r=review(snapshot(),after);assert.equal(r.status,'blocked');inert(r);}
});
test('scope cross-brand, production and malformed accessors fail closed',()=>{
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'}]){
  const r=review(snapshot(),snapshot(),event,s);assert.equal(r.status,'blocked');inert(r);
 }
 const evil=snapshot();Object.defineProperty(evil,'source',{enumerable:true,get(){throw Error('read')}});
 const r=reviewR003CommitBeforeAck({scope,event,before:evil,after:snapshot()});
 assert.equal(r.status,'blocked');inert(r);
});
test('no transport or payment action exists',()=>{
 assert.equal(typeof reviewR003CommitBeforeAck,'function');
 assert.equal('ack' in reviewR003CommitBeforeAck,false);
 assert.equal('send' in reviewR003CommitBeforeAck,false);
});
