import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1GoogleCodeExchange,M1_GOOGLE_TOKEN_ENDPOINT,M1_GOOGLE_EXCHANGE_LIVE_ENABLED} from '../src/m1-google-oauth-exchange.ts';

const callback='https://auth.starry.example/v1/starry-id/oauth/google/callback';
const client='test-client.apps.googleusercontent.com';
const code='valid_google_code';
const verifier='v'.repeat(43);
const jwt='eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';
const input={provider:'google',clientId:client,code,verifier};
const ok=(body={id_token:jwt,access_token:'PRIVATE_ACCESS',refresh_token:'PRIVATE_REFRESH'})=>
 new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json; charset=UTF-8'}});
function fixture(){
 const calls=[];let secrets=0;
 const deps={enabled:true,clientId:client,redirectUri:callback,
   readClientSecret:async()=>{secrets++;return 'test-secret-not-a-real-credential';},
   transport:async (...args)=>{calls.push(args);return ok();},
 };
 return {deps,calls,get secrets(){return secrets;}};
}
test('OFF by default denies without reading KMS or touching provider',async()=>{
 const f=fixture();assert.equal(M1_GOOGLE_EXCHANGE_LIVE_ENABLED,false);
 const adapter=createM1GoogleCodeExchange({...f.deps,enabled:false});
 assert.equal(await adapter(input),null);assert.equal(f.secrets,0);assert.equal(f.calls.length,0);
});
test('Google exchange posts exact server-bound authorization_code + PKCE and returns ID token only',async()=>{
 const f=fixture();const adapter=createM1GoogleCodeExchange(f.deps);
 assert.deepEqual(await adapter(input),{idToken:jwt});
 assert.equal(f.calls.length,1);
 const [url,init]=f.calls[0];assert.equal(url,M1_GOOGLE_TOKEN_ENDPOINT);
 assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
 assert.equal(init.cache,'no-store');assert.equal(init.referrerPolicy,'no-referrer');
 const data=new URLSearchParams(init.body);
 assert.deepEqual([...data.keys()].sort(),['client_id','client_secret','code','code_verifier','grant_type','redirect_uri'].sort());
 assert.equal(data.get('code'),code);assert.equal(data.get('code_verifier'),verifier);
 assert.equal(data.get('client_id'),client);assert.equal(data.get('redirect_uri'),callback);
 assert.equal(data.get('grant_type'),'authorization_code');
 assert.equal(data.get('client_secret'),'test-secret-not-a-real-credential');
 const output=await adapter(input);assert.equal(Object.hasOwn(output,'refresh_token'),false);
});
test('cross-provider, bad client, invalid verifier and malicious code fail before secret access',async()=>{
 for(const changes of [
   {provider:'apple'},{clientId:'attacker.apps.googleusercontent.com'},
   {verifier:'short'},{code:'a\nredirect=https://evil.test'},{code:''},{code:'x'.repeat(2049)},
 ]){
  const f=fixture();const adapter=createM1GoogleCodeExchange(f.deps);
  assert.equal(await adapter({...input,...changes}),null);
  assert.equal(f.secrets,0);assert.equal(f.calls.length,0);
 }
});
test('untrusted HTTP/redirect configuration refused at construction',()=>{
 for(const url of ['http://auth.starry.example/callback','https://user:pass@auth.starry.example/callback',
  'https://auth.starry.example/','https://auth.starry.example/callback?token=a','https://auth.starry.example/callback#frag']){
  assert.throws(()=>createM1GoogleCodeExchange({...fixture().deps,redirectUri:url}),/M1_GOOGLE_REDIRECT_DENIED/);
 }
});
test('failed KMS, invalid secret, transport throw and error body fail closed without secret details',async()=>{
 for(const readClientSecret of [async()=>{throw Error('SECRET_MANAGER_PRIVATE');},async()=>null,async()=>'short']){
  const f=fixture();const adapter=createM1GoogleCodeExchange({...f.deps,readClientSecret});
  assert.equal(await adapter(input),null);assert.equal(f.calls.length,0);
 }
 const f=fixture();const adapter=createM1GoogleCodeExchange({...f.deps,transport:async()=>{throw Error('TOKEN_ENDPOINT_PRIVATE');}});
 assert.equal(await adapter(input),null);
});
test('rejects bad status, redirects, HTML, malformed JSON, oversized response and missing ID token',async()=>{
 const variants=[
  new Response('{"error":"bad"}',{status:400,headers:{'content-type':'application/json'}}),
  new Response('<html>bad</html>',{status:200,headers:{'content-type':'text/html'}}),
  new Response('not-json',{status:200,headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify({id_token:jwt}),{status:200,headers:{'content-type':'application/json','content-length':'999999'}}),
  new Response(JSON.stringify({id_token:jwt,unused:'X'.repeat(20000)}),{status:200,headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify({access_token:'x'}),{status:200,headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify({id_token:'nope'}),{status:200,headers:{'content-type':'application/json'}}),
 ];
 for(const response of variants){const f=fixture();const adapter=createM1GoogleCodeExchange({...f.deps,transport:async()=>response});
  assert.equal(await adapter(input),null);}
});
test('provider configuration is snapshotted before awaited work',async()=>{
 const f=fixture();const adapter=createM1GoogleCodeExchange(f.deps);
 f.deps.clientId='attacker';f.deps.redirectUri='https://evil.example/callback';
 assert.deepEqual(await adapter(input),{idToken:jwt});
 const data=new URLSearchParams(f.calls[0][1].body);
 assert.equal(data.get('client_id'),client);assert.equal(data.get('redirect_uri'),callback);
});

test('Google authorization URL fixes issuer, openid-only scope, PKCE S256, state and nonce',async()=>{
 const {createM1GoogleAuthorizeUrl,M1_GOOGLE_AUTHORIZE_ENDPOINT}=await import('../src/m1-google-oauth-exchange.ts');
 const input={clientId:client,redirectUri:callback,state:'s'.repeat(43),nonce:'n'.repeat(43),codeChallenge:'c'.repeat(43)};
 const url=new URL(createM1GoogleAuthorizeUrl(input));
 assert.equal(url.origin+url.pathname,M1_GOOGLE_AUTHORIZE_ENDPOINT);
 assert.deepEqual([...url.searchParams.keys()].sort(),[
  'response_type','client_id','redirect_uri','scope','state','nonce','code_challenge','code_challenge_method','access_type'
 ].sort());
 assert.equal(url.searchParams.get('response_type'),'code');
 assert.equal(url.searchParams.get('scope'),'openid');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('redirect_uri'),callback);
 assert.equal(url.searchParams.get('access_type'),'online');
 assert.equal(url.toString().includes('client_secret'),false);
 assert.equal(url.toString().includes('code_verifier'),false);
 for(const changes of [{state:'short'},{nonce:'short'},{codeChallenge:'short'},
  {redirectUri:'http://evil.example/callback'},{clientId:'another@evil.test'}]){
   assert.equal(createM1GoogleAuthorizeUrl({...input,...changes}),null);
 }
});

 test('exchange preserves validated code and verifier during secret lookup',async()=>{
 const f=fixture();const request={...input};
 f.deps.readClientSecret=async()=>{request.code='changed';request.verifier='invalid';return 'test-secret-not-a-real-credential';};
 const adapter=createM1GoogleCodeExchange(f.deps);
 assert.deepEqual(await adapter(request),{idToken:jwt});
 const sent=new URLSearchParams(f.calls[0][1].body);
 assert.equal(sent.get('code'),code);assert.equal(sent.get('code_verifier'),verifier);
});
