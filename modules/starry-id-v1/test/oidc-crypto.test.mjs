import test from 'node:test';
import assert from 'node:assert/strict';
import {bytesToBase64url,verifySignedOidcIdToken,verifyPkceS256,createVerifiedOidcCallback} from '../src/oidc-crypto.ts';
const now=1793000000;
const nonce='server-nonce-opaque-32-chars-00',state='server-opaque-state-000000000000000000001',clientId='phd.starry.id';
async function keys(){
 const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',kp.publicKey);
 return {privateKey:kp.privateKey,config:{provider:'apple',clientId,issuer:'https://appleid.apple.com',
   jwks:[{...jwk,kid:'apple-test-kid',alg:'RS256',use:'sig'}]}};
}
async function jwt(priv,claims={},header={}){
 const h=bytesToBase64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',kid:'apple-test-kid',typ:'JWT',...header})));
 const p=bytesToBase64url(new TextEncoder().encode(JSON.stringify({
  iss:'https://appleid.apple.com',aud:clientId,sub:'opaque-provider-sub',nonce,iat:now-5,exp:now+200,...claims
 })));
 const text=h+'.'+p;
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',priv,new TextEncoder().encode(text));
 return text+'.'+bytesToBase64url(new Uint8Array(sig));
}
test('real RSA-SHA256 JWKS signature pins issuer audience and nonce',async()=>{
 const {privateKey,config}=await keys();
 const result=await verifySignedOidcIdToken(await jwt(privateKey),{issuer:config,nonce,now});
 assert.deepEqual(result,{provider:'apple',providerSubject:'opaque-provider-sub',
   issuer:'https://appleid.apple.com',audience:clientId});
});
test('reject tampered signature and wrong key/KID, algorithm downgrade and JKU',async()=>{
 const {privateKey,config}=await keys();
 const signed=await jwt(privateKey);
 const parts=signed.split('.');
 assert.equal(await verifySignedOidcIdToken(parts[0]+'.'+parts[1].slice(0,-2)+'AB.'+parts[2],{issuer:config,nonce,now}),null);
 for(const head of [{alg:'none'},{alg:'HS256'},{kid:'unknown'},{jku:'https://evil.invalid/key'}]){
  assert.equal(await verifySignedOidcIdToken(await jwt(privateKey,{},head),{issuer:config,nonce,now}),null);
 }
 const evil=await keys();
 assert.equal(await verifySignedOidcIdToken(signed,{issuer:evil.config,nonce,now}),null);
});
test('reject malicious claims, expired/future token, wrong aud/nonce/multiple audiences',async()=>{
 const {privateKey,config}=await keys();
 for(const changed of [{iss:'https://bad.invalid'},{aud:'hglobal'}, {nonce:'wrong'},
 {exp:now},{iat:now+90},{iat:now-900},{nbf:now+120},{aud:[clientId,'other']},
 {aud:[clientId,'other'],azp:'hglobal'},{azp:'other'}, {sub:''}])
  assert.equal(await verifySignedOidcIdToken(await jwt(privateKey,changed),{issuer:config,nonce,now}),null);
 assert.ok(await verifySignedOidcIdToken(await jwt(privateKey,{aud:[clientId,'secondary'],azp:clientId}),{issuer:config,nonce,now}));
});
test('PKCE S256 uses true SHA256 and rejects wrong verifier',async()=>{
 const verifier='v'.repeat(43);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const challenge=bytesToBase64url(new Uint8Array(digest));
 assert.equal(await verifyPkceS256(verifier,challenge),true);
 assert.equal(await verifyPkceS256('a'.repeat(43),challenge),false);
 assert.equal(await verifyPkceS256('invalid short',challenge),false);
});
test('authorization-code callback server state is CAS consumed once',async()=>{
 const {privateKey,config}=await keys(),verifier='v'.repeat(43);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const tx={state,codeVerifier:verifier,codeChallenge:bytesToBase64url(new Uint8Array(digest)),
   nonce,provider:'apple',clientId,appId:'starry-id',environment:'staging',expiresAt:now+60,consumedAt:null};
 let consumed=false,exchanges=0;
 const backend={
   readAttempt:async()=>tx,
   consumeAttemptCAS:async()=>!consumed&&(consumed=true),
   exchangeCode:async()=>{exchanges++;return {idToken:await jwt(privateKey)};},
 };
 const handle=createVerifiedOidcCallback({config,appId:'starry-id',environment:'staging',backend});
 assert.equal((await handle({state,code:'oidc-auth-code'},now)).providerSubject,'opaque-provider-sub');
 assert.equal(await handle({state,code:'oidc-auth-code'},now),null);
 assert.equal(exchanges,1);
});
test('OIDC callback fails closed for wrong state, app, env, PKCE and forged claim',async()=>{
 const {privateKey,config}=await keys(),verifier='v'.repeat(43);
 const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const tx={state,codeVerifier:verifier,codeChallenge:bytesToBase64url(new Uint8Array(d)),nonce,
   provider:'apple',clientId,appId:'starry-id',environment:'staging',expiresAt:now+60,consumedAt:null};
 for(const delta of [{appId:'other'},{environment:'production'},{codeChallenge:'z'.repeat(43)},
     {consumedAt:now},{expiresAt:now}]){
  let exchanges=0;
  const handler=createVerifiedOidcCallback({config,appId:'starry-id',environment:'staging',
    backend:{readAttempt:async()=>({...tx,...delta}),consumeAttemptCAS:async()=>true,
      exchangeCode:async()=>{exchanges++;return {idToken:await jwt(privateKey)};}}});
  assert.equal(await handler({state,code:'opaque'},now),null);
  assert.equal(exchanges,0);
 }
 const handler=createVerifiedOidcCallback({config,appId:'starry-id',environment:'staging',
   backend:{readAttempt:async()=>tx,consumeAttemptCAS:async()=>true,
     exchangeCode:async()=>({idToken:await jwt(privateKey,{aud:'wrong'})})}});
 assert.equal(await handler({state,code:'opaque'},now),null);
 assert.equal(await handler({state,code:'opaque',verified:true},now),null);
});
