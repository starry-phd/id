import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineSignedAuthHeadAuthority,canonicalSignedAuthHeadV1,
 LIVE_AUTH_SIGNED_HEAD_ENABLED} from '../src/round12-signed-head.ts';
import {canonicalAuthWitnessV1,createOfflineSignedAuthWitnessVerifier}
 from '../src/round11-signed-recovery-witness.ts';
import {createOfflineStarryRecoveryFenceAuthority} from '../src/round10-recovery-fences.ts';
const now=1793000000,scope={brand_id:'starry',environment:'staging',app_id:'starry-id'};
const counters={deleted_members:3,revoked_sessions:8,claimed_registration_gifts:2};
async function rsa(){
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pub=await crypto.subtle.importKey('jwk',await crypto.subtle.exportKey('jwk',pair.publicKey),
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 return {pair,pub};
}
async function f(){
 const headKey=await rsa(),witnessKey=await rsa();
 const witness={brand_id:'starry',environment:'staging',source:'independent_append_only',
  witness_ref:'independent-auth-r12',observed_at:now,counters};
 const witnessPayload={version:1,...witness,sequence:17,key_id:'witness-key-r11'};
 const witnessSig=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
  witnessKey.pair.privateKey,canonicalAuthWitnessV1(witnessPayload)));
 const witnessEnvelope={...witnessPayload,signature:Buffer.from(witnessSig).toString('base64url')};
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  Uint8Array.from(witnessSig).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
 const payload={version:1,brand_id:'starry',environment:'staging',
  source:'protected_independent_head',sequence:17,
  witness_ref:witness.witness_ref,signature_sha256:digest,
  issued_at:now-4,expires_at:now+24,key_id:'separate-head-key-r12'};
 async function signedHead(value=payload,privateKey=headKey.pair.privateKey){
  return {...value,signature:Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    privateKey,canonicalSignedAuthHeadV1(value))).toString('base64url')};
 }
 return {headKey,witnessKey,witness,witnessEnvelope,payload,signedHead,
  envelope:await signedHead()};
}
function gate(fixture,opts={}){
 const hits={head:0,time:0};
 const a=createOfflineSignedAuthHeadAuthority({
  scope:opts.scope??scope,key_id:opts.key_id??'separate-head-key-r12',
  witnessSignerKeyId:opts.witnessSignerKeyId??'witness-key-r11',
  verifyKey:opts.key??fixture.headKey.pub,enabled:opts.enabled??true,
  readSignedHead:async()=>{hits.head++;if(opts.fail)throw Error('external head unavailable');
   return Object.hasOwn(opts,'envelope')?opts.envelope:fixture.envelope;},
  readServerTime:()=>{hits.time++;return Object.hasOwn(opts,'now')?opts.now:now;},
 });
 return {a,hits};
}
test('default-off, wrong scope and wrong environment do not read external head',async()=>{
 const fx=await f();
 assert.equal(LIVE_AUTH_SIGNED_HEAD_ENABLED,false);
 const disabled=gate(fx,{enabled:false});
 assert.equal(await disabled.a.readIndependentHead('staging'),null);
 assert.equal(disabled.hits.head,0);
 const x=gate(fx);
 assert.equal(await x.a.readIndependentHead('development'),null);
 assert.equal(x.hits.head,0);
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'},
  {...scope,app_id:'not/allowed'}])
   assert.throws(()=>gate(fx,{scope:s}),/SIGNED_HEAD_SCOPE_DENIED/);
});
test('true 2-signature end-to-end R12 signed head → R11 witness → R10 local auth fences: review_only',async()=>{
 const fx=await f(),h=gate(fx);
 const r11=createOfflineSignedAuthWitnessVerifier({
  scope,enabled:true,key_id:'witness-key-r11',verifyKey:fx.witnessKey.pub,
  backend:{
   readSignedEnvelope:async()=>fx.witnessEnvelope,
   readIndependentHead:h.a.readIndependentHead,
  },
 });
 assert.deepEqual(await h.a.readIndependentHead('staging'),{
  sequence:17,witness_ref:fx.witness.witness_ref,
  signature_sha256:fx.payload.signature_sha256});
 assert.equal(await r11.verifyIndependentAttestation(fx.witness),true);
 const r10=createOfflineStarryRecoveryFenceAuthority({
  scope,enabled:true,privacyAndRecoveryApprovedNow:async()=>true,
  readIndependentCheckpoint:async()=>fx.witness,
  verifyIndependentAttestation:r11.verifyIndependentAttestation,
  db:{prepare(sql){assert.match(sql,/FROM starry_auth_recovery_fence/);
   return {first:async()=>({...counters})};}},
 });
 assert.deepEqual(await r10.review(now),{disposition:'review_only',
  may_restore:false,counters,checked_at:now});
});
test('separate head signer cannot be replaced by valid witness key; tampered signed contents fail',async()=>{
 const fx=await f();
 const signedByWrongKey=await fx.signedHead(fx.payload,fx.witnessKey.pair.privateKey);
 const cases=[
  {...fx.envelope,sequence:18},
  {...fx.envelope,signature_sha256:'f'.repeat(64)},
  {...fx.envelope,witness_ref:'other-head'},
  {...fx.envelope,key_id:'other'},
  {...fx.envelope,brand_id:'hglobal'},
  {...fx.envelope,environment:'development'},
  {...fx.envelope,source:'d1_pitr'},
  {...fx.envelope,extra:true},
  {...fx.envelope,signature:'abc'},
  signedByWrongKey,
 ];
 for(const envelope of cases){
  const a=gate(fx,{envelope});
  assert.equal(await a.a.readIndependentHead('staging'),null);
 }
 const other=await rsa();
 assert.equal(await gate(fx,{key:other.pub}).a.readIndependentHead('staging'),null);
});
test('future/stale signed head, forged clock, wrong independent key IDs and outages reject',async()=>{
 const fx=await f();
 for(const config of [{now:now+25},{now:now-5},{now:-1},{now:NaN},
  {envelope:{...fx.envelope,issued_at:now+5}},
  {envelope:{...fx.envelope,expires_at:now+120}},
  {envelope:{...fx.envelope,sequence:0}},{fail:true}]){
  assert.equal(await gate(fx,config).a.readIndependentHead('staging'),null);
 }
 assert.throws(()=>gate(fx,{witnessSignerKeyId:'separate-head-key-r12'}),
  /SIGNED_HEAD_KEY_SEPARATION_DENIED/);
 const exported=await crypto.subtle.importKey('jwk',
  await crypto.subtle.exportKey('jwk',fx.headKey.pair.publicKey),
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},true,['verify']);
 assert.throws(()=>gate(fx,{key:exported}),/SIGNED_HEAD_KEY_DENIED/);
});
test('accessor, revoked Proxy and malformed Base64URL fail without running untrusted getter',async()=>{
 const fx=await f();
 const poison={...fx.envelope};
 Object.defineProperty(poison,'sequence',{enumerable:true,get(){throw Error('poison')}}); 
 assert.equal(await gate(fx,{envelope:poison}).a.readIndependentHead('staging'),null);
 const revoked=Proxy.revocable({...fx.envelope},{});revoked.revoke();
 assert.equal(await gate(fx,{envelope:revoked.proxy}).a.readIndependentHead('staging'),null);
 const padded={...fx.envelope,signature:fx.envelope.signature+'='};
 assert.equal(await gate(fx,{envelope:padded}).a.readIndependentHead('staging'),null);
});
test('R11 still refuses a valid old witness when R12 signed head moves ahead',async()=>{
 const fx=await f();
 const head=await fx.signedHead({...fx.payload,sequence:18});
 const h=gate(fx,{envelope:head});
 const r11=createOfflineSignedAuthWitnessVerifier({
  scope,enabled:true,key_id:'witness-key-r11',verifyKey:fx.witnessKey.pub,
  backend:{readSignedEnvelope:async()=>fx.witnessEnvelope,readIndependentHead:h.a.readIndependentHead},
 });
 assert.equal(await r11.verifyIndependentAttestation(fx.witness),false);
});
