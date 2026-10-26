import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectStarryAccess,planStageOrder,RELEASE_AUTHORIZED,STARRY_SERVICE_SCOPE,
 POLICY_REVISION} from '../src/staged-policy.ts';
const s={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const req=(operation,auth_service_available=true)=>({...s,operation,auth_service_available});
test('Q117 public liveness survives Auth outage without authorizing a protected operation',()=>{
 assert.equal(POLICY_REVISION,'starry-rollout.v0-draft');
 assert.equal(RELEASE_AUTHORIZED,false);
 assert.equal(STARRY_SERVICE_SCOPE.standalone_store_app,false);
 for(const auth of [true,false]){
  const response=inspectStarryAccess(req('public_health',auth));
  assert.equal(response.allowed,true);
  assert.equal(response.gate,'blocked');
  assert.equal(response.verified_identity,false);
  assert.equal(response.live_deployment,false);
  for(const op of ['identity','battery','billing','admin']){
   const protectedResult=inspectStarryAccess(req(op,auth));
   assert.equal(protectedResult.allowed,false);
   assert.equal(protectedResult.reason,'RELEASE_GATE_BLOCKED');
  }
 }
});
test('No client data can unlock another brand, unapproved app, runtime or cross-brand',()=>{
 for(const x of [{brand_id:'hglobal'},{app_id:'starry-other'}, {environment:'production'}]){
  const got=inspectStarryAccess({...req('identity'),...x});
  assert.equal(got.allowed,false);
 }
 assert.equal(inspectStarryAccess(req('cross_brand')).reason,'CROSS_BRAND_DISABLED');
 for(const fake of [{approved:true},{adminVerified:true},{regionApproved:true},
   {ageVerified:true},{killSwitchOverride:false},{releaseGate:'approved'}]){
  assert.equal(inspectStarryAccess({...req('identity'),...fake}).allowed,false);
 }
});
test('reject getters, inherited claims, hidden properties, revoked proxies and invalid operation',()=>{
 const base=req('public_health');
 const inherited=Object.assign(Object.create({admin:true}),base);
 assert.equal(inspectStarryAccess(inherited).allowed,false);
 const hidden={...base};
 Object.defineProperty(hidden,'verified',{value:true,enumerable:false});
 assert.equal(inspectStarryAccess(hidden).allowed,false);
 const getter={...base};
 Object.defineProperty(getter,'operation',{get(){return 'public_health'},enumerable:true});
 assert.equal(inspectStarryAccess(getter).allowed,false);
 const {proxy,revoke}=Proxy.revocable({...base},{});revoke();
 assert.equal(inspectStarryAccess(proxy).allowed,false);
 assert.equal(inspectStarryAccess(req('fake')).allowed,false);
});
test('stage order is ID then free Battery then Billing, never an automatic release',()=>{
 const x=planStageOrder({identity:'offline_pass',battery:'offline_pass',billing:'offline_pass'});
 assert.deepEqual(x.ready_for_review,['identity','battery','billing']);
 assert.deepEqual(x.blocked,[]);
 assert.equal(x.release_authorized,false);
 const y=planStageOrder({identity:'blocked',battery:'offline_pass',billing:'offline_pass'});
 assert.deepEqual(y.ready_for_review,[]);
 assert.deepEqual(y.blocked,['identity','battery','billing']);
 const z=planStageOrder({identity:'offline_pass',battery:'blocked',billing:'offline_pass'});
 assert.deepEqual(z.ready_for_review,['identity']);
 assert.deepEqual(z.blocked,['battery','billing']);
 const revoked=Proxy.revocable({identity:'blocked',battery:'blocked',billing:'blocked'},{});
 revoked.revoke();
 for(const invalid of [null,[],revoked.proxy,{identity:'approved',battery:'blocked',billing:'blocked'},
   {identity:'offline_pass',billing:'offline_pass'},
   {identity:'blocked',battery:'blocked',billing:'blocked',admin:true}]){
  assert.throws(()=>planStageOrder(invalid),/STAGE_INPUT_DENIED/);
 }
});
