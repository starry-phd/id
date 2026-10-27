import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createOfflineSignedBillingWitnessVerifier,canonicalBillingWitnessV1,
 BILLING_SIGNED_WITNESS_LIVE_ENABLED} from '../src/signed-billing-witness.ts';
import {calculateOfflineBillingChain,BILLING_RECOVERY_SQL,
 createOfflineBillingOutboxRecoveryFence} from '../src/recovery-outbox-fence.ts';
const NOW=1793100000,scope={brand_id:'starry',environment:'staging'};
const ref=x=>'r_'+x.repeat(64);
const signedBytes=async(x,privateKey)=>crypto.subtle.sign('RSASSA-PKCS1-v1_5',
 privateKey,canonicalBillingWitnessV1(x));
const b64url=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)))
 .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const digest=async(buf)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)),
 x=>x.toString(16).padStart(2,'0')).join('');
const evt={seq:1,event_ref:ref('a'),app_id:'starry.alpha',
 store:'apple',store_app_id:'phd.starry.alpha',offer_id:'alpha.monthly',
 kind:'monthly',event_state:'REFUNDED',source_version:7,
 store_effective_sec:NOW-40,committed_sec:NOW-20,source_digest:'d'.repeat(64)};
async function setup(x={}){
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify']);
 const spki=await crypto.subtle.exportKey('spki',pair.publicKey);
 const publicKey=await crypto.subtle.importKey('spki',spki,
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const chain=await calculateOfflineBillingChain(scope,[evt],NOW);
 const w={brand_id:'starry',environment:'staging',
  source:'independent_append_only',witness_ref:ref('e'),
  observed_at_sec:NOW,sequence:1,head_digest:chain.headDigest};
 const signed={version:1,...w,key_id:'billing-key-01',signature:''};
 const sig=await signedBytes(signed,pair.privateKey);
 const envelope={...signed,signature:b64url(sig)};
 let protectedHead={sequence:1,witness_ref:w.witness_ref,signature_sha256:await digest(sig)};
 const counters={envelope:0,head:0,protected:0};
 const backend={
  async readSignedEnvelope(){counters.envelope++;return x.envelope??envelope;},
  async readIndependentHead(){counters.head++;
   if(x.advanceAfterOne&&counters.head>=2)
    return {...protectedHead,sequence:2};
   return x.head??protectedHead;},
  async verifyProtectedHead(){counters.protected++;return x.protected!==false;},
 };
 const make=(options={})=>createOfflineSignedBillingWitnessVerifier({
  enabled:true,scope,key_id:'billing-key-01',verifyKey:publicKey,backend,...options});
 return {make,publicKey,privateKey:pair.privateKey,w,envelope,protectedHead,counters,pair};
}
test('valid real RSA2048 signature + two pinned external heads, no mutations',async()=>{
 const a=await setup();
 assert.equal(await a.make().verifyIndependentAttestation(a.w),true);
 assert.equal(a.counters.head,2);assert.equal(a.counters.protected,2);
 assert.equal(BILLING_SIGNED_WITNESS_LIVE_ENABLED,false);
});
test('disabled verifier does not read envelope/head',async()=>{
 const a=await setup();
 assert.equal(await a.make({enabled:false}).verifyIndependentAttestation(a.w),false);
 assert.deepEqual(a.counters,{envelope:0,head:0,protected:0});
});
test('signature tampering, mismatched digest, identity and wrong key id rejected',async()=>{
 const a=await setup();
 for(const change of [
  {signature:a.envelope.signature.slice(0,-1)+'A'},
  {head_digest:'b'.repeat(64)},
  {brand_id:'hglobal'}, {environment:'development'},
  {key_id:'wrong-key'},{version:2},{signature:'bad'},
 ]){
  const x=await setup({envelope:{...a.envelope,...change}});
  assert.equal(await x.make().verifyIndependentAttestation(x.w),false);
 }
});
test('wrong RSA public key, extractable key or signing key rejected',async()=>{
 const a=await setup();const b=await setup();
 assert.equal(await b.make({verifyKey:a.publicKey}).verifyIndependentAttestation(b.w),false);
 assert.throws(()=>b.make({verifyKey:b.pair.publicKey}),/BILLING_SIGNED_KEY_DENIED/);
 assert.throws(()=>b.make({verifyKey:b.privateKey}),/BILLING_SIGNED_KEY_DENIED/);
});
test('reject foreign witness and out-of-scope stores before querying envelope',async()=>{
 const a=await setup();
 for(const bad of [{brand_id:'hglobal'},{environment:'development'},
  {head_digest:'bad'}, {source:'same_db_snapshot'}]){
  assert.equal(await a.make().verifyIndependentAttestation({...a.w,...bad}),false);
 }
 assert.equal(a.counters.envelope,0);
});
test('external authenticated head cannot be forged or replayed',async()=>{
 for(const options of [{protected:false},{head:{sequence:2,witness_ref:ref('e'),
  signature_sha256:'b'.repeat(64)}},{advanceAfterOne:true}]){
  const a=await setup(options);
  assert.equal(await a.make().verifyIndependentAttestation(a.w),false);
 }
});
test('unexpected fields, accessor and malicious Proxy cannot bypass validation',async()=>{
 const a=await setup();
 for(const x of [
  {...a.envelope,extra:true},
  Object.defineProperty({...a.envelope},'signature',{get(){throw Error('getter');}}),
  new Proxy({}, {getPrototypeOf(){throw Error('revoked');}}),
 ]){
  const b=await setup({envelope:x});
  assert.equal(await b.make().verifyIndependentAttestation(b.w),false);
 }
});
test('non-canonical Base64URL padding rejected, even if RSA bytes decode',async()=>{
 const a=await setup({envelope:{...(await setup()).envelope,signature:'A'.repeat(342)+'='}});
 assert.equal(await a.make().verifyIndependentAttestation(a.w),false);
});
test('R12 signed witness composes with R11 full refund-chain and lawful review only',async t=>{
 const a=await setup();
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(readFileSync(new URL('../schema/0006_recovery_outbox_DRAFT.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO billing_recovery_outbox_DRAFT (brand_id,environment,seq,event_ref,app_id,store,store_app_id,offer_id,kind,event_state,source_version,store_effective_sec,committed_sec,source_digest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('starry','staging',evt.seq,evt.event_ref,evt.app_id,evt.store,evt.store_app_id,
   evt.offer_id,evt.kind,evt.event_state,evt.source_version,evt.store_effective_sec,
   evt.committed_sec,evt.source_digest);
 let audits=0;
 const d1={prepare(sql){
  assert.ok(Object.values(BILLING_RECOVERY_SQL).includes(sql));
  return {args:[],bind(...p){this.args=p;return this;},
   async first(){return {...db.prepare(sql).get(...this.args)};},
   async all(){return {results:db.prepare(sql).all(...this.args).map(v=>({...v}))};}};
 }};
 const fence=createOfflineBillingOutboxRecoveryFence({
  enabled:true,scope,db:d1,ports:{
   privacyAndRecoveryApprovedNow:async()=>true,
   readLegalHold:async()=> 'clear',
   readIndependentWitness:async()=>a.w,
   verifyIndependentAttestation:a.make().verifyIndependentAttestation,
   recordDurableReview:async()=>{audits++;return true;},
  },
 });
 const result=await fence.review(NOW);
 assert.equal(result.disposition,'review_only');
 assert.equal(result.billing_outbox,1);
 assert.equal(result.may_restore,false);assert.equal(audits,1);
 assert.equal(db.prepare('SELECT event_state FROM billing_recovery_outbox_DRAFT').get().event_state,'REFUNDED');
});
