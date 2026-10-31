import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createM1GoogleJwksSource,M1_GOOGLE_DISCOVERY_URL,M1_GOOGLE_JWKS_URL,
 M1_GOOGLE_JWKS_SOURCE_LIVE,
} from '../src/m1-google-jwks-source.ts';
import {bytesToBase64url,verifySignedOidcIdToken} from '../src/oidc-crypto.ts';

const clientId='starry-local-test-client';
const discovery={issuer:'https://accounts.google.com',jwks_uri:M1_GOOGLE_JWKS_URL};
const nonce='n'.repeat(32);
const start=1793000000;
async function signingPair(kid){
 const pair=await globalThis.crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
 },true,['sign','verify']);
 const jwk=await globalThis.crypto.subtle.exportKey('jwk',pair.publicKey);
 return {privateKey:pair.privateKey,
  publicKey:{kty:'RSA',kid,alg:'RS256',use:'sig',n:jwk.n,e:jwk.e}};
}
const response=(value,headers={})=>new globalThis.Response(JSON.stringify(value),{
 status:200,headers:{'content-type':'application/json; charset=utf-8',
  'cache-control':'public, max-age=60',...headers},
});
function fixture({keys,discoveryValue=discovery,override,enabled=true}){
 let seconds=start;
 const calls=[];
 const config={
  enabled,clientId,issuer:'https://accounts.google.com',
  now:()=>seconds,
  transport:async(url,init)=>{
   calls.push({url,init});
   if(override)return override(url,init);
   if(url===M1_GOOGLE_DISCOVERY_URL)return response(discoveryValue);
   if(url===M1_GOOGLE_JWKS_URL)return response({keys});
   throw Error('UNEXPECTED_NETWORK_DESTINATION');
  },
 };
 return {source:createM1GoogleJwksSource(config),calls,
  setTime:n=>{seconds=n;},config};
}
function encode(value){
 return bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));
}
async function signedIdToken(pair,kid,now=start){
 const header=encode({alg:'RS256',typ:'JWT',kid});
 const payload=encode({
  iss:'https://accounts.google.com',aud:clientId,sub:'valid-user-subject',
  nonce,iat:now-5,exp:now+300,
 });
 const data=header+'.'+payload;
 const signed=await globalThis.crypto.subtle.sign(
  'RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data));
 return data+'.'+bytesToBase64url(new Uint8Array(signed));
}

test('JWKS acquisition is default OFF with zero Google calls and no local OAuth acceptance',async()=>{
 let reads=0;
 const source=createM1GoogleJwksSource({
  clientId,issuer:'https://accounts.google.com',
  now:()=>{reads++;return start;},
  transport:async()=>{reads++;throw Error('DONT_FETCH');},
 });
 assert.equal(M1_GOOGLE_JWKS_SOURCE_LIVE,false);
 assert.equal(source.live_enabled,false);
 assert.equal(source.source_only,true);
 assert.equal(await source.getProvider(),null);
 assert.equal(await source.refresh(),null);
 assert.equal(reads,0);
 for(const bad of [
  {clientId:'bad client'}, {issuer:'https://evil.invalid'},
  {transport:null}, {now:null},
 ]){
  assert.throws(()=>createM1GoogleJwksSource({
   enabled:true,clientId,issuer:'https://accounts.google.com',
   now:()=>start,transport:async()=>response(discovery),...bad,
  }),/M1_GOOGLE_JWKS_CONFIGURATION_DENIED/);
 }
});

test('pinned Google discovery + real public RS256 JWK verifies original OIDC crypto, caches and rotates',async()=>{
 const a=await signingPair('kid-A');
 const b=await signingPair('kid-B');
 let current=a.publicKey;
 const f=fixture({keys:[],override:async(url)=>{
  if(url===M1_GOOGLE_DISCOVERY_URL)return response(discovery);
  if(url===M1_GOOGLE_JWKS_URL)
   return response({keys:[current]},{'cache-control':'public, max-age=40','age':'5'});
  throw Error('UNEXPECTED_URL');
 }});
 const [aProvider,concurrent]=await Promise.all([
  f.source.getProvider(),f.source.getProvider(),
 ]);
 assert.ok(aProvider);
 assert.equal(aProvider,concurrent,'inflight request is deduplicated');
 assert.equal(f.calls.length,2,'only Discovery and exact Google JWKS are contacted');
 assert.deepEqual(f.calls.map(c=>c.url),[M1_GOOGLE_DISCOVERY_URL,M1_GOOGLE_JWKS_URL]);
 for(const c of f.calls){
  assert.equal(c.init.method,'GET');
  assert.equal(c.init.credentials,'omit');
  assert.equal(c.init.redirect,'error');
  assert.equal(c.init.cache,'no-store');
 }
 assert.equal(aProvider.provider,'google');
 assert.equal(aProvider.clientId,clientId);
 assert.equal(aProvider.jwks.length,1);
 assert.deepEqual(Object.keys(aProvider.jwks[0]).sort(),
  ['alg','e','key_ops','kid','kty','n','use'].sort(),
  'never forward x5c/private key or undocumented metadata');
 const validA=await signedIdToken(a,'kid-A');
 assert.equal((await verifySignedOidcIdToken(validA,{
  issuer:aProvider,nonce,now:start,
 }))?.providerSubject,'valid-user-subject');
 assert.equal(await f.source.getProvider(),aProvider);
 assert.equal(f.calls.length,2);
 f.setTime(start+34);
 assert.equal(await f.source.getProvider(),aProvider,'age-adjusted cache still valid');
 current=b.publicKey;
 f.setTime(start+35);
 const bProvider=await f.source.getProvider();
 assert.ok(bProvider&&bProvider!==aProvider);
 assert.equal(f.calls.length,4,'expiry refresh fetches new official keys');
 assert.equal(await verifySignedOidcIdToken(validA,{
  issuer:bProvider,nonce,now:start+35,
 }),null,'retired Google kid never falls back to old JWK');
 const validB=await signedIdToken(b,'kid-B',start+35);
 assert.equal((await verifySignedOidcIdToken(validB,{
  issuer:bProvider,nonce,now:start+35,
 }))?.providerSubject,'valid-user-subject');
});

test('JWKS source rejects discovery SSRF, redirects, malformed keys and duplicate kids',async()=>{
 const pair=await signingPair('kid-valid');
 const badCases=[
  {d:{...discovery,jwks_uri:'https://evil.invalid/certs'}},
  {d:{...discovery,issuer:'https://evil.invalid'}},
  {keys:[{...pair.publicKey,d:'PRIVATE_KEY_SHOULD_NOT_ENTER'}]},
  {keys:[pair.publicKey,pair.publicKey]},
  {keys:[{...pair.publicKey,alg:'HS256'}]},
  {keys:[{...pair.publicKey,use:'enc'}]},
  {keys:[{...pair.publicKey,n:'AA'}]},
  {keys:[{...pair.publicKey,key_ops:['verify','sign']}]},
  {headers:{'cache-control':'public, max-age=60','age':'60'}},
  {headers:{'cache-control':'no-store, max-age=60'}},
  {headers:{'cache-control':'public, max-age=999999'}},
  {headers:{'content-type':'text/html'}},
 ];
 for(const item of badCases){
  let certCalls=0;
  const f=fixture({keys:[],override:async(url)=>{
   if(url===M1_GOOGLE_DISCOVERY_URL)return response(item.d??discovery);
   if(url===M1_GOOGLE_JWKS_URL){
    certCalls++;
    return response({keys:item.keys??[pair.publicKey]},item.headers);
   }
   throw Error('SSRF');
  }});
  assert.equal(await f.source.getProvider(),null,JSON.stringify(item).slice(0,90));
  assert.equal(certCalls,item.d?0:1,'invalid Discovery is rejected before cert request');
 }
 for(const attack of ['redirect','foreign-url','large','unavailable']){
  const f=fixture({keys:[],override:async(url)=>{
   if(url===M1_GOOGLE_DISCOVERY_URL)return response(discovery);
   if(attack==='unavailable')throw Error('PRIVATE_GOOGLE_HTTP_ERROR');
   if(attack==='large')return new globalThis.Response('X'.repeat(33000),{
    status:200,headers:{'content-type':'application/json',
     'cache-control':'public, max-age=60'},
   });
   const r=response({keys:[pair.publicKey]});
   Object.defineProperty(r,attack==='redirect'?'redirected':'url',{
    value:attack==='redirect'?true:'https://foreign.invalid/certs',
   });
   return r;
  }});
  assert.equal(await f.source.getProvider(),null,attack);
 }
});

test('expired provider never uses stale JWKS when official HTTP fails; explicit refresh sees rotation',async()=>{
 const a=await signingPair('cached-kid');
 const b=await signingPair('new-kid');
 let current=[a.publicKey],offline=false;
 const f=fixture({keys:[],override:async(url)=>{
  if(offline)throw Error('PRIVATE_AUTH_TOKEN_OR_SECRETS');
  if(url===M1_GOOGLE_DISCOVERY_URL)return response(discovery);
  return response({keys:current},{'cache-control':'public, max-age=10'});
 }});
 const old=await f.source.getProvider();
 assert.equal(old?.jwks[0].kid,'cached-kid');
 current=[b.publicKey];
 const fresh=await f.source.refresh();
 assert.equal(fresh?.jwks[0].kid,'new-kid');
 f.setTime(start+11);offline=true;
 assert.equal(await f.source.getProvider(),null,'no stale-while-error on expired signing keys');
 assert.equal(await f.source.getProvider(),null,'repeated unavailable cannot resurrect key cache');
});


test('Google JWKS body stalled beyond response max-age cannot renew expired signing authority',async()=>{
 const pair=await signingPair('delayed-key');
 let unlockBody=null;
 let bodyRequested;
 const awaitingBody=new Promise(resolve=>{bodyRequested=resolve;});
 let requests=0;
 const source=fixture({keys:[],override:async(url)=>{
  if(url===M1_GOOGLE_DISCOVERY_URL)return response(discovery);
  if(url!==M1_GOOGLE_JWKS_URL)throw Error('UNEXPECTED_JWKS_SOURCE');
  requests++;
  if(requests>1)return response({keys:[pair.publicKey]},
   {'cache-control':'public, max-age=10'});
  const content=new TextEncoder().encode(JSON.stringify({keys:[pair.publicKey]}));
  const stream=new ReadableStream({
   pull(controller){
    bodyRequested();
    return new Promise(resolve=>{
     unlockBody=()=>{
      controller.enqueue(content);
      controller.close();
      resolve();
     };
    });
   },
  },{highWaterMark:0});
  return new Response(stream,{status:200,headers:{
   'content-type':'application/json; charset=utf-8',
   'cache-control':'public, max-age=10',
  }});
 }});
 const stale=source.source.getProvider();
 await awaitingBody; // The response headers have arrived, but body is pending.
 assert.equal(typeof unlockBody,'function');
 source.setTime(start+11); // Google response max-age elapsed before body arrives.
 unlockBody();
 assert.equal(await stale,null,
  'a delayed body must NOT restart a past upstream JWKS TTL');
 assert.equal(requests,1);
 const fresh=await source.source.getProvider();
 assert.equal(fresh?.jwks[0].kid,'delayed-key',
  'expired result is discarded; a NEW official fetch is necessary');
 assert.equal(requests,2);
 source.setTime(start+21);
 assert.ok(await source.source.getProvider(),
  'the new response expires only at its own original max-age deadline if within TTL');
 source.setTime(start+22);
 assert.ok(await source.source.getProvider(),
  'another successful fresh source may be obtained after timeout');
 assert.equal(requests,3,
  'new response cache ends at its acquisition time plus 10 seconds');
});
