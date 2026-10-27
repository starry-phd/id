import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {AUDIT_RESTORE_ALLOWED,LIVE_SIGNED_AUDIT_RECOVERY_ENABLED,
 canonicalAuditWitnessBytes,computeAuditChain,createOfflineSignedAuditRecovery}
 from '../src/signed-audit-recovery.ts';
const crypto=webcrypto;
const scope={brand_id:'starry',environment:'staging'};
const at=10050;
const event={seq:1,event_ref:'a_'+'a'.repeat(64),classification:'important_management',
 event_code:'ADMIN_ACTION',occurred_ms:9000,source_revision:1,
 resource_ref:'ref_'+'b'.repeat(32),decision_code:'ADMIN_APPROVED'};
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
 publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
const verifier=await crypto.subtle.importKey('spki',
 await crypto.subtle.exportKey('spki',keys.publicKey),
 {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
const privateKey=keys.privateKey;
const asB64=bytes=>Buffer.from(bytes).toString('base64url');
const hex=async x=>Buffer.from(await crypto.subtle.digest('SHA-256',x)).toString('hex');
async function evidence(records=[event],patch={}){
 const chain=await computeAuditChain(scope,records,at);
 const body={schema:1,brand_id:'starry',environment:'staging',
  source:'independent_append_only',witness_ref:'witness_1',sequence:records.length,
  observed_ms:10000,head_digest:chain.head_digest,key_id:'audit_key_1',signature:''};
 const w={...body,...patch};
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,
  canonicalAuditWitnessBytes(w));
 w.signature=asB64(sig);
 const head={sequence:w.sequence,witness_ref:w.witness_ref,signature_sha256:await hex(sig)};
 return {w,head};
}
const fresh=x=>structuredClone(x);
async function fixture(overrides={}){
 const {w,head}=await evidence();
 let readCounts=0,privacyCalls=0,dbCalls=0,signCalls=0;
 const source={events:[fresh(event)],count:1,head,w,...overrides};
 const db={prepare(sql){dbCalls++;return {bind(){return {
  async first(){readCounts++;return {total:typeof source.count==='function'?
   source.count(readCounts):source.count}},
  async all(){return {results:source.events}},
  }};}}};
 const ports={
  async privacyApprovedNow(){privacyCalls++;return true},
  async legalHoldNow(){return 'clear'},
  async readSignedWitness(){signCalls++;return source.w},
  async readIndependentHead(){return source.head},
  async recordDurableReview(){return true},
  ...source.portOverrides
 };
 const builder=(extra={})=>createOfflineSignedAuditRecovery({
  enabled:true,scope,key_id:'audit_key_1',verifyKey:verifier,db,ports,...extra});
 return {source,builder,counts:()=>({readCounts,privacyCalls,dbCalls,signCalls})};
}
test('R12 live recovery disabled, real RS256 signature + event chain passes review only',async()=>{
 assert.equal(AUDIT_RESTORE_ALLOWED,false);
 assert.equal(LIVE_SIGNED_AUDIT_RECOVERY_ENABLED,false);
 const f=await fixture();const d=await f.builder().review(at);
 assert.equal(d.disposition,'review_only');assert.equal(d.may_restore,false);
 assert.equal(d.audit_events,1);assert.match(d.head_digest,/^[a-f0-9]{64}$/);
});
test('R12 denied privacy exits before witness or DB access',async()=>{
 const f=await fixture({portOverrides:{privacyApprovedNow:async()=>false}});
 assert.equal((await f.builder().review(at)).reason,'PRIVACY_DENIED');
 assert.equal(f.counts().signCalls,0);assert.equal(f.counts().dbCalls,0);
});
test('R12 legal hold or unknown law blocks before witness and DB access',async()=>{
 for(const mode of ['held','unknown']){
  const f=await fixture({portOverrides:{legalHoldNow:async()=>mode}});
  assert.equal((await f.builder().review(at)).reason,'LEGAL_HOLD_OR_UNKNOWN');
  assert.equal(f.counts().dbCalls,0);
 }
});
test('R12 stale witness, wrong environment and wrong scope fail-close',async()=>{
 const f=await fixture();
 assert.equal((await f.builder().review(at+30001)).reason,'SIGNED_WITNESS_UNAVAILABLE');
 assert.throws(()=>f.builder({scope:{...scope,brand_id:'hglobal'}}),/CONFIG_DENIED/);
 assert.throws(()=>f.builder({scope:{...scope,environment:'production'}}),/CONFIG_DENIED/);
 const old=await evidence([event],{environment:'development'});
 assert.equal((await (await fixture({w:old.w,head:old.head})).builder().review(at)).disposition,'blocked');
});
test('R12 real crypto rejects forged witness and unrelated signing key',async()=>{
 const f=await fixture();f.source.w={...f.source.w,head_digest:'f'.repeat(64)};
 assert.equal((await f.builder().review(at)).reason,'INVALID_RS256_SIGNATURE');
 const other=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
 const unrelated=await crypto.subtle.importKey('spki',await crypto.subtle.exportKey('spki',other.publicKey),
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const stillSigned=await fixture();
 assert.equal((await stillSigned.builder({verifyKey:unrelated}).review(at)).reason,'INVALID_RS256_SIGNATURE');
});
test('R12 stale valid signature blocked by independent monotone head',async()=>{
 const f=await fixture();f.source.head={...f.source.head,sequence:2};
 assert.equal((await f.builder().review(at)).reason,'MONOTONE_HEAD_REPLAY');
 const g=await fixture();g.source.head={...g.source.head,signature_sha256:'f'.repeat(64)};
 assert.equal((await g.builder().review(at)).reason,'MONOTONE_HEAD_REPLAY');
});
test('R12 same row count but modified code/classification/resource/time fails digest',async()=>{
 for(const change of [{decision_code:'ADMIN_DENIED'},{classification:'ordinary'},
  {resource_ref:'ref_'+'c'.repeat(32)},{occurred_ms:9001}]){
  const f=await fixture({events:[{...event,...change}]});
  assert.equal((await f.builder().review(at)).reason,'SIGNED_AUDIT_CHAIN_DRIFT');
 }
});
test('R12 duplicate refs, gap, invalid PII and incomplete page blocked',async()=>{
 for(const changes of [
  {events:[]},{count:2,events:[event]},{events:[{...event,seq:2}]},
  {events:[{...event,resource_ref:'user@example.com'}]},
  {events:[{...event,extra:true}]},{events:[{...event,occurred_ms:at+5}]}
 ]){
  const f=await fixture(changes);
  assert.equal((await f.builder().review(at)).disposition,'blocked');
 }
});
test('R12 getter hidden PII and revoked Proxy fail closed',async()=>{
 const getter=fresh(event);Object.defineProperty(getter,'event_code',
  {enumerable:true,get(){throw Error('INTRUSION')}});
 const hidden=fresh(event);Object.defineProperty(hidden,'token',{value:'secret',enumerable:false});
 const revoked=Proxy.revocable(fresh(event),{});revoked.revoke();
 for(const bad of [getter,hidden,revoked.proxy]){
  const f=await fixture({events:[bad]});
  assert.equal((await f.builder().review(at)).disposition,'blocked');
 }
});
test('R12 append race, review failure and witness outage never allow review',async()=>{
 const race=await fixture({count:c=>c===1?1:2});
 assert.equal((await race.builder().review(at)).reason,'AUDIT_APPEND_RACE');
 const audit=await fixture({portOverrides:{recordDurableReview:async()=>false}});
 assert.equal((await audit.builder().review(at)).reason,'REVIEW_EVIDENCE_NOT_DURABLE');
 const down=await fixture({portOverrides:{readIndependentHead:async()=>{throw Error('DOWN')}}});
 assert.equal((await down.builder().review(at)).reason,'AUTHORITY_UNAVAILABLE');
});
test('R12 default OFF never touches database or witness',async()=>{
 const f=await fixture();const r=await f.builder({enabled:false}).review(at);
 assert.equal(r.reason,'DISABLED');assert.equal(f.counts().dbCalls,0);
});
test('R12 weak or exportable RSA key denied',async()=>{
 const f=await fixture();
 const weak=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:1024,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
 const weakPinned=await crypto.subtle.importKey('spki',await crypto.subtle.exportKey('spki',weak.publicKey),
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 assert.throws(()=>f.builder({verifyKey:weakPinned}),/PINNED_KEY_DENIED/);
 assert.throws(()=>f.builder({verifyKey:keys.publicKey}),/PINNED_KEY_DENIED/);
});
test('R12 signed review cannot be used as purge or restore authorization',async()=>{
 const f=await fixture();const d=await f.builder().review(at);
 assert.equal(d.disposition,'review_only');assert.equal(d.may_restore,false);
 assert.equal('purge_permitted' in d,false);
});
