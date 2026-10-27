import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStarryRecoveryFenceAuthority,LIVE_STARRY_RECOVERY_FENCES_ENABLED}
 from '../src/round10-recovery-fences.ts';

const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const counts={deleted_members:5,revoked_sessions:12,claimed_registration_gifts:4};
function make(cfg={}){
 const calls={privacy:0,witness:0,verify:0,db:0};
 const witness=Object.defineProperties({
  brand_id:'starry',environment:'staging',source:'independent_append_only',
  witness_ref:'independent-hsm-001',observed_at:now,counters:{...counts},
 },Object.getOwnPropertyDescriptors(cfg.witness??{}));
 const db={prepare(sql){
  calls.db++;
  assert.match(sql,/FROM starry_auth_recovery_fence/);
  return {first:async()=>Object.hasOwn(cfg,'row')?cfg.row:{...counts}};
 }};
 const props={enabled:cfg.enabled??true,scope:cfg.scope??scope,db,
  privacyAndRecoveryApprovedNow:async()=>{
   calls.privacy++;return Object.hasOwn(cfg,'privacy')?cfg.privacy:true;},
  readIndependentCheckpoint:async()=>{
   calls.witness++;if(cfg.throwWitness)throw Error('witness unavailable');
   return Object.hasOwn(cfg,'witness')&&cfg.witness===null?null:witness;},
  verifyIndependentAttestation:async()=>{
   calls.verify++;return Object.hasOwn(cfg,'signature')?cfg.signature:true;},
 };
 const gate=createOfflineStarryRecoveryFenceAuthority(props);
 return {gate,calls,props};
}
test('default-off and disabled privacy never consult witness or D1',async()=>{
 assert.equal(LIVE_STARRY_RECOVERY_FENCES_ENABLED,false);
 for(const cfg of [{enabled:false},{privacy:false},{privacy:null}]){
  const x=make(cfg);
  assert.equal(await x.gate.review(now),null);
  assert.equal(x.calls.witness,0);assert.equal(x.calls.db,0);
 }
});
test('independent recent authenticated checkpoint matches local counters only for review',async()=>{
 const x=make();
 const r=await x.gate.review(now);
 assert.deepEqual(r,{disposition:'review_only',may_restore:false,
  checked_at:now,counters:counts});
 assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.counters));
 assert.equal(x.calls.verify,1);assert.equal(x.calls.db,1);
 assert.equal(Object.hasOwn(r,'mayApply'),false);
});
test('stale snapshot, missing signed witness and verification failure block before DB access',async()=>{
 for(const cfg of [
  {witness:null},{signature:false},{signature:null},{throwWitness:true},
  {witness:{observed_at:now-31}},{witness:{observed_at:now+1}},
  {witness:{source:'d1_pitr'}},{witness:{environment:'production'}},
  {witness:{brand_id:'hglobal'}},{witness:{witness_ref:''}},
  {witness:{counters:{...counts,deleted_members:-1}}},
  {witness:{counters:{...counts,claimed_registration_gifts:'4'}}},
 ]){
  const x=make(cfg);
  assert.equal(await x.gate.review(now),null);
  assert.equal(x.calls.db,0);
 }
});
test('any current-vs-independent fence mismatch, invalid DB row or authority outage blocks restore',async()=>{
 for(const cfg of [
  {row:{...counts,deleted_members:4}},
  {row:{...counts,revoked_sessions:13}},
  {row:{...counts,claimed_registration_gifts:5}},
  {row:null},{row:{...counts,deleted_members:'5'}},
  {row:{...counts,unused:1}},{row:{...counts,revoked_sessions:-1}},
 ]){
  const x=make(cfg);
  assert.equal(await x.gate.review(now),null);
 }
});
test('reject revoked Proxy, accessors, signature-shaped client boolean, cross-brand or production',async()=>{
 const poisoned=Object.defineProperty({brand_id:'starry',environment:'staging',
 source:'independent_append_only',witness_ref:'w',observed_at:now},'counters',{
 enumerable:true,get(){throw Error('accessor side-effect')}});
 const x=make({witness:poisoned});
 assert.equal(await x.gate.review(now),null);assert.equal(x.calls.db,0);
 const revoked=Proxy.revocable({...counts},{});revoked.revoke();
 const y=make({witness:{counters:revoked.proxy}});
 assert.equal(await y.gate.review(now),null);assert.equal(y.calls.db,0);
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'},
  {...scope,app_id:'invalid/app'}]){
  assert.throws(()=>make({scope:s}),/RECOVERY_AUTH_SCOPE_DENIED/);
 }
});
test('no use of scope token alone as a restore authorization',async()=>{
 const x=make({privacy:true,signature:true});
 const r=await x.gate.review(now);
 assert.equal(r?.may_restore,false);
 assert.equal(await x.gate.review(now+31),null);
});
