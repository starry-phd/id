import test from 'node:test';
import assert from 'node:assert/strict';
import {CANDIDATE_VERSION} from '../src/index.ts';
import {WAVE1_PURCHASE_AUTH_SCHEMA,WAVE1_PURCHASE_AUTH_LIVE_ENABLED} from '../../../modules/starry-id-v1/src/wave1-purchase-entry-auth-gate.ts';
import {WAVE1_API_CONTRACT,WAVE1_API_NEW_AUTH_ENDPOINTS_ENABLED} from '../../../apps/api/src/wave1-worker-openapi-parity.ts';
import {createR002P05AuditReview,AI3_R002_P05_VERSION,AI3_R002_LIVE} from '../src/wave1-r002-p05-audit-review.ts';
const scope={brand_id:'starry',app_id:'starry-echo',environment:'staging'};
const e={...scope,schema_version:CANDIDATE_VERSION,event_id:'evt_123456789',
 event_type:'notification.delivery.queued',occurred_at:'2026-10-28T08:30:00Z',
 correlation_id:'correl_222',idempotency_key:'key_333333',
 resource_ref:'pseudo_resource_123',actor_ref:'pseudo_actor_456',
 result:'queued',classification:'metadata_only'};
const hex='a'.repeat(64);
const signed={...scope,event_id:e.event_id,idempotency_key:e.idempotency_key,
 actor_ref:e.actor_ref,event_digest:hex,issuer_key_ref:'issuer_ref_1',
 issuer_version:1,signature_verified:true};
const auth={...scope,event_id:e.event_id,actor_ref:e.actor_ref,
 auth_version:3,session_version:4,state:'active'};
const receipt={...scope,event_id:e.event_id,idempotency_key:e.idempotency_key,
 event_digest:hex,receipt_version:0,state:'missing'};
const legal={...scope,event_id:e.event_id,policy_version:1,
 lawful_now:true,erasure_hold:'none'};
function fixture(o={}){
 const counts={signed:0,auth:0,receipt:0,legal:0};
 const get=async(k,v)=>{counts[k]++;const x=o[k];
  return typeof x==='function'?x(counts[k]):x===undefined?structuredClone(v):x;};
 return {counts,api:createR002P05AuditReview({
  enabled:o.enabled??true,scope:o.scope??scope,
  ports:{verifySignedSource:async()=>get('signed',signed),
   readLawfulRetention:async()=>get('legal',legal),
   readEventAuth:async()=>get('auth',auth),
   readDurableReceipt:async()=>get('receipt',receipt)}
 })};
}
function noRights(x){
 assert.equal(x.contract,AI3_R002_P05_VERSION);
 for(const k of ['may_ack_queue','may_send','may_enqueue','may_retry','may_grant_battery',
 'may_sell_battery','may_restore','may_purge','may_publish','live'])assert.equal(x[k],false,k);
 for(const v of [e.actor_ref,e.event_id,hex,e.idempotency_key])
  assert.equal(JSON.stringify(x).includes(v),false);
}
test('real R001 AI1 purchase and AI4 health are not P05 authorization',()=>{
 assert.equal(WAVE1_PURCHASE_AUTH_LIVE_ENABLED,false);
 assert.equal(WAVE1_API_NEW_AUTH_ENDPOINTS_ENABLED,false);
 assert.match(WAVE1_PURCHASE_AUTH_SCHEMA,/purchase-entry/);
 assert.match(WAVE1_API_CONTRACT,/openapi-liveness/);
 assert.equal(AI3_R002_LIVE,false);
});
test('default off performs no backend access',async()=>{
 const f=fixture({enabled:false}),x=await f.api.review(e);
 assert.equal(x.reason,'DISABLED');noRights(x);
 assert.deepEqual(f.counts,{signed:0,auth:0,receipt:0,legal:0});
});
test('synthetic complete proof is still review-only',async()=>{
 const f=fixture(),x=await f.api.review(e);
 assert.equal(x.status,'review_only');assert.equal(x.reason,'CANDIDATE_NOT_AUTHORIZED');
 assert.deepEqual(f.counts,{signed:2,auth:2,receipt:2,legal:2});noRights(x);
});
test('unsigned event cannot probe AI1 private Auth',async()=>{
 const f=fixture({signed:{...signed,signature_verified:false}}),x=await f.api.review(e);
 assert.equal(x.reason,'UNVERIFIED_ISSUER');
 assert.equal(f.counts.auth,0);assert.equal(f.counts.receipt,0);noRights(x);
});
test('wrong brand/app/env and malformed event deny before backend',async()=>{
 for(const ev of [null,{...e,brand_id:'hglobal'},{...e,app_id:'other'},
  {...e,environment:'production'},{...e,schema_version:'unknown'},
  {...e,billing_sku:'paid'}]){
  const f=fixture(),x=await f.api.review(ev);
  assert.equal(x.reason,'INVALID_SCOPE_OR_EVENT');assert.equal(f.counts.signed,0);noRights(x);
 }
 assert.throws(()=>fixture({scope:{...scope,environment:'production'}}),/SCOPE_DENIED/);
});
test('billing and appeal are not security audit kinds',async()=>{
 for(const kind of ['billing.store_state_observed','appeal.received']){
  const x=await fixture().api.review({...e,event_type:kind});
  assert.equal(x.reason,'UNSUPPORTED_EVENT');noRights(x);
 }
});
test('issuer must bind exact signer event actor digest and app',async()=>{
 for(const x of [{...signed,event_id:'wrong'},{...signed,actor_ref:'wrong'},
  {...signed,app_id:'other'},{...signed,event_digest:'nothex'},
  {...signed,issuer_version:0},{...signed,raw_key:'secret'}]){
  const f=fixture({signed:x}),r=await f.api.review(e);
  assert.equal(r.reason,'UNVERIFIED_ISSUER');noRights(r);assert.equal(f.counts.auth,0);
 }
});
test('AI1 cannot substitute another active member or session',async()=>{
 for(const x of [{...auth,actor_ref:'other'},{...auth,event_id:'different'},
  {...auth,auth_version:0},{...auth,app_id:'other'}, {...auth,raw_email:'secret'}]){
  const r=await fixture({auth:x}).api.review(e);
  assert.equal(r.reason,'INVALID_AUTH');noRights(r);
 }
});
test('revoked deleted unknown session cannot permit queued delivery',async()=>{
 for(const state of ['revoked','deleted','unknown']){
  const r=await fixture({auth:{...auth,state}}).api.review(e);
  assert.equal(r.reason,'AUTH_STATE_DENIED');noRights(r);
 }
});
test('revocation and deletion audit require matching current state',async()=>{
 const a=await fixture({auth:{...auth,state:'revoked'}})
  .api.review({...e,event_type:'identity.session.revoked'});
 assert.equal(a.status,'review_only');noRights(a);
 const b=await fixture({auth:{...auth,state:'deleted'},legal:{...legal,erasure_hold:'active'}})
  .api.review({...e,event_type:'identity.member.deleted'});
 assert.equal(b.status,'review_only');noRights(b);
});
test('member deletion without separate legal hold denies',async()=>{
 const r=await fixture({auth:{...auth,state:'deleted'}})
  .api.review({...e,event_type:'identity.member.deleted'});
 assert.equal(r.reason,'INVALID_RETENTION');noRights(r);
});
test('missing lawful policy, scope or version blocks',async()=>{
 for(const l of [null,{...legal,lawful_now:false},{...legal,policy_version:0},
  {...legal,event_id:'other'},{...legal,raw_subject:'private'}]){
  const r=await fixture({legal:l}).api.review(e);
  assert.equal(r.reason,'INVALID_RETENTION');noRights(r);
 }
});
test('dedupe committed/conflict/unknown never implies Queue ACK',async()=>{
 for(const state of ['committed','conflict','unknown']){
  const r=await fixture({receipt:{...receipt,state,receipt_version:1}}).api.review(e);
  assert.equal(r.reason,'DUPLICATE_OR_UNKNOWN');noRights(r);
 }
});
test('receipt id/digest/key/app mismatch and unsafe extra fields deny',async()=>{
 for(const q of [{...receipt,event_id:'other'},{...receipt,event_digest:'b'.repeat(64)},
  {...receipt,app_id:'other'},{...receipt,idempotency_key:'wrong'},
  {...receipt,receipt_version:-1},{...receipt,sku:'paid'}]){
  const r=await fixture({receipt:q}).api.review(e);
  assert.equal(r.reason,'INVALID_RECEIPT');noRights(r);
 }
});
test('TOCTOU issuer version, auth revoke, receipt commit, legal drift all deny',async()=>{
 for(const options of [
  {signed:n=>n===1?signed:{...signed,issuer_version:2}},
  {auth:n=>n===1?auth:{...auth,state:'revoked',auth_version:4}},
  {receipt:n=>n===1?receipt:{...receipt,state:'committed',receipt_version:1}},
  {legal:n=>n===1?legal:{...legal,policy_version:2}},
  {legal:n=>n===1?legal:{...legal,lawful_now:false}}
 ]){
  const r=await fixture(options).api.review(e);
  assert.equal(r.reason,'EVIDENCE_CHANGED');noRights(r);
 }
});
test('each provider outage fails closed',async()=>{
 for(const key of ['signed','auth','receipt','legal']){
  const r=await fixture({[key]:()=>{throw Error('offline')}}).api.review(e);
  assert.equal(r.reason,'PORT_ERROR');noRights(r);
 }
});
test('malicious event getter never calls private ports',async()=>{
 const bad={...e};Object.defineProperty(bad,'actor_ref',
  {enumerable:true,get(){throw Error('getter')}});
 const f=fixture(),r=await f.api.review(bad);
 assert.equal(r.reason,'INVALID_SCOPE_OR_EVENT');assert.equal(f.counts.signed,0);
});
test('only review method exists, no sender or battery capability',()=>{
 const f=fixture();assert.deepEqual(Object.keys(f.api),['review']);
 assert.throws(()=>createR002P05AuditReview({scope,ports:{}}),/PORTS_REQUIRED/);
 for(const key of ['send','ack','enqueue','restore','purchase','grantBattery'])
  assert.equal(key in f.api,false);
});
