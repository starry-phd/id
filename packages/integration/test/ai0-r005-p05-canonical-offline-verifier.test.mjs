import test from 'node:test';
import assert from 'node:assert/strict';
import {AI0_R005_P05_VERSION,AI0_R005_P05_LIVE,
 createOfflineR005P05CanonicalVerifier}
 from '../src/ai0-r005-p05-canonical-offline-verifier.ts';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const time=1793200000;
const event=()=>({
 ...scope,event_id:'evt_123456789',event_type:'notification.delivery.queued',
 actor_ref:'actor_123456789',idempotency_key:'idem_123456789',
 issuer_kid:'dev-key-01',issuer_epoch:1,issued_at:time,
 nonce:'abcdefghijklmnopQRST',payload_sha256:'a'.repeat(64)
});
const key=()=>crypto.subtle.importKey('raw',new Uint8Array(32).fill(17),
 {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const bytes=e=>new TextEncoder().encode(JSON.stringify([
 AI0_R005_P05_VERSION,e.brand_id,e.app_id,e.environment,e.event_id,
 e.event_type,e.actor_ref,e.idempotency_key,e.issuer_kid,e.issuer_epoch,
 e.issued_at,e.nonce,e.payload_sha256
]));
const sign=async(e,k)=>Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,bytes(e))))
 .map(x=>x.toString(16).padStart(2,'0')).join('');
const init=(k,options={})=>createOfflineR005P05CanonicalVerifier({
 enabled:true,scope,nowSeconds:()=>time,
 readVerificationKey:async()=>({kid:event().issuer_kid,epoch:1,key:k}),...options
});
const flags=r=>{
 assert.equal(r.verified_live,false);
 for(const k of ['may_claim_authority','may_read_private_session',
  'may_send','may_enqueue','may_ack_queue','may_write_d1','may_grant',
  'may_publish','live'])assert.equal(r[k],false,k);
 assert.equal(JSON.stringify(r).includes('actor_123456789'),false);
 assert.equal(JSON.stringify(r).includes('payload_sha256'),false);
};
test('R005 canonical P05 verifier OFF by default; no keys read',async()=>{
 const k=await key();let reads=0;
 const v=createOfflineR005P05CanonicalVerifier({
  scope,nowSeconds:()=>time,
  readVerificationKey:async()=>{reads++;return {kid:event().issuer_kid,epoch:1,key:k};}
 });
 const r=await v.review({event:event(),signature_hex:'a'.repeat(64)});
 assert.equal(AI0_R005_P05_LIVE,false);assert.equal(r.reason,'DISABLED');
 assert.equal(reads,0);flags(r);
});
test('real nonexportable HMAC fixture signature verifies, but NEVER grants authority',async()=>{
 const k=await key(),e=event(),v=init(k);
 const r=await v.review({event:e,signature_hex:await sign(e,k)});
 assert.equal(r.status,'review_only');
 assert.equal(r.reason,'CRYPTOGRAPHIC_CANDIDATE_ONLY');
 assert.equal(r.cryptographic_candidate_match,true);flags(r);
});
test('wrong event, actor, app, environment, issuer KID, nonce and payload refuse proof',async()=>{
 const k=await key(),e=event(),sig=await sign(e,k),v=init(k);
 for(const changes of [{actor_ref:'actor_999999999'}, {event_id:'evt_999999999'},
  {app_id:'foreign-app'}, {environment:'development'}, {issuer_kid:'other-kid'},
  {issuer_epoch:2}, {nonce:'nonce_changed_123456789'}, {payload_sha256:'b'.repeat(64)}]){
  const r=await v.review({event:{...e,...changes},signature_hex:sig});
  assert.equal(r.status,'blocked');flags(r);
 }
});
test('expired, future and production fail before key access',async()=>{
 const k=await key();let reads=0;
 const v=init(k,{readVerificationKey:async()=>{reads++;return {kid:'dev-key-01',epoch:1,key:k};}});
 for(const issued_at of [time-121,time+6]){
  const e={...event(),issued_at};
  const r=await v.review({event:e,signature_hex:await sign(e,k)});
  assert.equal(r.reason,'STALE_OR_FUTURE');flags(r);
 }
 assert.equal(reads,0);
 assert.throws(()=>createOfflineR005P05CanonicalVerifier({
  scope:{...scope,environment:'production'},nowSeconds:()=>time,
  readVerificationKey:async()=>null
 }),/NON_PRODUCTION/);
});
test('key expiry, identity rotation and key replacement are denied',async()=>{
 const k=await key(),e=event(),signed={event:e,signature_hex:await sign(e,k)};
 let n=0;
 const rotated=init(k,{readVerificationKey:async()=>({kid:e.issuer_kid,epoch:++n,key:k})});
 const r=await rotated.review(signed);
 assert.equal(r.reason,'KEY_ROTATED');flags(r);
 const newKey=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(4),
  {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 const wrong=init(newKey);
 const w=await wrong.review(signed);
 assert.equal(w.reason,'SIGNATURE_INVALID');flags(w);
});
test('untrusted flags, getters, custom prototypes and extra PII rejected before key access',async()=>{
 const k=await key(),e=event(),signature_hex=await sign(e,k),v=init(k);
 for(const forged of [
  {event:{...e,signature_verified:true},signature_hex},
  {event:e,signature_hex,verified:true},
  {event:Object.assign(Object.create({admin:true}),e),signature_hex},
  {event:e,signature_hex:'F'.repeat(64)}
 ]){
  const r=await v.review(forged);
  assert.equal(r.status,'blocked');flags(r);
 }
 const attack={event:{...e},signature_hex};
 Object.defineProperty(attack.event,'actor_ref',{get(){throw Error('getter run');},enumerable:true});
 const r=await v.review(attack);
 assert.equal(r.status,'blocked');flags(r);
});
