import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineOfficialProviderAuthority} from '../src/round6-provider-authority.ts';
import {verifySignedOidcIdToken,bytesToBase64url} from '../src/oidc-crypto.ts';

const now=1793000000;
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const options={scope,callbackOrigins:['https://id.starry.test/'],providers:[
  {provider:'apple',clientId:'starry.apple.client',redirectUri:'https://id.starry.test/callback/apple'},
  {provider:'google',clientId:'starry.google.client',redirectUri:'https://id.starry.test/callback/google'},
]};
const EXPECTED={
 apple:{provider:'apple',issuer:'https://appleid.apple.com',
  authorizeUrl:'https://appleid.apple.com/auth/authorize',
  tokenUrl:'https://appleid.apple.com/auth/token',
  jwksUrl:'https://appleid.apple.com/auth/keys'},
 google:{provider:'google',issuer:'https://accounts.google.com',
  authorizeUrl:'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl:'https://oauth2.googleapis.com/token',
  jwksUrl:'https://www.googleapis.com/oauth2/v3/certs'},
};
async function keys(){
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 return {pair,jwk:{...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'server-key',alg:'RS256',use:'sig'}};
}
function success(url,jwk){
 return {requestedUrl:url,finalUrl:url,status:200,redirectCount:0,
  contentType:'application/json',byteLength:800,durationMs:20,maxAgeSeconds:60,body:{keys:[jwk]}};
}
test('official Apple and Google authorize/token/JWKS locations are fixed, server-owned only',async()=>{
 let calls=0;const {jwk}=await keys();
 const gate=createOfflineOfficialProviderAuthority({...options,enabled:true,trustedHttp:async url=>{
  calls++;return success(url,jwk);
 }});
 for(const p of ['apple','google']){
  assert.deepEqual(Object.fromEntries(Object.entries(gate.authorizedEndpoints(p)).filter(([k])=>k in EXPECTED[p])),EXPECTED[p]);
  assert.ok(await gate.pinnedJwks(p,'server-key',now));
 }
 assert.equal(calls,2);
 assert.equal(gate.authorizedEndpoints('hglobal'),null);
 assert.equal(await gate.pinnedJwks('hglobal','server-key',now),null);
});
test('default OFF must neither yield endpoints nor invoke network-adapter',async()=>{
 let calls=0;const {jwk}=await keys();
 const gate=createOfflineOfficialProviderAuthority({...options,trustedHttp:async url=>{
  calls++;return success(url,jwk);
 }});
 assert.equal(gate.authorizedEndpoints('apple'),null);
 assert.equal(await gate.pinnedJwks('apple','server-key',now),null);
 assert.equal(calls,0);
});
test('real ephemeral RS256 JWT validates only via official pinned JWKS and verified issuer, nonce',async()=>{
 const {pair,jwk}=await keys();
 const gate=createOfflineOfficialProviderAuthority({...options,enabled:true,
  trustedHttp:async url=>success(url,jwk)});
 const jwks=await gate.pinnedJwks('apple','server-key',now);
 const nonce='opaque-nonce-trusted-apple-round6';
 const h=bytesToBase64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',kid:'server-key'})));
 const p=bytesToBase64url(new TextEncoder().encode(JSON.stringify({iss:'https://appleid.apple.com',
  sub:'sub-apple',aud:'starry.apple.client',nonce,iat:now-1,exp:now+120})));
 const unsigned=h+'.'+p;
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned));
 const signed=unsigned+'.'+bytesToBase64url(new Uint8Array(sig));
 assert.deepEqual(await verifySignedOidcIdToken(signed,{issuer:jwks,nonce,now}),{
  provider:'apple',providerSubject:'sub-apple',issuer:'https://appleid.apple.com',audience:'starry.apple.client'
 });
 assert.equal(await verifySignedOidcIdToken(signed,{issuer:jwks,nonce:'different-nonce-00000',now}),null);
});
test('configured redirect URI MUST belong to explicitly server-pinned HTTPS callback origins',async()=>{
 const original=async()=>{throw Error('never called')};
 for(const override of [
  {callbackOrigins:['http://id.starry.test/']},
  {callbackOrigins:['https://id.starry.test.evil.com/']},
  {callbackOrigins:['https://id.starry.test?x=1']},
  {providers:[{...options.providers[0],redirectUri:'https://evil.test/callback'}]},
  {providers:[{...options.providers[0],redirectUri:'http://id.starry.test/callback'}]},
  {providers:[{...options.providers[0],redirectUri:'https://id.starry.test/callback#x'}]},
  {providers:[options.providers[0],options.providers[0]]},
 ]){
  assert.throws(()=>createOfflineOfficialProviderAuthority({...options,...override,enabled:true,trustedHttp:original}),
    /CALLBACK_ORIGINS_DENIED|PROVIDER_CONFIG_DENIED/);
 }
 for(const badScope of [
  {...scope,brand_id:'hglobal'},{...scope,environment:'production'},
  {...scope,app_id:'invalid/app'},
 ]){
  assert.throws(()=>createOfflineOfficialProviderAuthority({...options,scope:badScope,trustedHttp:original}),
    /PROVIDER_SCOPE_DENIED/);
 }
});
test('reject server transport evidence spoof, redirected/HTML/error/oversize/timeout and unknown kid',async()=>{
 const {jwk}=await keys();
 const kinds=[
  {finalUrl:'https://attack.invalid/keys'}, {requestedUrl:'https://evil.invalid/'},
  {redirectCount:1},{contentType:'text/html'},{status:302},{byteLength:65537},
  {durationMs:5001},{body:null}, {body:[]},
 ];
 for(const change of kinds){
  let count=0;
  const gate=createOfflineOfficialProviderAuthority({...options,enabled:true,
   trustedHttp:async url=>{count++;return {...success(url,jwk),...change};}});
  assert.equal(await gate.pinnedJwks('apple','server-key',now),null);
  assert.equal(count,1);
  assert.equal(await gate.pinnedJwks('apple','server-key',now+1),null); // fail-closed cache cooldown
  assert.equal(count,1);
 }
 const gate=createOfflineOfficialProviderAuthority({...options,enabled:true,
  trustedHttp:async url=>success(url,jwk)});
 assert.equal(await gate.pinnedJwks('apple','attacker-injected',now),null);
});
