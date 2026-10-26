import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStarryOidcCallbackGate,isServerVerifiedExistingMember} from '../src/round5-oidc-gate.ts';
import {createTrustedProviderJwksCache} from '../src/jwks-cache.ts';
import {bytesToBase64url} from '../src/oidc-crypto.ts';

const now=1793000000;
const state='state_'+'a'.repeat(40);
const nonce='server-nonce-opaque-roundfive-123456';
const clientId='phd.starry.id';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
async function fixture(changes={}){
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pub={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'key-v5',alg:'RS256',use:'sig'};
 const verifier='v'.repeat(43);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const tx={state,provider:'apple',app_id:'starry-id',environment:'staging',client_id:clientId,
  nonce,code_challenge:bytesToBase64url(new Uint8Array(digest)),code_verifier:verifier,
  expires_at:now+60,consumed_at:null,...changes.attempt};
 const f={now,consumed:false,reads:0,consumes:0,exchanges:0,memberReads:0,fetches:0};
 async function signed(claims={},header={}){
  const h=bytesToBase64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',kid:'key-v5',...header})));
  const p=bytesToBase64url(new TextEncoder().encode(JSON.stringify({
   iss:'https://appleid.apple.com',aud:clientId,nonce,sub:'stable-apple-sub',iat:now-2,exp:now+120,...claims
  })));
  const data=h+'.'+p;const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data));
  return data+'.'+bytesToBase64url(new Uint8Array(sig));
 }
 const dep={
  enabled:changes.enabled??true,scope:changes.scope??scope,provider:changes.provider??'apple',
  clientId:changes.clientId??clientId,
  jwks:createTrustedProviderJwksCache([{provider:'apple',issuer:'https://appleid.apple.com',clientId}],
   async()=>{f.fetches++;return {status:200,body:{keys:[pub]},maxAgeSeconds:60};}),
  readAttempt:async()=>{f.reads++;return tx;},
  consumeAttemptCAS:async()=>{f.consumes++;if(f.consumed)return false;f.consumed=true;return true;},
  exchangeCode:async()=>{f.exchanges++;return {idToken:await signed(changes.claims,changes.header)};},
  readLinkedExistingMember:async()=>{f.memberReads++;return changes.member??{
   s_user_id:'s1',status:'active',auth_version:3,
  };},
 };
 return {f,dep,handle:createOfflineStarryOidcCallbackGate(dep),signed};
}
const payload={state,code:'opaque-provider-auth-code'};
test('feature is OFF by default, no callback exchange, no principal',async()=>{
 const {dep,f}=await fixture();delete dep.enabled;
 const callback=createOfflineStarryOidcCallbackGate(dep);
 assert.equal(await callback.handle(payload,now),null);
 assert.equal(f.reads,0);assert.equal(f.exchanges,0);
});
test('valid signed RSA token, server-only one-use state; result sealed not a TrustedPrincipal',async()=>{
 const x=await fixture();
 const first=await x.handle.handle(payload,now);
 assert.equal(isServerVerifiedExistingMember(first),true);
 assert.deepEqual({...first},{
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  provider:'apple',provider_subject:'stable-apple-sub',
  s_user_id:'s1',auth_version:3,checked_at:now,
 });
 assert.equal(isServerVerifiedExistingMember({...first}),false);
 assert.equal(await x.handle.handle(payload,now),null);
 assert.equal(x.f.exchanges,1);
});
test('reject fake flags/getters, wrong provider and wrong scope',async()=>{
 const x=await fixture();
 for(const v of [
  {...payload,verified:true},{...payload,s_user_id:'s1'},
  {state,code:'x',userId:'s1'},
  Object.defineProperty({state},'code',{enumerable:true,get(){throw Error('getter')}}),
  {state:'short',code:'hi'}
 ])assert.equal(await x.handle.handle(v,now),null);
 assert.equal(x.f.reads,0);
 for(const options of [
  {scope:{...scope,brand_id:'hglobal'}},{scope:{...scope,environment:'production'}},
  {scope:{...scope,app_id:'other'}},
 ]) {
  const y=await fixture(options);
  if(options.scope.brand_id!=='starry'||options.scope.environment==='production'){
   await assert.rejects(async()=>fixture(options),/OIDC_SCOPE_DENIED/);
  }else{
   assert.equal(await y.handle.handle(payload,now),null);
  }
 }
});
test('expired state, wrong app/client/provider/PKCE nonce rejected before exchange',async()=>{
 for(const attempt of [
  {expires_at:now},{app_id:'other'},{client_id:'hglobal'}, {provider:'google'},
  {environment:'production'},{code_challenge:'A'.repeat(43)},
  {consumed_at:now}
 ]){
  const x=await fixture({attempt});
  assert.equal(await x.handle.handle(payload,now),null);
  assert.equal(x.f.exchanges,0);
 }
});
test('unknown kid, wrong nonce, replaced provider audience or invalid signed token fail closed',async()=>{
 for(const options of [
  {header:{kid:'rotated-but-not-trusted'}},{claims:{nonce:'unexpected-nonce'}},
  {claims:{aud:'hglobal'}},{claims:{iss:'https://wrong.invalid'}},
  {claims:{exp:now-1}},
 ]){
  const x=await fixture(options);
  assert.equal(await x.handle.handle(payload,now),null);
  assert.equal(x.f.memberReads,0);
  assert.equal(await x.handle.handle(payload,now),null); // consumed even when verification fails
 }
});
test('suspended/deleted/invalid existing member fail closed; never email-link',async()=>{
 for(const member of [
  {s_user_id:'s1',status:'suspended',auth_version:3},
  {s_user_id:'s1',status:'deleted',auth_version:3},
  {s_user_id:'s1',status:'active',auth_version:0},
  {s_user_id:'',status:'active',auth_version:3},
 ]){
  const x=await fixture({member});
  assert.equal(await x.handle.handle(payload,now),null);
  assert.equal(x.f.exchanges,1);
 }
});
test('single winner concurrent replay permits at most one exchange',async()=>{
 const x=await fixture();
 const [a,b,c]=await Promise.all([x.handle.handle(payload,now),x.handle.handle(payload,now),x.handle.handle(payload,now)]);
 assert.equal([a,b,c].filter(Boolean).length,1);
 assert.equal(x.f.exchanges,1);
});
