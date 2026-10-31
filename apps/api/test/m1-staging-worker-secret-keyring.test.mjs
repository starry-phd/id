import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createM1StagingWorkerSecretKeyring,M1_STAGING_WORKER_KEYRING_LIVE}
 from '../src/m1-staging-worker-secret-keyring.ts';
import {signServerSession,createVerifiedSignedSession}
 from '../../../modules/starry-id-v1/src/session-crypto.ts';

const NOW=1793000000;
const base=Object.freeze({appId:'starry-id',environment:'staging'});
const b64=n=>Buffer.from(new Uint8Array(32).fill(n)).toString('base64url');
function material(a=1,b=2){
 return {
  sessionActive:{kid:'session-active',secretB64url:b64(a)},
  pkceActive:{kid:'pkce-active',secretB64url:b64(b)},
 };
}
const make=(changes={})=>createM1StagingWorkerSecretKeyring({
 enabled:true,...base,material:material(),...changes,
});
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const claims=kid=>({
 brand_id:'starry',app_id:'starry-id',environment:'staging',
 s_user_id:'su-test',session_id:'sess-test',provider:'google',
 provider_subject:'google-signed-sub',auth_version:1,issued_at:NOW,
 expires_at:NOW+300,key_id:kid,
});
const binding={
 state:'S'.repeat(43),provider:'google',clientId:'local-verified-client',
 appId:'starry-id',environment:'staging',expiresAt:NOW+300,
};
const verifier='v'.repeat(43);
test('Worker Secret keyring default-OFF never imports secrets or returns signing key',async()=>{
 const inactive=await createM1StagingWorkerSecretKeyring({...base});
 assert.equal(M1_STAGING_WORKER_KEYRING_LIVE,false);
 assert.equal(inactive.live_enabled,false);
 assert.equal(inactive.source_only,true);
 assert.equal(inactive.keyring_enabled,false);
 await assert.rejects(inactive.activeKey(),/M1_KEYRING_DISABLED/);
 assert.equal(await inactive.getVerificationKey('session-active'),null);
 assert.equal(await inactive.verifierCustody.seal(verifier,binding),null);
});
test('active HMAC and AES-GCM keys import NON-EXTRACTABLE with separate minimal crypto usages',async()=>{
 const keys=await make();
 assert.equal(keys.source_only,true);
 assert.equal(keys.live_enabled,false);
 assert.equal(keys.keyring_enabled,true);
 const session=await keys.activeKey();
 assert.equal(session.kid,'session-active');
 assert.equal(session.key.extractable,false);
 assert.equal(session.key.algorithm.name,'HMAC');
 assert.deepEqual(session.key.usages.slice().sort(),['sign','verify']);
 const current=await keys.getVerificationKey(session.kid);
 assert.equal(current,session.key);
 assert.equal(await keys.getVerificationKey('unknown'),null);
 const sealed=await keys.verifierCustody.seal(verifier,binding);
 assert.ok(sealed.startsWith('m1gcm1.pkce-active.'));
 assert.notEqual(sealed.includes(verifier),true);
 assert.equal(await keys.verifierCustody.open(sealed,binding),verifier);
 assert.equal(await keys.verifierCustody.open(sealed,{...binding,state:'X'.repeat(43)}),null);
});
test('original signed Starry Session uses HMAC Worker keyring with revocable signed key ID',async()=>{
 const keys=await make();
 const session=await keys.activeKey();
 const token=await signServerSession(claims(session.kid),scope,NOW,session);
 assert.match(token,/^v1\./);
 const verify=createVerifiedSignedSession({
  scope,getKey:keys.getVerificationKey,
 });
 const restored=await verify(token,NOW);
 assert.equal(restored.s_user_id,'su-test');
 assert.equal(restored.provider_subject,'google-signed-sub');
 assert.equal(await verify(token,NOW+400),null);
});
test('rotation: previous HMAC verifies ONLY, previous PKCE decrypts ONLY; active keys issue new material',async()=>{
 const first=await make();
 const old=await first.activeKey();
 const oldBearer=await signServerSession(claims(old.kid),scope,NOW,old);
 const sealed=await first.verifierCustody.seal(verifier,binding);
 const next=await make({material:{
  sessionActive:{kid:'session-next',secretB64url:b64(3)},
  pkceActive:{kid:'pkce-next',secretB64url:b64(4)},
  sessionPrevious:material().sessionActive,
  pkcePrevious:material().pkceActive,
 }});
 const previous=await next.getVerificationKey('session-active');
 assert.ok(previous);
 assert.deepEqual(previous.usages,['verify']);
 await assert.rejects(
  globalThis.crypto.subtle.sign('HMAC',previous,new TextEncoder().encode('bad')),
 );
 assert.equal(await createVerifiedSignedSession({
  scope,getKey:next.getVerificationKey,
 })(oldBearer,NOW) !==null,true);
 assert.equal(await next.verifierCustody.open(sealed,binding),verifier);
 const newSealed=await next.verifierCustody.seal(verifier,binding);
 assert.ok(newSealed.startsWith('m1gcm1.pkce-next.'));
 assert.equal(await first.verifierCustody.open(newSealed,binding),null);
 const fresh=await next.activeKey();
 assert.equal(fresh.kid,'session-next');
 assert.equal(await first.getVerificationKey('session-next'),null);
});
test('removing previous key immediately makes old bearer and sealed PKCE unreadable',async()=>{
 const old=await make();
 const bearer=await signServerSession(claims('session-active'),scope,NOW,await old.activeKey());
 const sealed=await old.verifierCustody.seal(verifier,binding);
 const fresh=await make({material:material(3,4)});
 assert.equal(await createVerifiedSignedSession({
  scope,getKey:fresh.getVerificationKey,
 })(bearer,NOW),null);
 assert.equal(await fresh.verifierCustody.open(sealed,binding),null);
});
test('keyring snapshots KID and key bytes before awaiting import; caller mutation cannot swap identity',async()=>{
 const original=material();
 const keyringPromise=make({material:original});
 original.sessionActive.kid='attacker';
 original.sessionActive.secretB64url=b64(9);
 original.pkceActive.kid='attacker-aes';
 const keys=await keyringPromise;
 assert.equal((await keys.activeKey()).kid,'session-active');
 assert.equal(await keys.getVerificationKey('attacker'),null);
 const sealed=await keys.verifierCustody.seal(verifier,binding);
 assert.ok(sealed.startsWith('m1gcm1.pkce-active.'));
});
test('no accidental active/previous key collision or cross-purpose secret reuse',async()=>{
 for(const overridden of [
  {...material(),pkceActive:material().sessionActive},
  {...material(),pkceActive:{kid:'other',secretB64url:b64(1)}},
  {...material(),sessionPrevious:material().sessionActive},
  {...material(),sessionPrevious:{kid:'other',secretB64url:b64(1)}},
  {...material(),pkcePrevious:material().pkceActive},
  {...material(),pkcePrevious:{kid:'other',secretB64url:b64(2)}},
 ]){
  await assert.rejects(make({material:overridden}),
   /M1_KEYRING_CONFIGURATION_DENIED/);
 }
});
test('wrong app/env/secret encodings and incomplete rollover rejected WITHOUT exposing secrets',async()=>{
 const cases=[
  {appId:'echo-starry'},
  {environment:'production'},
  {enabled:'true'},
  {material:undefined},
  {material:{...material(),pkceActive:undefined}},
  {material:{...material(),sessionActive:{kid:'bad kid',secretB64url:b64(1)}}},
  {material:{...material(),sessionActive:{kid:'session-active',secretB64url:'PRIVATE_KEY'}}},
  {material:{...material(),sessionPrevious:{kid:'old'}}},
  {material:{...material(),pkcePrevious:{kid:'pkce-old',secretB64url:'abc'}}},
 ];
 for(const c of cases){
  await assert.rejects(make(c),e=>{
   assert.doesNotMatch(e.message,/PRIVATE_KEY|secretB64url|Raw/);
   return /^M1_KEYRING_/.test(e.message);
  });
 }
});
