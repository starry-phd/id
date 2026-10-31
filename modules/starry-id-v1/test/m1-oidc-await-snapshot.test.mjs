/**
 * AI-1 targeted post-#286 regression: the OUTER verified OIDC callback also
 * must not re-read a caller's code/attempt/backend after awaited state/PKCE.
 * Real generated RS256 keys; no live OAuth/D1/HTTP and no user secrets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {bytesToBase64url,createVerifiedOidcCallback} from '../src/oidc-crypto.ts';

const NOW=1793000000;
const CLIENT='local-verified-client.apps.googleusercontent.com';
const STATE='s'.repeat(43);
const NONCE='n'.repeat(43);
const VERIFIER='v'.repeat(43);
const CODE='original-server-received-code';
const enc=new TextEncoder();
const b64=value=>bytesToBase64url(value);
async function fixture(){
 const pair=await webcrypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
 },false,['sign','verify']);
 const publicJwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
 const config={
  provider:'google',clientId:CLIENT,issuer:'https://accounts.google.com',
  jwks:[{...publicJwk,kid:'test-rsa',use:'sig',alg:'RS256'}],
 };
 const digest=await webcrypto.subtle.digest('SHA-256',enc.encode(VERIFIER));
 const tx={state:STATE,codeVerifier:VERIFIER,
  codeChallenge:b64(new Uint8Array(digest)),nonce:NONCE,
  provider:'google',clientId:CLIENT,appId:'starry-id',
  environment:'staging',expiresAt:NOW+180,consumedAt:null,
 };
 async function signed(nonce=NONCE,expiresAt=NOW+300){
  const h=b64(enc.encode(JSON.stringify({alg:'RS256',kid:'test-rsa',typ:'JWT'})));
  const p=b64(enc.encode(JSON.stringify({iss:config.issuer,sub:'verified-test-subject',
   aud:CLIENT,nonce,iat:NOW,exp:expiresAt})));
  const value=h+'.'+p;
  const signature=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,enc.encode(value));
  return value+'.'+b64(new Uint8Array(signature));
 }
 const received=[];
 let casCalls=0,readCalls=0,exchangeCalls=0;
 const token=await signed();
 const backend={
  async readAttempt(){readCalls++;return tx;},
  async consumeAttemptCAS(){casCalls++;return true;},
  async exchangeCode(params){exchangeCalls++;received.push({...params});return {idToken:token};},
 };
 const deps={config,appId:'starry-id',environment:'staging',backend};
 const run=request=>createVerifiedOidcCallback(deps)(request,NOW);
 return {tx,backend,deps,config,signed,received,run,request:{code:CODE,state:STATE},
  stats(){return {casCalls,readCalls,exchangeCalls};},
 };
}

test('verified callback preserves ORIGINAL checked code when backend readAttempt awaits and mutates caller',async()=>{
 const f=await fixture();
 const input={...f.request};
 f.backend.readAttempt=async()=>{input.code='MUTATED_AFTER_VALIDATION';return f.tx;};
 const verified=await f.run(input);
 assert.equal(verified?.providerSubject,'verified-test-subject');
 assert.equal(f.received.length,1);
 assert.equal(f.received[0].code,CODE);
});

test('verified callback rejects accessor state/code without invoking their executable getters',async()=>{
 const f=await fixture();
 let reads=0;
 const untrusted={get code(){reads++;return CODE;},get state(){reads++;return STATE;}};
 assert.equal(await f.run(untrusted),null);
 assert.equal(reads,0);
 assert.equal(f.stats().readCalls,0);
 assert.equal(f.stats().casCalls,0);
});

test('consume CAS await cannot replace previously PKCE-verified attempt verifier/client/nonce',async()=>{
 const f=await fixture();
 f.backend.consumeAttemptCAS=async()=>{
  f.tx.codeVerifier='z'.repeat(43);
  f.tx.clientId='forged-client';
  f.tx.nonce='attacker-chosen-nonce-value';
  return true;
 };
 const verified=await f.run(f.request);
 assert.equal(verified?.providerSubject,'verified-test-subject');
 assert.equal(f.received.length,1);
 assert.equal(f.received[0].verifier,VERIFIER);
 assert.equal(f.received[0].clientId,CLIENT);
});

test('backend method replacements made during awaited readAttempt cannot bypass original CAS or exchange',async()=>{
 const f=await fixture();
 const original=f.backend.readAttempt;
 f.backend.readAttempt=async()=>{
  f.backend.consumeAttemptCAS=async()=>true;
  f.backend.exchangeCode=async()=>{throw Error('REPLACEMENT_CODE_EXCHANGE');};
  return original();
 };
 const verified=await f.run(f.request);
 assert.equal(verified?.providerSubject,'verified-test-subject');
 assert.deepEqual(f.stats(),{casCalls:1,readCalls:1,exchangeCalls:1});
});

test('PINNED callback issuer/audience/backend references cannot be changed after construction',async()=>{
 const f=await fixture();
 const originalClient=f.config.clientId,originalIssuer=f.config.issuer;
 const verifier=createVerifiedOidcCallback(f.deps);
 f.config.clientId='attacker-client.apps.googleusercontent.com';
 f.config.issuer='https://appleid.apple.com';
 f.deps.appId='attacker-app';
 f.deps.environment='development';
 f.deps.backend={
  async readAttempt(){throw Error('REPLACEMENT_BACKEND');},
  async consumeAttemptCAS(){throw Error('REPLACEMENT_CAS');},
  async exchangeCode(){throw Error('REPLACEMENT_TOKEN');},
 };
 const verified=await verifier(f.request,NOW);
 assert.equal(verified?.providerSubject,'verified-test-subject');
 assert.equal(verified?.issuer,originalIssuer);
 assert.equal(verified?.audience,originalClient);
 assert.deepEqual(f.stats(),{casCalls:1,readCalls:1,exchangeCalls:1});
});


test('outer callback inspects a proxy once, never invokes a second ownKeys trap after snapshot',async()=>{
 const f=await fixture();
 let keyEnumerations=0;
 const caller=new Proxy({...f.request},{
  ownKeys(target){
   keyEnumerations++;
   if(keyEnumerations>1)throw Error('SECOND_UNTRUSTED_PROXY_TRAP');
   return Reflect.ownKeys(target);
  },
 });
 const verified=await f.run(caller);
 assert.equal(verified?.providerSubject,'verified-test-subject');
 assert.equal(keyEnumerations,1);
 assert.deepEqual(f.stats(),{casCalls:1,readCalls:1,exchangeCalls:1});
});

test('OAuth attempt expired during asynchronous Google JWKS lookup cannot be consumed',async()=>{
 const f=await fixture();
 let clock=NOW;
 const handler=createVerifiedOidcCallback({
  ...f.deps,getTrustedNow:()=>clock,
  async getVerificationProvider(){
   clock=NOW+181; // Attempt expires at NOW+180 while JWKS awaits.
   return f.config;
  },
 });
 assert.equal(await handler(f.request,NOW),null);
 assert.deepEqual(f.stats(),{casCalls:0,readCalls:1,exchangeCalls:0},
  'no state CAS, Google code exchange or Session after expiry');
});

test('Google ID Token expired during the code exchange is rejected at final trusted time',async()=>{
 const f=await fixture();
 let clock=NOW;
 const shortlyValid=await f.signed(NONCE,NOW+4);
 f.backend.exchangeCode=async()=>{
  clock=NOW+5; // Token was valid at callback entry but expired in flight.
  return {idToken:shortlyValid};
 };
 const handler=createVerifiedOidcCallback({...f.deps,getTrustedNow:()=>clock});
 assert.equal(await handler(f.request,NOW),null,
  'the callback-entry clock must never resurrect a now-expired JWT');
 assert.equal(f.stats().casCalls,1,
  'a single one-time state CAS still takes place before Google code exchange');
 assert.equal(f.stats().readCalls,1);
});

test('OIDC callback denies a server clock rollback during awaited JWKS acquisition',async()=>{
 const f=await fixture();
 let clock=NOW;
 const handler=createVerifiedOidcCallback({
  ...f.deps,getTrustedNow:()=>clock,
  async getVerificationProvider(){
   clock=NOW-1;return f.config;
  },
 });
 assert.equal(await handler(f.request,NOW),null);
 assert.deepEqual(f.stats(),{casCalls:0,readCalls:1,exchangeCalls:0});
 assert.throws(()=>createVerifiedOidcCallback({
  ...f.deps,getTrustedNow:'untrusted-browser-clock',
 }),/OIDC_CALLBACK_CONFIGURATION_DENIED/);
});
