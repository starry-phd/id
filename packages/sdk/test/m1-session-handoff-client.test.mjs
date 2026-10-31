import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createM1SessionHandoffClient,M1_SESSION_HANDOFF_CLIENT_LIVE,
 parseM1SessionHandoffReturnUrl,
} from '../src/m1-session-handoff-client.ts';
const origin='https://staging.starry.invalid';
const appReturn='https://app.starry.invalid/oauth/complete';
const code='H'.repeat(43);
const bearer='v1.'+'a'.repeat(40)+'.'+'b'.repeat(43);
const now=1793000000;
const response=(body,status=200,headers={})=>new Response(
 typeof body==='string'?body:JSON.stringify(body),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',...headers,
 }},
);
const payload=(extra={})=>({access_token:bearer,token_type:'Bearer',
 expires_at:now+300,...extra});
const returnUrl=(value=code)=>appReturn+'#handoff='+encodeURIComponent(value);
const make=(overrides={})=>{
 let calls=0,last=null,clock=now;
 const client=createM1SessionHandoffClient({
  enabled:true,appId:'starry-id',baseUrl:origin,appReturnUri:appReturn,
  now:()=>clock,
  fetchImpl:async(url,init)=>{
   calls++;last={url,init};
   return response(payload());
  },...overrides,
 });
 return {client,count:()=>calls,last:()=>last,setNow:value=>{clock=value;}};
};
test('M1 handoff client is source-only and OFF by default without network or memory Session',async()=>{
 let calls=0;
 const client=createM1SessionHandoffClient({
  appId:'starry-id',baseUrl:origin,appReturnUri:appReturn,
  fetchImpl:async()=>{calls++;throw Error('PRIVATE_NETWORK');},
 });
 assert.equal(M1_SESSION_HANDOFF_CLIENT_LIVE,false);
 assert.equal(client.live_enabled,false);
 assert.equal(client.source_only,true);
 await assert.rejects(client.acceptReturnUrl(returnUrl()),/M1_HANDOFF_DISABLED/);
 assert.equal(await client.getSessionBearer(),null);
 assert.equal(client.sessionExpiresAt(),null);
 assert.equal(calls,0);
});

test('M1 handoff client pins HTTPS Starry API and exact HTTPS app return URI at construction',()=>{
 for(const cfg of [
  {appId:'echo-starry'},
  {baseUrl:'http://staging.starry.invalid'},
  {baseUrl:'https://user:pw@staging.starry.invalid'},
  {baseUrl:origin+'/v1'},
  {baseUrl:origin+'?token=secret'},
  {appReturnUri:'starryid://oauth/complete'},
  {appReturnUri:'https://app.starry.invalid/oauth/complete?next=https://evil.invalid'},
  {appReturnUri:'https://app.starry.invalid/oauth/complete#handoff=secret'},
  {appReturnUri:'https://app.starry.invalid/'},
 ])assert.throws(()=>make(cfg),/M1_HANDOFF_CONFIG_DENIED/);
});

test('return URL parser accepts exactly one pinned fragment code and rejects query, duplicates, aliases and foreign links',()=>{
 assert.equal(parseM1SessionHandoffReturnUrl(returnUrl(),appReturn),code);
 for(const raw of [
  'https://evil.invalid/oauth/complete#handoff='+code,
  'https://app.starry.invalid/other#handoff='+code,
  appReturn+'?handoff='+code,
  appReturn+'#handoff='+code+'&handoff='+code,
  appReturn+'#handoff='+code+'&member_id=u1',
  appReturn+'#access_token='+encodeURIComponent(bearer),
  appReturn+'#handoff=short',
  appReturn,
 ])assert.throws(()=>parseM1SessionHandoffReturnUrl(raw,appReturn),/M1_HANDOFF_RETURN_URL_DENIED/);
 assert.throws(()=>parseM1SessionHandoffReturnUrl(appReturn+'#error=oauth_failed',appReturn),
  /M1_HANDOFF_OAUTH_FAILED/);
});

test('successful Universal Link exchange POSTs opaque code only and holds bearer in volatile memory',async()=>{
 const {client,count,last}=make();
 const result=await client.acceptReturnUrl(returnUrl());
 assert.deepEqual(result,{expires_at:now+300});
 assert.equal('access_token' in result,false);
 assert.equal(await client.getSessionBearer(),bearer);
 assert.equal(client.sessionExpiresAt(),now+300);
 assert.equal(count(),1);
 const call=last();
 assert.equal(call.url,origin+'/v1/starry-id/sessions/exchange');
 assert.equal(call.init.method,'POST');
 assert.equal(call.init.credentials,'omit');
 assert.equal(call.init.redirect,'error');
 assert.equal(call.init.cache,'no-store');
 assert.equal(call.init.referrerPolicy,'no-referrer');
 assert.deepEqual(JSON.parse(call.init.body),{handoff_code:code});
 assert.equal(call.init.headers.accept,'application/json');
 assert.equal(call.init.headers['content-type'],'application/json');
 assert.equal('authorization' in call.init.headers,false);
 assert.equal('cookie' in call.init.headers,false);
 assert.equal(call.url.includes(code),false);
 client.clearSession();
 assert.equal(await client.getSessionBearer(),null);
 assert.equal(client.sessionExpiresAt(),null);
});

test('expired volatile Session is cleared and a valid new login clears the previous account before exchange',async()=>{
 const {client,setNow}=make();
 await client.acceptReturnUrl(returnUrl());
 setNow(now+300);
 assert.equal(await client.getSessionBearer(),null);
 assert.equal(client.sessionExpiresAt(),null);
 let call=0;
 const switching=createM1SessionHandoffClient({
  enabled:true,appId:'starry-id',baseUrl:origin,appReturnUri:appReturn,
  now:()=>now,
  fetchImpl:async()=>{
   call++;
   return call===1?response(payload()):response({error:{code:'HANDOFF_INVALID'}},401);
  },
 });
 await switching.acceptReturnUrl(returnUrl());
 assert.equal(await switching.getSessionBearer(),bearer);
 await assert.rejects(switching.acceptReturnUrl(returnUrl('N'.repeat(43))),
  /M1_HANDOFF_INVALID/);
 assert.equal(await switching.getSessionBearer(),null);
});

test('handoff client sanitizes network, status, cache, content type, shape and bearer errors',async()=>{
 const cases=[
  {fetchImpl:async()=>{throw Error('PRIVATE_TOKEN_AND_SQL');},code:'M1_HANDOFF_UNAVAILABLE'},
  {fetchImpl:async()=>response('private token',500),code:'M1_HANDOFF_UNAVAILABLE'},
  {fetchImpl:async()=>response({error:'x'},401),code:'M1_HANDOFF_INVALID'},
  {fetchImpl:async()=>response(payload(),200,{'cache-control':'public, max-age=30'}),code:'M1_HANDOFF_RESPONSE_INVALID'},
  {fetchImpl:async()=>response(payload(),200,{'content-type':'text/html'}),code:'M1_HANDOFF_RESPONSE_INVALID'},
  {fetchImpl:async()=>response({...payload(),extra:'secret'}),code:'M1_HANDOFF_RESPONSE_INVALID'},
  {fetchImpl:async()=>response(payload({access_token:'not-a-bearer'})),code:'M1_HANDOFF_RESPONSE_INVALID'},
  {fetchImpl:async()=>response(payload({expires_at:now})),code:'M1_HANDOFF_RESPONSE_INVALID'},
  {fetchImpl:async()=>new Response(new Uint8Array([0xff,0xfe]),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store',
  }}),code:'M1_HANDOFF_RESPONSE_INVALID'},
 ];
 for(const item of cases){
  const {client}=make({fetchImpl:item.fetchImpl});
  await assert.rejects(client.acceptReturnUrl(returnUrl()),error=>{
   assert.equal(error.message,item.code);
   assert.doesNotMatch(error.message,/token|SQL|private|secret/i);
   return true;
  });
 }
});

test('handoff client bounds body, rejects redirects and wrong final URL without accepting a Session',async()=>{
 const tooLarge=new Response(new Uint8Array(1025),{status:200,headers:{
  'content-type':'application/json','cache-control':'no-store',
 }});
 const cases=[
  async()=>tooLarge,
  async()=>{const r=response(payload());Object.defineProperty(r,'redirected',{value:true});return r;},
  async()=>{const r=response(payload());Object.defineProperty(r,'url',{value:'https://evil.invalid/exchange'});return r;},
 ];
 for(const fetchImpl of cases){
  const {client}=make({fetchImpl});
  await assert.rejects(client.acceptReturnUrl(returnUrl()),/M1_HANDOFF_RESPONSE_INVALID/);
  assert.equal(await client.getSessionBearer(),null);
 }
});

test('valid code shape is checked before network; expiry supplier errors never return a bearer',async()=>{
 const {client,count}=make();
 await assert.rejects(client.acceptReturnUrl(returnUrl('short')),/M1_HANDOFF_RETURN_URL_DENIED/);
 assert.equal(count(),0);
 const badClock=make({now:()=>Number.NaN});
 await assert.rejects(badClock.client.acceptReturnUrl(returnUrl()),/M1_HANDOFF_CLOCK_INVALID/);
 assert.equal(await badClock.client.getSessionBearer(),null);
});


test('a late A callback cannot overwrite B Session after account switch, and logout cancels in-flight login',async()=>{
 const pending=[];
 const client=createM1SessionHandoffClient({
  enabled:true,appId:'starry-id',baseUrl:origin,appReturnUri:appReturn,
  now:()=>now,
  fetchImpl:async(url,init)=>new Promise(resolve=>pending.push({resolve,url,init})),
 });
 const a=client.acceptReturnUrl(returnUrl('A'.repeat(43)));
 const b=client.acceptReturnUrl(returnUrl('B'.repeat(43)));
 assert.equal(pending.length,2);
 const tokenB='v1.'+'c'.repeat(40)+'.'+'d'.repeat(43);
 pending[1].resolve(response(payload({access_token:tokenB})));
 await b;
 assert.equal(await client.getSessionBearer(),tokenB);
 pending[0].resolve(response(payload()));
 await assert.rejects(a,/M1_HANDOFF_SUPERSEDED/);
 assert.equal(await client.getSessionBearer(),tokenB,'old A must never replace current B');
 const c=client.acceptReturnUrl(returnUrl('C'.repeat(43)));
 assert.equal(pending.length,3);
 client.clearSession();
 pending[2].resolve(response(payload()));
 await assert.rejects(c,/M1_HANDOFF_SUPERSEDED/);
 assert.equal(await client.getSessionBearer(),null);
 assert.equal(client.sessionExpiresAt(),null);
});

test('throwing clocks and upstream body stream errors are sanitized and cannot disclose credentials',async()=>{
 const brokenClock=make({now:()=>{throw Error('PRIVATE_CLOCK_TOKEN');}});
 await assert.rejects(brokenClock.client.acceptReturnUrl(returnUrl()),error=>{
  assert.equal(error.message,'M1_HANDOFF_CLOCK_INVALID');
  return true;
 });
 const brokenStream=make({fetchImpl:async()=>new Response(new ReadableStream({
  pull(controller){controller.error(Error('PRIVATE_UPSTREAM_TOKEN'));}
 }),{status:200,headers:{
  'content-type':'application/json','cache-control':'no-store',
 }})});
 await assert.rejects(brokenStream.client.acceptReturnUrl(returnUrl()),error=>{
  assert.equal(error.message,'M1_HANDOFF_RESPONSE_INVALID');
  return true;
 });
});
