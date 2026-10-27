import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {canonicalAuditWitnessBytes,computeAuditChain} from '../src/signed-audit-recovery.ts';
import {LIVE_DUAL_SIGNED_AUDIT_HEAD_ENABLED,AUDIT_HEAD_MAY_RESTORE,
 canonicalSignedAuditHeadV1,createOfflineDualSignedAuditReview}
 from '../src/signed-audit-head.ts';

const crypto=webcrypto;
const at=10050,scope={brand_id:'starry',environment:'staging'};
const event={seq:1,event_ref:'a_'+'a'.repeat(64),classification:'important_management',
 event_code:'ADMIN_ACTION',occurred_ms:9000,source_revision:1,
 resource_ref:'ref_'+'b'.repeat(32),decision_code:'ADMIN_APPROVED'};
const alg={name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
 publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'};
async function keyPair(){
 const k=await crypto.subtle.generateKey(alg,false,['sign','verify']);
 const publicKey=await crypto.subtle.importKey('spki',
  await crypto.subtle.exportKey('spki',k.publicKey),
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 return {publicKey,privateKey:k.privateKey};
}
const witnessKeys=await keyPair(),headKeys=await keyPair();
const sha=async buf=>Buffer.from(await crypto.subtle.digest('SHA-256',buf)).toString('hex');
const b64=b=>Buffer.from(b).toString('base64url');
async function makeWitness(){
 const digest=(await computeAuditChain(scope,[event],at)).head_digest;
 const w={schema:1,brand_id:'starry',environment:'staging',source:'independent_append_only',
  witness_ref:'witness_1',sequence:1,observed_ms:10000,head_digest:digest,
  key_id:'audit_witness_key_1',signature:''};
 const signed=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
  witnessKeys.privateKey,canonicalAuditWitnessBytes(w));
 w.signature=b64(signed);
 return {w,signature_hash:await sha(signed)};
}
async function makeHead(witnessSignatureHash,patch={}){
 const h={version:1,brand_id:'starry',environment:'staging',
  source:'protected_independent_audit_head',sequence:1,
  witness_ref:'witness_1',signature_sha256:witnessSignatureHash,epoch:5,
  issued_ms:10040,expires_ms:10070,key_id:'audit_head_key_1',signature:'',
  ...patch};
 const signed=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',headKeys.privateKey,
  canonicalSignedAuditHeadV1(h));
 h.signature=b64(signed);
 const floor={environment:'staging',source:'independent_nonrollbackable_floor',
  sequence:h.sequence,epoch:h.epoch,witness_ref:h.witness_ref,
  head_signature_sha256:await sha(signed),observed_ms:10045};
 return {h,floor};
}
const clone=x=>structuredClone(x);
async function fixture(patch={}){
 const {w,signature_hash}=await makeWitness();
 const {h,floor}=await makeHead(signature_hash);
 const state={w,h,floor,events:[clone(event)],count:1,
  headReads:0,floorReads:0,receipts:0,dbReads:0,witnessReads:0,
  ...patch};
 const db={prepare(_sql){
  state.dbReads++;
  return {bind(){return {
   async first(){return {total:state.count}},
   async all(){return {results:state.events}}
  }}};
 }};
 const audit={
  async privacyApprovedNow(){return true},
  async legalHoldNow(){return 'clear'},
  async readSignedWitness(){state.witnessReads++;return state.w},
  async readIndependentHead(){throw Error('R12 head MUST be overridden')},
  async recordDurableReview(){state.receipts++;return true},
  ...patch.audit
 };
 const heads={
  async readSignedHead(){state.headReads++;return state.h},
  async readProtectedFloor(){state.floorReads++;return state.floor},
  ...patch.heads
 };
 const build=(override={})=>createOfflineDualSignedAuditReview({
  enabled:true,scope,witness_key_id:'audit_witness_key_1',head_key_id:'audit_head_key_1',
  witnessVerifyKey:witnessKeys.publicKey,headVerifyKey:headKeys.publicKey,
  ports:{db,audit,head:heads},...override
 });
 return {state,build,makeChangedHead:async attrs=>makeHead(signature_hash,attrs)};
}
test('R13 exact real two independent RSA signatures + current external floor => review only',async()=>{
 assert.equal(LIVE_DUAL_SIGNED_AUDIT_HEAD_ENABLED,false);
 assert.equal(AUDIT_HEAD_MAY_RESTORE,false);
 const f=await fixture();
 const r=await f.build().review(at);
 assert.equal(r.disposition,'review_only');assert.equal(r.may_restore,false);
 assert.equal(r.audit_events,1);assert.equal(f.state.headReads,2);
 assert.equal(f.state.floorReads,2);assert.equal(f.state.receipts,1);
});
test('R13 R12 privacy and legal authority must pass before Head/DB access',async()=>{
 for(const audited of [{privacyApprovedNow:async()=>false},
  {legalHoldNow:async()=> 'held'}]){
  const f=await fixture({audit:audited});
  assert.equal((await f.build().review(at)).disposition,'blocked');
  assert.equal(f.state.headReads,0);assert.equal(f.state.dbReads,0);
 }
});
test('R13 missing protected floor, rollback epoch, forged latest signature hash fail',async()=>{
 for(const change of [
  {epoch:4},{sequence:2},{head_signature_sha256:'f'.repeat(64)},
  {environment:'development'},{observed_ms:0}
 ]){
  const f=await fixture();
  f.state.floor={...f.state.floor,...change};
  const r=await f.build().review(at);
  assert.equal(r.disposition,'blocked');
  assert.equal(f.state.receipts,0);
 }
});
test('R13 valid old signed Head plus advanced latest independent floor must block',async()=>{
 const f=await fixture();
 f.state.floor={...f.state.floor,sequence:2,epoch:6};
 assert.equal((await f.build().review(at)).reason,'MONOTONE_HEAD_REPLAY');
 assert.equal(f.state.receipts,0);
});
test('R13 tampered first Head, unrelated RSA signer, malformed signature rejected',async()=>{
 const f=await fixture();f.state.h={...f.state.h,epoch:999};
 assert.equal((await f.build().review(at)).disposition,'blocked');
 const g=await fixture();const unrelated=await keyPair();
 assert.equal((await g.build({headVerifyKey:unrelated.publicKey}).review(at)).disposition,'blocked');
 const m=await fixture();m.state.h={...m.state.h,signature:'----'};
 assert.equal((await m.build().review(at)).disposition,'blocked');
});
test('R13 brand/env, wrong signer id, expired/future head are denied',async()=>{
 for(const patch of [{brand_id:'hglobal'},{environment:'development'},
  {issued_ms:10051,expires_ms:10069},{issued_ms:10000,expires_ms:10031},
  {source:'d1_pitr'}]){
  const f=await fixture();
  const signed=await f.makeChangedHead(patch);
  f.state.h=signed.h;f.state.floor=signed.floor;
  assert.equal((await f.build().review(at)).disposition,'blocked');
 }
});
test('R13 HEAD changes during review and floor changes before receipt: no ACK',async()=>{
 const f=await fixture();
 const newest=await f.makeChangedHead({epoch:6});
 f.state.h=clone(f.state.h);
 const first=clone(f.state.h),firstFloor=clone(f.state.floor);
 const r=await f.build({ports:{db:{prepare(){return {bind(){return {
  first:async()=>({total:1}),all:async()=>({results:[clone(event)]})
 }}}}},audit:{
  privacyApprovedNow:async()=>true,legalHoldNow:async()=> 'clear',
  readSignedWitness:async()=>f.state.w,
  readIndependentHead:async()=>null,
  recordDurableReview:async()=>{f.state.receipts++;return true;}
 },head:{
  readSignedHead:async()=>{f.state.headReads++;return f.state.headReads===1?first:newest.h},
  readProtectedFloor:async()=>{f.state.floorReads++;return f.state.floorReads===1?firstFloor:newest.floor}
 }}}).review(at);
 assert.equal(r.disposition,'blocked');assert.equal(f.state.receipts,0);
});
test('R13 getter, hidden field and revoked Proxy never enter the signed gate',async()=>{
 const getter=clone((await fixture()).state.h);
 Object.defineProperty(getter,'epoch',{enumerable:true,get(){throw Error('HIDDEN_ACCESS')}});
 const hidden=clone((await fixture()).state.floor);
 Object.defineProperty(hidden,'token',{value:'secret',enumerable:false});
 const revoked=Proxy.revocable(clone((await fixture()).state.h),{});revoked.revoke();
 for(const key of ['getter','hidden','revoked']){
  const f=await fixture();
  if(key==='getter')f.state.h=getter;
  if(key==='hidden')f.state.floor=hidden;
  if(key==='revoked')f.state.h=revoked.proxy;
  assert.equal((await f.build().review(at)).disposition,'blocked');
 }
});
test('R13 disabled defaults, absent head source, review evidence failure denied',async()=>{
 const f=await fixture();
 assert.equal((await f.build({enabled:false}).review(at)).reason,'DISABLED');
 assert.equal(f.state.headReads,0);
 const g=await fixture({heads:{readSignedHead:async()=>{throw Error('DOWN')}}});
 assert.equal((await g.build().review(at)).disposition,'blocked');
 const h=await fixture({audit:{recordDurableReview:async()=>false}});
 assert.equal((await h.build().review(at)).reason,'REVIEW_EVIDENCE_NOT_DURABLE');
});
test('R13 weak RSA, exportable pinned key or signer alias rejected at construction',async()=>{
 const f=await fixture();
 assert.throws(()=>f.build({head_key_id:'audit_witness_key_1'}),/SEPARATE_KEYS/);
 assert.throws(()=>f.build({headVerifyKey:witnessKeys.publicKey}),/SEPARATE_KEYS|HEAD_KEY/);
 const weak=await crypto.subtle.generateKey({...alg,modulusLength:1024},false,['sign','verify']);
 const weakPublic=await crypto.subtle.importKey('spki',
  await crypto.subtle.exportKey('spki',weak.publicKey),
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 assert.throws(()=>f.build({headVerifyKey:weakPublic}),/HEAD_KEY/);
 const exportable=await crypto.subtle.generateKey(alg,true,['sign','verify']);
 assert.throws(()=>f.build({headVerifyKey:exportable.publicKey}),/HEAD_KEY/);
});
test('R13 replayed signed pair cannot be assumed durable without trustworthy floor',async()=>{
 const f=await fixture();
 const badFloor={...f.state.floor,head_signature_sha256:'0'.repeat(64)};
 f.state.floor=badFloor;
 assert.equal((await f.build().review(at)).disposition,'blocked');
 assert.equal(f.state.receipts,0);
});
