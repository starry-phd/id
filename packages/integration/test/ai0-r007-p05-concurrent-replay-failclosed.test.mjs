import test from 'node:test';
import assert from 'node:assert/strict';
import {AI0_R006_P05_VERSION,AI0_R006_P05_PURPOSE,r006CanonicalBytes,
 createOfflineR006P05Verifier} from '../src/ai0-r006-p05-canonical-proposal.ts';

const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const now=1793200000;
const event=()=>({
 version:AI0_R006_P05_VERSION,purpose:AI0_R006_P05_PURPOSE,
 ...scope,event_id:'event_r007_123456789',event_type:'notification.delivery.queued',
 actor_ref:'actor_r007_123456789',auth_version:3,session_version:0,
 idempotency_key:'idem_r007_123456789',issuer_kid:'r007-offline-01',
 issuer_epoch:1,issued_at:now,expires_at:now+40,
 nonce:'nonce_ABCDEFGHIJKLMNOP',payload_sha256:'a'.repeat(64)
});
const signedFixture=async()=>{
 const material=new Uint8Array(32).fill(27);
 const sign=await crypto.subtle.importKey('raw',material,
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const verify=await crypto.subtle.importKey('raw',material,
  {name:'HMAC',hash:'SHA-256'},false,['verify']);
 const e=event();
 const bytes=r006CanonicalBytes(e);
 assert.ok(bytes);
 const mac_hex=Buffer.from(await crypto.subtle.sign('HMAC',sign,bytes)).toString('hex');
 return {signed:{envelope:e,mac_hex},verify};
};
const allDenied=r=>{
 for(const k of ['verified_live','may_authorize_actor','may_grant','may_read_d1',
  'may_write_d1','may_send','may_enqueue','may_ack_queue',
  'may_create_notification','may_publish','may_charge','may_request_ads','live'])
  assert.equal(r[k],false,k);
};
const verifier=(key,readCurrentVerificationKey=async()=>({
 kid:event().issuer_kid,epoch:1,key
}))=>createOfflineR006P05Verifier({
 enabled:true,scope,nowSeconds:()=>now,readCurrentVerificationKey
});

test('R007 identical concurrent signed P05 cannot both pass local review-only replay',async()=>{
 const {signed,verify}=await signedFixture();
 let releaseFirst,signalFirst;
 const firstEntered=new Promise(resolve=>{signalFirst=resolve;});
 const firstHeld=new Promise(resolve=>{releaseFirst=resolve;});
 let keyReads=0;
 const v=verifier(verify,async()=>{
  keyReads++;
  if(keyReads===1){signalFirst();await firstHeld;}
  return {kid:signed.envelope.issuer_kid,epoch:1,key:verify};
 });
 const first=v.review(signed);
 await firstEntered;
 const simultaneous=await v.review(signed);
 releaseFirst();
 const original=await first;
 assert.equal(simultaneous.status,'blocked');
 assert.equal(simultaneous.reason,'REPLAY_OR_CAPACITY_DENIED');
 assert.equal(original.status,'review_only');
 assert.equal(original.reason,'CRYPTO_ONLY_NOT_AUTHORITY');
 assert.equal(keyReads,2,'first review only should read issuer lease before/after');
 allDenied(simultaneous);allDenied(original);
 const replay=await v.review(signed);
 assert.equal(replay.reason,'REPLAY_OR_CAPACITY_DENIED');allDenied(replay);
});

test('R007 failed MAC releases pending slot and valid subsequent fixture remains review-only',async()=>{
 const {signed,verify}=await signedFixture();
 const v=verifier(verify);
 const forged=await v.review({...signed,mac_hex:'0'.repeat(64)});
 assert.equal(forged.status,'blocked');allDenied(forged);
 const good=await v.review(signed);
 assert.equal(good.status,'review_only');allDenied(good);
});

test('R007 failed issuer read releases reservation; a following synthetic verification is permitted',async()=>{
 const {signed,verify}=await signedFixture();
 let available=false;
 const v=verifier(verify,async()=>available?
  {kid:signed.envelope.issuer_kid,epoch:1,key:verify}:null);
 const missing=await v.review(signed);
 assert.equal(missing.status,'blocked');
 assert.equal(missing.reason,'KEY_UNAVAILABLE');allDenied(missing);
 available=true;
 const good=await v.review(signed);
 assert.equal(good.status,'review_only');allDenied(good);
});

test('R007 local inFlight guard cannot grant Queue ACK, live D1, Store or release authority',async()=>{
 const {signed,verify}=await signedFixture();
 const v=verifier(verify);
 const r=await v.review(signed);
 assert.equal(r.status,'review_only');
 assert.equal(r.cryptographic_candidate_match,true);
 allDenied(r);
});
