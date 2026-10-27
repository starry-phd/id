import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineAdultRegistrationGate,isVerifiedAdultRegistrationEvidence,
 registrationGiftDecision,HGLOBAL_MEMBER_API_ENABLED,STARRY_ID_STANDALONE_STORE_APP} from '../src/round7-adult-registration.ts';
const now=Math.floor(Date.UTC(2026,9,27,12)/1000),scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
test('registration explicitly disabled; never calls risk port or issues gift',async()=>{
 let invoked=0;
 const g=createOfflineAdultRegistrationGate({scope,evaluateRisk:async()=>{invoked++;return 'approved';}});
 assert.equal(await g.evaluate({birthDate:'1999-01-01',adultConfirmed:true},now),null);
 assert.equal(invoked,0);
 assert.equal(registrationGiftDecision({identity:'apple-sub'}),'PRIVACY_GATE_BLOCKED');
 assert.equal(HGLOBAL_MEMBER_API_ENABLED,false);
 assert.equal(STARRY_ID_STANDALONE_STORE_APP,false);
});
test('18+ birthday exact boundary plus trusted risk verdict and WeakSet sealed evidence',async()=>{
 let invoked=0;
 const g=createOfflineAdultRegistrationGate({scope,enabled:true,evaluateRisk:async()=>{invoked++;return 'approved';}});
 const proof=await g.evaluate({birthDate:'2008-10-27',adultConfirmed:true},now);
 assert.equal(isVerifiedAdultRegistrationEvidence(proof),true);
 assert.equal(isVerifiedAdultRegistrationEvidence({...proof}),false);
 assert.equal('birthDate' in proof,false);
 assert.equal(await g.evaluate({birthDate:'2008-10-28',adultConfirmed:true},now),null);
 assert.equal(invoked,1);
});
test('reject underage, impossible date, forged adultConfirmed, prototype/accessor and revoked Proxy',async()=>{
 let n=0;const g=createOfflineAdultRegistrationGate({scope,enabled:true,evaluateRisk:async()=>{n++;return 'approved';}});
 const fake=Object.defineProperty({adultConfirmed:true},'birthDate',{enumerable:true,get(){throw Error('side effect')}});
 const revoked=Proxy.revocable({birthDate:'1998-01-01',adultConfirmed:true},{});revoked.revoke();
 for(const input of [{birthDate:'2009-01-01',adultConfirmed:true},{birthDate:'2008-02-30',adultConfirmed:true},
   {birthDate:'1899-01-01',adultConfirmed:true},{birthDate:'2000-01-01',adultConfirmed:'true'},
   {birthDate:'2000-01-01',adultConfirmed:true,role:'supreme'},fake,
   Object.create({birthDate:'1999-01-01',adultConfirmed:true}),revoked.proxy]){
   assert.equal(await g.evaluate(input,now),null);
 }
 assert.equal(n,0);
});
test('risk review, denied, failure or unknown status cannot enroll',async()=>{
 for(const state of ['review_required','denied','unknown']){
  const g=createOfflineAdultRegistrationGate({scope,enabled:true,evaluateRisk:async()=>state});
  assert.equal(await g.evaluate({birthDate:'1990-12-31',adultConfirmed:true},now),null);
 }
 const g=createOfflineAdultRegistrationGate({scope,enabled:true,evaluateRisk:async()=>{throw Error('offline');}});
 assert.equal(await g.evaluate({birthDate:'1990-12-31',adultConfirmed:true},now),null);
});
test('wrong brand and production can never enable registration policy',()=>{
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'},{...scope,app_id:'evil/id'}])
 assert.throws(()=>createOfflineAdultRegistrationGate({scope:s,enabled:true,evaluateRisk:async()=> 'approved'}),/ADULT_SCOPE_DENIED/);
});
