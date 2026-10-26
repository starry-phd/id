import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedProviderJwksCache} from '../src/jwks-cache.ts';
import {verifySignedOidcIdToken,bytesToBase64url} from '../src/oidc-crypto.ts';
const now=1793000000,nonce='server-opaque-nonce-0000000',clientId='phd.starry.id';
async function fixture(){
 const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pub={...await crypto.subtle.exportKey('jwk',kp.publicKey),kid:'valid-kid',alg:'RS256',use:'sig'};
 async function signedToken(){
  const h=bytesToBase64url(new TextEncoder().encode(JSON.stringify({kid:'valid-kid',alg:'RS256'})));
  const p=bytesToBase64url(new TextEncoder().encode(JSON.stringify({
   iss:'https://appleid.apple.com',aud:clientId,sub:'sub-opaque',nonce,iat:now-5,exp:now+100})));
  const data=h+'.'+p;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,new TextEncoder().encode(data));
  return data+'.'+bytesToBase64url(new Uint8Array(sig));
 }
 return {pub,signedToken};
}
const reg=[{provider:'apple',issuer:'https://appleid.apple.com',clientId},
           {provider:'google',issuer:'https://accounts.google.com',clientId:'phd.starry.google'}];
test('pinned real Apple JWKS accepts genuine RSA signature and never takes JWT key URL',async()=>{
 const f=await fixture();const requests=[];
 const cache=createTrustedProviderJwksCache(reg,async url=>{requests.push(url);return {status:200,body:{keys:[f.pub]},maxAgeSeconds:90}});
 const provider=await cache.keysFor('apple','valid-kid',now);
 assert.equal(requests[0],'https://appleid.apple.com/auth/keys');
 assert.ok(provider);
 assert.deepEqual(await verifySignedOidcIdToken(await f.signedToken(),{issuer:provider,nonce,now}),
   {provider:'apple',providerSubject:'sub-opaque',issuer:'https://appleid.apple.com',audience:clientId});
 assert.equal(requests.length,1);
});
test('JWKS expires, unknown KID throttle and rotates after 30 seconds',async()=>{
 const f=await fixture();let calls=0;
 const cache=createTrustedProviderJwksCache(reg,async()=>{calls++;return {status:200,body:{keys:[f.pub]},maxAgeSeconds:60}});
 assert.ok(await cache.keysFor('apple','valid-kid',now));
 assert.equal(await cache.keysFor('apple','unknown-kid',now+1),null);
 assert.equal(calls,1);
 assert.equal(await cache.keysFor('apple','unknown-kid',now+31),null);
 assert.equal(calls,2);
 assert.ok(await cache.keysFor('apple','valid-kid',now+100));
 assert.equal(calls,3);
});
test('reject remote injected private key, duplicate kid, HS256, weak RSA and invalid issuer',async()=>{
 const f=await fixture();
 for(const keys of [
  [{...f.pub,d:'private-exponent'}],[f.pub,{...f.pub}],[{...f.pub,alg:'HS256'}],
  [{...f.pub,n:'a'.repeat(30)}],
 ]) {
  const c=createTrustedProviderJwksCache(reg,async()=>({status:200,body:{keys},maxAgeSeconds:200}));
  assert.equal(await c.keysFor('apple','valid-kid',now),null);
 }
 assert.throws(()=>createTrustedProviderJwksCache([
   {provider:'apple',issuer:'https://evil.invalid',clientId},
 ],async()=>({status:200,body:{keys:[f.pub]},maxAgeSeconds:100})),/JWKS_REGISTRY_DENIED/);
});
test('fail closed on bad response, no kid, negative time, missing body',async()=>{
 const c=createTrustedProviderJwksCache(reg,async()=>({status:503,body:{keys:[]},maxAgeSeconds:60}));
 assert.equal(await c.keysFor('apple','kid',now),null);
 assert.equal(await c.keysFor('google','kid',now),null);
 assert.equal(await c.keysFor('hglobal','kid',now),null);
 assert.equal(await c.keysFor('apple','kid',-1),null);
});
