import test from 'node:test';
import assert from 'node:assert/strict';
import {AI0_R006_P05_VERSION,AI0_R006_P05_PURPOSE,AI0_R006_HMAC_DOMAIN,
 AI0_R006_FIELDS,AI0_R006_LIVE,r006CanonicalBytes,createOfflineR006P05Verifier}
 from '../src/ai0-r006-p05-canonical-proposal.ts';
import {AI0_R005_P05_VERSION} from '../src/ai0-r005-p05-canonical-offline-verifier.ts';
import {R005_ENVELOPE_AUTH_VERSION} from '../../../modules/starry-id-v1/src/wave1-round005-sealed-event-session-authority.ts';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const now=1793200000;
const e=()=>({
 version:AI0_R006_P05_VERSION,purpose:AI0_R006_P05_PURPOSE,
 ...scope,event_id:'event_123456789',event_type:'notification.delivery.queued',
 actor_ref:'actor_123456789',auth_version:3,session_version:2,
 idempotency_key:'idem_123456789',issuer_kid:'r006-offline-01',issuer_epoch:1,
 issued_at:now,expires_at:now+50,nonce:'nonce_ABCDEFGHIJKLMNOP',
 payload_sha256:'a'.repeat(64)
});
const fixture=async()=>{
 const raw=new Uint8Array(32).fill(12);
 const sign=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const verify=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return {sign,verify};
};
const mac=async(ev,key)=>{
 const bytes=r006CanonicalBytes(ev);
 assert.ok(bytes);
 const signature=await crypto.subtle.sign('HMAC',key,bytes);
 return [...new Uint8Array(signature)].map(b=>b.toString(16).padStart(2,'0')).join('');
};
const engine=(verify,extra={})=>createOfflineR006P05Verifier({
 enabled:true,scope,nowSeconds:()=>now,
 readCurrentVerificationKey:async()=>({kid:e().issuer_kid,epoch:1,key:verify}),
 ...extra
});
const deny=r=>{
 for(const k of ['verified_live','may_authorize_actor','may_grant','may_read_d1',
  'may_write_d1','may_send','may_enqueue','may_ack_queue',
  'may_create_notification','may_publish','may_charge','may_request_ads','live'])
  assert.equal(r[k],false,k);
};
test('R006 canonical vNext has immutable exact 17 keys and no Live authority',()=>{
 assert.equal(AI0_R006_FIELDS.length,17);
 assert.equal(Object.isFrozen(AI0_R006_FIELDS),true);
 assert.equal(AI0_R006_LIVE,false);
 assert.equal(AI0_R006_HMAC_DOMAIN,'starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1');
 assert.notEqual(AI0_R006_P05_VERSION,AI0_R005_P05_VERSION);
 assert.notEqual(AI0_R006_P05_VERSION,R005_ENVELOPE_AUTH_VERSION);
 assert.ok(r006CanonicalBytes(e()) instanceof ArrayBuffer);
});
test('R006 valid synthetic HMAC is review_only: never grants P05/Queue/Store',async()=>{
 const {sign,verify}=await fixture(),event=e();
 const r=await engine(verify).review({envelope:event,mac_hex:await mac(event,sign)});
 assert.equal(r.status,'review_only');
 assert.equal(r.reason,'CRYPTO_ONLY_NOT_AUTHORITY');
 assert.equal(r.cryptographic_candidate_match,true);deny(r);
});
test('R006 rejects both old AI0 and AI1 P05 dialects without any key read',async()=>{
 const {verify}=await fixture();let called=0;
 const v=engine(verify,{readCurrentVerificationKey:async()=>{called++;return null;}});
 for(const wrong of [
  {event:{...e(),version:AI0_R005_P05_VERSION},signature_hex:'a'.repeat(64)},
  {envelope:{...e(),version:R005_ENVELOPE_AUTH_VERSION},mac:'a'.repeat(64)},
  {envelope:e(),mac:'a'.repeat(64)},
  {envelope:{...e(),signature_verified:true},mac_hex:'a'.repeat(64)},
  {envelope:{...e(),password:'SECRET'},mac_hex:'a'.repeat(64)}
 ]){
  const r=await v.review(wrong);assert.equal(r.status,'blocked');deny(r);
 }
 assert.equal(called,0);
});
test('R006 cryptographically rejects wrong actor, session, KID, app, nonce, payload, purpose and event',async()=>{
 const {sign,verify}=await fixture(),event=e();
 const sameMac=await mac(event,sign);const v=engine(verify);
 for(const changes of [
  {actor_ref:'actor_999999999'},{session_version:3},
  {auth_version:4},{issuer_epoch:2},{issuer_kid:'other-key-01'},
  {app_id:'starry-other'},{environment:'development'},
  {nonce:'another_NONCE_1234'},{payload_sha256:'b'.repeat(64)},
  {purpose:'not_a_p05'},{event_type:'identity.member.deleted'},
  {idempotency_key:'idem_new_123456'}
 ]){
  const r=await v.review({envelope:{...event,...changes},mac_hex:sameMac});
  assert.equal(r.status,'blocked');deny(r);
 }
});
test('R006 expired/future events, stale keys and production never authorize',async()=>{
 const {sign,verify}=await fixture(),event=e(),v=engine(verify);
 for(const changes of [{issued_at:now-121,expires_at:now-1},
  {issued_at:now+6,expires_at:now+40},{issued_at:now,expires_at:now+121}]){
  const ev={...event,...changes};const r=await v.review({envelope:ev,mac_hex:await mac(ev,sign)});
  assert.equal(r.status,'blocked');deny(r);
 }
 assert.throws(()=>createOfflineR006P05Verifier({
  enabled:true,scope:{...scope,environment:'production'},nowSeconds:()=>now,
  readCurrentVerificationKey:async()=>null
 }),/OFFLINE/);
});
test('R006 denies key rotation, replay and capacity; invalid MAC cannot poison event',async()=>{
 const {sign,verify}=await fixture(),event=e(),sig=await mac(event,sign);
 let count=0;
 const rotated=engine(verify,{readCurrentVerificationKey:async()=>({kid:event.issuer_kid,epoch:++count,key:verify})});
 const r=await rotated.review({envelope:event,mac_hex:sig});
 assert.equal(r.status,'blocked');deny(r);
 const v=engine(verify);
 const fake=await v.review({envelope:event,mac_hex:'0'.repeat(64)});
 assert.equal(fake.status,'blocked');deny(fake);
 const first=await v.review({envelope:event,mac_hex:sig});
 assert.equal(first.status,'review_only');deny(first);
 const second=await v.review({envelope:event,mac_hex:sig});
 assert.equal(second.reason,'REPLAY_OR_CAPACITY_DENIED');deny(second);
});
test('R006 rejects getters, prototypes and client booleans before verification',async()=>{
 const {verify}=await fixture(),v=engine(verify);
 const ev=e();
 Object.defineProperty(ev,'actor_ref',{enumerable:true,get(){throw Error('getter triggered');}});
 for(const input of [
  {envelope:ev,mac_hex:'a'.repeat(64)},
  {envelope:Object.assign(Object.create({root:true}),e()),mac_hex:'a'.repeat(64)},
  {envelope:e(),mac_hex:'A'.repeat(64),verified:true},
 ]){
  const r=await v.review(input);assert.equal(r.status,'blocked');deny(r);
 }
});
