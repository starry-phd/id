import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineSignedAuthWitnessVerifier,canonicalAuthWitnessV1,
 LIVE_SIGNED_RECOVERY_WITNESS_ENABLED} from '../src/round11-signed-recovery-witness.ts';
import {createOfflineStarryRecoveryFenceAuthority} from '../src/round10-recovery-fences.ts';
const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const counters={deleted_members:3,revoked_sessions:8,claimed_registration_gifts:2};
async function fixture(){
 const generated=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',generated.publicKey);
 const verifyKey=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const witness=Object.freeze({brand_id:'starry',environment:'staging',source:'independent_append_only',
  witness_ref:'witness-r11-0001',observed_at:now,counters:{...counters}});
 async function sign(changes={}){
  const envelope={version:1,...witness,sequence:11,key_id:'pinned-r11-key',...changes};
  const sig=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
   generated.privateKey,canonicalAuthWitnessV1(envelope)));
  const signature=Buffer.from(sig).toString('base64url');
  return {envelope:Object.freeze({...envelope,signature}),
   head:{sequence:envelope.sequence,witness_ref:envelope.witness_ref,
    signature_sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sig)),
     b=>b.toString(16).padStart(2,'0')).join('')}};
 }
 const orig=await sign();
 return {witness,orig,sign,verifyKey,generated};
}
function verifier(f,options={}){
 const reads={envelope:0,head:0};
 const backend={
  readSignedEnvelope:async()=>{reads.envelope++;if(options.throwEnvelope)throw Error('outage');
   return Object.hasOwn(options,'envelope')?options.envelope:f.orig.envelope;},
  readIndependentHead:async()=>{reads.head++;return Object.hasOwn(options,'head')?options.head:f.orig.head;},
 };
 const g=createOfflineSignedAuthWitnessVerifier({
  scope:options.scope??scope,verifyKey:options.verifyKey??f.verifyKey,
  key_id:options.key_id??'pinned-r11-key',enabled:options.enabled??true,backend,
 });
 return {g,reads};
}
test('default OFF and missing Privacy/R10 authority must never consult envelope or anchor',async()=>{
 const f=await fixture();
 assert.equal(LIVE_SIGNED_RECOVERY_WITNESS_ENABLED,false);
 const {g,reads}=verifier(f,{enabled:false});
 assert.equal(await g.verifyIndependentAttestation(f.witness),false);
 assert.equal(reads.envelope,0);assert.equal(reads.head,0);
 const active=verifier(f);
 const gate=createOfflineStarryRecoveryFenceAuthority({
  scope,enabled:true,db:{prepare(){throw Error('never read')}},privacyAndRecoveryApprovedNow:async()=>false,
  readIndependentCheckpoint:async()=>f.witness,
  verifyIndependentAttestation:active.g.verifyIndependentAttestation,
 });
 assert.equal(await gate.review(now),null);
 assert.equal(active.reads.envelope,0);
});
test('real RS256 signature + independent SHA-256 head and Auth D1 must agree, REVIEW_ONLY',async()=>{
 const f=await fixture();const x=verifier(f);
 assert.equal(await x.g.verifyIndependentAttestation(f.witness),true);
 assert.equal(x.reads.envelope,1);assert.equal(x.reads.head,1);
 const gate=createOfflineStarryRecoveryFenceAuthority({
  enabled:true,scope,privacyAndRecoveryApprovedNow:async()=>true,
  readIndependentCheckpoint:async()=>f.witness,
  verifyIndependentAttestation:x.g.verifyIndependentAttestation,
  db:{prepare(sql){assert.match(sql,/FROM starry_auth_recovery_fence/);
   return {first:async()=>({...counters})};}},
 });
 assert.deepEqual(await gate.review(now),{disposition:'review_only',may_restore:false,
  counters,checked_at:now});
});
test('tampered signature, payload and wrong pinned key fail before Auth D1',async()=>{
 const f=await fixture();
 const signatures=[
  {...f.orig.envelope,signature:'A'+f.orig.envelope.signature.slice(1)},
  {...f.orig.envelope,counters:{...counters,deleted_members:99}},
  {...f.orig.envelope,sequence:12},
  {...f.orig.envelope,environment:'production'},
  {...f.orig.envelope,witness_ref:'witness-r11-other'},
  {...f.orig.envelope,key_id:'other-pinned-key'},
  {...f.orig.envelope,signature:'not-a-signature'},
  {...f.orig.envelope,extra:'not-allowed'},
 ];
 for(const envelope of signatures){
  const x=verifier(f,{envelope});
  assert.equal(await x.g.verifyIndependentAttestation(f.witness),false);
 }
 const wrong=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const key=await crypto.subtle.importKey('jwk',
  await crypto.subtle.exportKey('jwk',wrong.publicKey),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 assert.equal(await verifier(f,{verifyKey:key}).g.verifyIndependentAttestation(f.witness),false);
});
test('independent latest anchor rejects old but valid RSA witness and other digest',async()=>{
 const f=await fixture();const newest=await f.sign({sequence:12});
 for(const head of [newest.head,{...f.orig.head,signature_sha256:'0'.repeat(64)},
  {...f.orig.head,sequence:10},{...f.orig.head,witness_ref:'different'},
  null,{...f.orig.head,signature_sha256:'x'}]){
  const x=verifier(f,{head});
  assert.equal(await x.g.verifyIndependentAttestation(f.witness),false);
 }
 assert.equal(await verifier(f,{throwEnvelope:true}).g.verifyIndependentAttestation(f.witness),false);
});
test('unknown key, extractable verify key, wrong brand and production refused',async()=>{
 const f=await fixture();
 const extractable=await crypto.subtle.importKey('jwk',
  await crypto.subtle.exportKey('jwk',f.generated.publicKey),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},true,['verify']);
 assert.throws(()=>verifier(f,{verifyKey:extractable}),/SIGNED_WITNESS_PINNED_KEY_DENIED/);
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'},
  {...scope,app_id:'invalid/app'}])
  assert.throws(()=>verifier(f,{scope:s}),/SIGNED_WITNESS_SCOPE_DENIED/);
 assert.equal(await verifier(f,{key_id:'another-key'}).g.verifyIndependentAttestation(f.witness),false);
});
test('getters, proxy and reversed independent witnesses are denied',async()=>{
 const f=await fixture();
 const obj={...f.orig.envelope};Object.defineProperty(obj,'signature',{enumerable:true,
  get(){throw Error('never run accessor')}});
 assert.equal(await verifier(f,{envelope:obj}).g.verifyIndependentAttestation(f.witness),false);
 const revoked=Proxy.revocable({...f.orig.envelope},{});revoked.revoke();
 assert.equal(await verifier(f,{envelope:revoked.proxy}).g.verifyIndependentAttestation(f.witness),false);
 const witness={...f.witness,counters:{...counters,claimed_registration_gifts:3}};
 assert.equal(await verifier(f).g.verifyIndependentAttestation(witness),false);
});
