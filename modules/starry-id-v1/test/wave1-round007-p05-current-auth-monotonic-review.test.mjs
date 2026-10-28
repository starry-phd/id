import test from 'node:test';
import assert from 'node:assert/strict';
import {R006_AUTH_ADAPTER_VERSION} from
 '../src/wave1-round006-p05-vnext-auth-adapter.ts';
import {createOfflineR007AuthAuthorityReview,
 R007_AUTH_REVIEW_VERSION,R007_AUTH_REVIEW_LIVE} from
 '../src/wave1-round007-p05-current-auth-monotonic-review.ts';
const NOW=1793000000;
const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
const proof=Object.freeze({
 contract:R006_AUTH_ADAPTER_VERSION,
 scope,event_id:'event-000001',actor_ref:'actor-000001',
 auth_version:3,session_version:5,issuer_kid:'issuer-001',issuer_epoch:1,
 expires_at:NOW+30,evidence:'synthetic_offline_current_auth_only',
 verified_live:false,may_send:false,may_ack_queue:false,may_grant:false
});
const snapshot=()=>({
 source:'synthetic_offline_port',...scope,
 event_id:'event-000001',actor_ref:'actor-000001',
 member_ref:'opaque-member-A',session_ref:'opaque-session-A',
 provider_binding_ref:'opaque-provider-A',
 auth_version:3,session_version:5,member_state:'active',
 session_state:'active'
});
const lease=()=>({source:'synthetic_offline_port',
 issuer_kid:'issuer-001',issuer_epoch:1,rotation_generation:1});
function fixture(options={}){
 let authReads=0,keyReads=0,r006Reads=0;
 const r006={
  reviewFresh:async()=>{r006Reads++;return options.v??{
   status:'review_only',verified_live:false,may_send:false,may_ack_queue:false};},
  readServerReview:()=>options.proof===undefined?proof:options.proof
 };
 const port=createOfflineR007AuthAuthorityReview({
  enabled:options.enabled??true,r006,
  readCurrentActorSession:async()=>{
   authReads++;if(options.authError)throw Error('offline mock failure');
   return options.snapshots?.[authReads-1]??snapshot();
  },
  readCurrentIssuerLease:async()=>{
   keyReads++;return options.leases?.[keyReads-1]??lease();
  }
 });
 return {port,get reads(){return {authReads,keyReads,r006Reads};}};
}
function safe(v,status,reason){
 assert.equal(v.contract,R007_AUTH_REVIEW_VERSION);
 assert.equal(v.status,status);assert.equal(v.reason,reason);
 assert.equal(v.authority,'synthetic_offline_only');
 for(const key of ['verified_live','may_read_live','may_write_d1',
  'may_send','may_enqueue','may_ack_queue','may_grant','may_charge',
  'may_publish'])assert.equal(v[key],false,key);
 for(const secret of ['event-000001','actor-000001','opaque-member',
  'opaque-session','opaque-provider','issuer-001'])
  assert.equal(JSON.stringify(v).includes(secret),false);
}
test('R007 remains OFF and never becomes an issuer or delivery capability',()=>{
 assert.equal(R007_AUTH_REVIEW_LIVE,false);
 assert.match(R007_AUTH_REVIEW_VERSION,/offline-review$/);
});
test('disabled requires zero verification, actor or KMS-port calls',async()=>{
 const f=fixture({enabled:false});
 safe(await f.port.review({},null,NOW),'blocked','DISABLED');
 assert.deepEqual(f.reads,{authReads:0,keyReads:0,r006Reads:0});
});
test('two stable synthetic snapshots remain review-only; all actions false',async()=>{
 const f=fixture();
 safe(await f.port.review({},null,NOW),'review_only',
  'SYNTHETIC_ONLY_NOT_PHYSICAL_AUTHORITY');
 assert.deepEqual(f.reads,{authReads:2,keyReads:2,r006Reads:1});
});
test('R006 denial or forged authorization flag cannot reach actor ports',async()=>{
 for(const v of [
  {status:'blocked',verified_live:false,may_send:false,may_ack_queue:false},
  {status:'review_only',verified_live:true,may_send:false,may_ack_queue:false},
  {status:'review_only',verified_live:false,may_send:true,may_ack_queue:false}
 ]){
  const f=fixture({v});
  safe(await f.port.review({},null,NOW),'blocked','MISSING_R006_PROOF');
  assert.equal(f.reads.authReads,0);assert.equal(f.reads.keyReads,0);
 }
});
test('missing, expired, production and live-flagged proofs fail before reads',async()=>{
 const variants=[null,{...proof,expires_at:NOW},
  {...proof,scope:{...scope,environment:'production'}},
  {...proof,verified_live:true},
  {...proof,evidence:'physical_auth_cas'}];
 for(const p of variants){
  const f=fixture({proof:p});
  safe(await f.port.review({},null,NOW),'blocked','MISSING_R006_PROOF');
  assert.equal(f.reads.authReads,0);
 }
});
test('actor, member, session and provider reassociation between reads deny',async()=>{
 for(const change of [
  {actor_ref:'actor-CHANGED'},
  {member_ref:'opaque-member-B'},
  {session_ref:'opaque-session-B'},
  {provider_binding_ref:'opaque-provider-B'}
 ]){
  const f=fixture({snapshots:[snapshot(),{...snapshot(),...change}]});
  const reason=change.actor_ref?'INVALID_SCOPE':'ACTOR_CHANGED';
  safe(await f.port.review({},null,NOW),'blocked',reason);
 }
});
test('revocation, deletion, suspension and expiry are denied',async()=>{
 for(const change of [
  {member_state:'deleted'},{member_state:'suspended'},
  {session_state:'revoked'},{session_state:'expired'}
 ]){
  const f=fixture({snapshots:[snapshot(),{...snapshot(),...change}]});
  safe(await f.port.review({},null,NOW),'blocked','REVOKED_OR_DELETED');
 }
});
test('monotonic SessionVersion/Member AuthVersion changes DENY either direction',async()=>{
 for(const change of [
  {session_version:4},{session_version:6},
  {auth_version:2},{auth_version:4}
 ]){
  const f=fixture({snapshots:[snapshot(),{...snapshot(),...change}]});
  const reason='session_version' in change?
   'SESSION_VERSION_CHANGED':'AUTH_VERSION_CHANGED';
  safe(await f.port.review({},null,NOW),'blocked',reason);
 }
});
test('KID/epoch or rotation generation change denies, without ACK',async()=>{
 for(const change of [
  {issuer_kid:'issuer-002'},{issuer_epoch:2},{rotation_generation:2}
 ]){
  const f=fixture({leases:[lease(),{...lease(),...change}]});
  safe(await f.port.review({},null,NOW),'blocked','ISSUER_ROTATED');
 }
});
test('missing/malformed issuer and actor snapshots fail closed',async()=>{
 for(const options of [
  {leases:[null]},{snapshots:[null]},
  {snapshots:[{...snapshot(),source:'physical_d1'}]},
  {snapshots:[{...snapshot(),app_id:'other.app'}]},
  {snapshots:[{...snapshot(),extra:'unapproved'}]}
 ]){
  const f=fixture(options);
  const reason=options.leases?'ISSUER_ROTATED':'INVALID_SCOPE';
  safe(await f.port.review({},null,NOW),'blocked',reason);
 }
 const f=fixture({authError:true});
 safe(await f.port.review({},null,NOW),'blocked','PORT_FAILURE');
});
test('invalid time and missing required ports never permit work',async()=>{
 const f=fixture();
 safe(await f.port.review({},null,0),'blocked','EXPIRED');
 assert.equal(f.reads.r006Reads,0);
 assert.throws(()=>createOfflineR007AuthAuthorityReview({
  enabled:true,r006:null,readCurrentActorSession:()=>null,
  readCurrentIssuerLease:()=>null
 }),/R007_OFFLINE_PORTS_REQUIRED/);
});
