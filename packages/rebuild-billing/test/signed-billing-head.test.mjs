import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {calculateOfflineBillingChain,BILLING_RECOVERY_SQL,
 createOfflineBillingOutboxRecoveryFence} from '../src/recovery-outbox-fence.ts';
import {canonicalBillingWitnessV1,
 createOfflineSignedBillingWitnessVerifier} from '../src/signed-billing-witness.ts';
import {canonicalSignedBillingHeadV1,
 createOfflineSignedBillingHeadAuthority,BILLING_SIGNED_HEAD_LIVE_ENABLED,
 BILLING_SIGNED_HEAD_RESTORE_ALLOWED} from '../src/signed-billing-head.ts';

const NOW=1793100000,scope={brand_id:'starry',environment:'staging'};
const ref=x=>'r_'+x.repeat(64);
const evt={seq:1,event_ref:ref('a'),app_id:'starry.alpha',
 store:'apple',store_app_id:'phd.starry.alpha',offer_id:'alpha.monthly',
 kind:'monthly',event_state:'REFUNDED',source_version:7,
 store_effective_sec:NOW-40,committed_sec:NOW-20,source_digest:'d'.repeat(64)};
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)))
 .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),
 n=>n.toString(16).padStart(2,'0')).join('');
async function keys(){
 const p=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify']);
 const spki=await crypto.subtle.exportKey('spki',p.publicKey);
 return {sign:p.privateKey,verify:await crypto.subtle.importKey('spki',spki,
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']),
  extractable:p.publicKey};
}
async function setup(opts={}){
 const wk=await keys(),hk=await keys();
 const chain=await calculateOfflineBillingChain(scope,[evt],NOW);
 const witness={brand_id:'starry',environment:'staging',source:'independent_append_only',
  witness_ref:ref('e'),observed_at_sec:NOW,sequence:1,head_digest:chain.headDigest};
 const witnessPayload={version:1,...witness,key_id:'billing-witness-v1',signature:''};
 const wb=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
  wk.sign,canonicalBillingWitnessV1(witnessPayload));
 const envelope={...witnessPayload,signature:b64(wb)};
 const headPayload={version:1,brand_id:'starry',environment:'staging',
  source:'protected_independent_head',sequence:1,witness_ref:witness.witness_ref,
  signature_sha256:await digest(wb),issued_at_sec:NOW-5,
  expires_at_sec:NOW+20,key_id:'billing-head-v1',signature:''};
 const hs=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',hk.sign,
  canonicalSignedBillingHeadV1(headPayload));
 const signedHead={...headPayload,signature:b64(hs)};
 const count={signedHead:0,envelope:0};
 const headAuthority=(extra={})=>createOfflineSignedBillingHeadAuthority({
  enabled:true,scope,key_id:'billing-head-v1',witnessSignerKeyId:'billing-witness-v1',
  verifyKey:hk.verify,readServerTime:()=>NOW,
  readSignedHead:async()=>{
   count.signedHead++;
   if(opts.advanceAfterFirst&&count.signedHead>=2)
    return {...signedHead,sequence:2};
   return opts.signedHead??signedHead;
  },...extra,
 });
 const full=(h=headAuthority())=>createOfflineSignedBillingWitnessVerifier({
  enabled:true,scope,key_id:'billing-witness-v1',verifyKey:wk.verify,
  backend:{
   readSignedEnvelope:async()=>{count.envelope++;return opts.envelope??envelope;},
   readIndependentHead:h.readIndependentHead,
   verifyProtectedHead:h.verifyProtectedHead,
  },
 });
 return {wk,hk,witness,envelope,signedHead,headAuthority,full,count};
}
test('two different RSA signers validate witnessed billing head end to end',async()=>{
 const s=await setup();
 assert.equal(await s.full().verifyIndependentAttestation(s.witness),true);
 assert.equal(s.count.envelope,1);
 assert.equal(s.count.signedHead,4); // 2 R12 reads, each independently verified again.
 assert.equal(BILLING_SIGNED_HEAD_LIVE_ENABLED,false);
 assert.equal(BILLING_SIGNED_HEAD_RESTORE_ALLOWED,false);
});
test('disabled protected-head cannot perform any head read',async()=>{
 const s=await setup();
 const h=s.headAuthority({enabled:false});
 assert.equal(await h.readIndependentHead('staging'),null);
 assert.equal(s.count.signedHead,0);
 assert.equal(await s.full(h).verifyIndependentAttestation(s.witness),false);
 assert.equal(s.count.signedHead,0);
});
test('two key IDs must differ and RSA key must be pinned nonextractable',async()=>{
 const s=await setup();
 assert.throws(()=>s.headAuthority({witnessSignerKeyId:'billing-head-v1'}),
  /BILLING_HEAD_CONFIG_DENIED/);
 assert.throws(()=>s.headAuthority({verifyKey:s.hk.extractable}),
  /BILLING_HEAD_KEY_DENIED/);
 assert.throws(()=>s.headAuthority({verifyKey:s.hk.sign}),
  /BILLING_HEAD_KEY_DENIED/);
});
test('wrong verifying RSA key fails even with trusted witness signer',async()=>{
 const s=await setup();
 assert.equal(await s.full(s.headAuthority({verifyKey:s.wk.verify}))
  .verifyIndependentAttestation(s.witness),false);
});
test('head tamper, foreign brand/env, signing key and unknown fields fail closed',async()=>{
 const base=await setup();
 for(const change of [
  {sequence:2}, {signature_sha256:'f'.repeat(64)},
  {witness_ref:ref('f')},{key_id:'fake-head'},
  {environment:'development'},{brand_id:'hglobal'},
  {version:2},{source:'auth_d1_snapshot'}, {signature:'invalid'},
  {issued_at_sec:NOW+1},{expires_at_sec:NOW-1},
 ]){
  const s=await setup({signedHead:{...base.signedHead,...change}});
  assert.equal(await s.full().verifyIndependentAttestation(s.witness),false);
 }
 const s=await setup({signedHead:{...base.signedHead,extra:true}});
 assert.equal(await s.full().verifyIndependentAttestation(s.witness),false);
});
test('expired, unbounded and future validly-signed heads are denied',async()=>{
 const s=await setup();
 for(const [issued,expires] of [[NOW-40,NOW-1],[NOW+1,NOW+15],
  [NOW-50,NOW+50],[NOW-10,NOW-10]]){
  // Re-sign with the SAME approved head signer: clock policies must still deny.
  const payload={...s.signedHead,issued_at_sec:issued,expires_at_sec:expires};
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',s.hk.sign,
   canonicalSignedBillingHeadV1(payload));
  const x=await setup({signedHead:{...payload,signature:b64(sig)}});
  // x has its own key; verification stays denied even without time checks.
  assert.equal(await x.full().verifyIndependentAttestation(x.witness),false);
  const y=s.headAuthority({readSignedHead:async()=>({...payload,signature:b64(sig)})});
  assert.equal(await y.readIndependentHead('staging'),null);
 }
});
test('bad head Base64URL and accessor/Proxy untrusted data denied',async()=>{
 const s=await setup();
 for(const input of [
  {...s.signedHead,signature:s.signedHead.signature+'='},
  Object.defineProperty({...s.signedHead},'sequence',{get(){throw Error('trap');}}),
  new Proxy({}, {getPrototypeOf(){throw Error('revoked');}}),
 ]){
  const h=s.headAuthority({readSignedHead:async()=>input});
  assert.equal(await h.readIndependentHead('staging'),null);
 }
});
test('replay: independently advanced signed head denies old Billing witness',async()=>{
 const s=await setup({advanceAfterFirst:true});
 assert.equal(await s.full().verifyIndependentAttestation(s.witness),false);
});
test('review-only full R13->R12->R11 Store REFUNDED chain with actual SQLite',async t=>{
 const s=await setup(),db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec(readFileSync(new URL('../schema/0006_recovery_outbox_DRAFT.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO billing_recovery_outbox_DRAFT (brand_id,environment,seq,event_ref,app_id,store,store_app_id,offer_id,kind,event_state,source_version,store_effective_sec,committed_sec,source_digest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('starry','staging',evt.seq,evt.event_ref,evt.app_id,evt.store,evt.store_app_id,
  evt.offer_id,evt.kind,evt.event_state,evt.source_version,
  evt.store_effective_sec,evt.committed_sec,evt.source_digest);
 let audit=0;
 const dbPort={prepare(sql){
  assert.ok(Object.values(BILLING_RECOVERY_SQL).includes(sql));
  return {args:[],bind(...args){this.args=args;return this;},
   async first(){return {...db.prepare(sql).get(...this.args)};},
   async all(){return {results:db.prepare(sql).all(...this.args).map(x=>({...x}))};}};
 }};
 const result=await createOfflineBillingOutboxRecoveryFence({
  enabled:true,scope,db:dbPort,ports:{
   privacyAndRecoveryApprovedNow:async()=>true,
   readLegalHold:async()=> 'clear',
   readIndependentWitness:async()=>s.witness,
   verifyIndependentAttestation:s.full().verifyIndependentAttestation,
   recordDurableReview:async()=>{audit++;return true;},
  },
 }).review(NOW);
 assert.equal(result.disposition,'review_only');
 assert.equal(result.billing_outbox,1);assert.equal(result.may_restore,false);
 assert.equal(audit,1);
 assert.equal(db.prepare('SELECT event_state FROM billing_recovery_outbox_DRAFT').get().event_state,'REFUNDED');
});
