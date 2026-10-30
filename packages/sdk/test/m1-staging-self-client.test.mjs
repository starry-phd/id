import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1StagingSelfClient,M1_STAGING_SELF_SDK_LIVE}
 from '../src/m1-staging-self-client.ts';
const origin='https://staging.starry.invalid';
const dto={s_user_id:'su-123',display_name:'Testing Only',
 directory_opt_in:false,display_name_public:false,profile_revision:2};
const make=(overrides={})=>{
 let count=0,request;
 const c=createM1StagingSelfClient({
  baseUrl:origin,appId:'starry-id',
  getSessionBearer:async()=> 'a'.repeat(48),
  fetchImpl:async(url,init)=>{
   count++;request={url,init};
   return new Response(JSON.stringify(dto),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
  },...overrides,
 });
 return {client:c,count:()=>count,request:()=>request};
};
test('M1 SDK is source-only and off by default; no token or HTTP read',async()=>{
 const {client,count}=make();
 assert.equal(M1_STAGING_SELF_SDK_LIVE,false);
 assert.equal(client.live_enabled,false);
 await assert.rejects(client.getSelf(),/STARRY_SELF_DISABLED/);
 assert.equal(count(),0);
});
test('M1 SDK explicit local fixture: exact five fields, HTTPS origin, no cookies/redirect',async()=>{
 const {client,count,request}=make({enabled:true});
 assert.deepEqual(await client.getSelf(),dto);
 assert.equal(count(),1);
 assert.equal(request().url,origin+'/v1/starry-id/members/me');
 assert.equal(request().init.credentials,'omit');
 assert.equal(request().init.redirect,'error');
 assert.equal(request().init.cache,'no-store');
 assert.equal(request().init.headers.authorization,'Bearer '+'a'.repeat(48));
});
test('M1 SDK no bearer, foreign base, HTTP, userinfo, path/query always fail closed',async()=>{
 for(const input of [
  {baseUrl:'http://staging.starry.invalid'},
  {baseUrl:'https://bad:secret@staging.starry.invalid'},
  {baseUrl:origin+'/other'},
  {baseUrl:origin+'?x=1'},
  {appId:'echo-starry'},
 ])assert.throws(()=>make(input));
 for(const bearer of [null,'short','Bearer '+ 'a'.repeat(48)]){
  const {client,count}=make({enabled:true,getSessionBearer:async()=>bearer});
  await assert.rejects(client.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
  assert.equal(count(),0);
 }
});
test('M1 SDK refuses raw invalid/error/extra-field responses without leaking secrets',async()=>{
 for(const response of [
  new Response('SQL secret token',{status:500}),
  new Response(JSON.stringify({...dto,email:'test@example.invalid'}),{status:200,headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify({...dto,directory_opt_in:1}),{status:200,headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify(dto),{status:200,headers:{'content-type':'text/html'}}),
  new Response('token leaked',{status:401}),
  new Response('db error',{status:403}),
 ]) {
  const {client}=make({enabled:true,fetchImpl:async()=>response});
  await assert.rejects(client.getSelf(),error=>{
   assert.match(error.message,/^STARRY_SELF_/);
   assert.doesNotMatch(error.message,/token|SQL|email|db error/i);
   return true;
  });
 }
});


test('M1 SDK sanitizes exceptions from Auth credential supplier without fetching',async()=>{
 const {client,count}=make({enabled:true,getSessionBearer:async()=>{throw Error('PRIVATE_SESSION_AND_PROVIDER_TOKEN');}});
 await assert.rejects(client.getSelf(),e=>{
  assert.equal(e.message,'STARRY_SELF_SESSION_REQUIRED');
  return true;
 });
 assert.equal(count(),0);
});
test('M1 SDK rejects redirected, wrong final origin, cacheable or ambiguous content-type responses',async()=>{
 for(const alter of [
  r=>Object.defineProperty(r,'redirected',{value:true}),
  r=>Object.defineProperty(r,'url',{value:'https://other.invalid/v1/starry-id/members/me'}),
  r=>r.headers.set('cache-control','public, max-age=60'),
  r=>r.headers.set('cache-control','no-cache'),
  r=>r.headers.set('content-type','application/jsonp'),
  r=>r.headers.set('content-type','application/json; charset=iso-8859-1'),
 ]) {
  const r=new Response(JSON.stringify(dto),{status:200,headers:{
   'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  alter(r);
  const {client}=make({enabled:true,fetchImpl:async()=>r});
  await assert.rejects(client.getSelf(),/STARRY_SELF_RESPONSE_INVALID/);
 }
});
test('M1 SDK rejects oversized, malformed-UTF8 and out-of-range five-field payloads',async()=>{
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const cases=[
  new Response(JSON.stringify(dto),{status:200,headers:{...headers,'content-length':'4097'}}),
  new Response(new Uint8Array([0xff,0xfe,0xfd]),{status:200,headers}),
  new Response(JSON.stringify({...dto,profile_revision:Number.MAX_SAFE_INTEGER}),{status:200,headers}),
  new Response(JSON.stringify({...dto,extra_field:'private'}),{status:200,headers}),
 ];
 for(const response of cases) {
  const {client}=make({enabled:true,fetchImpl:async()=>response});
  await assert.rejects(client.getSelf(),/STARRY_SELF_RESPONSE_INVALID/);
 }
 let cancelled=false;
 const stream=new ReadableStream({
  start(c){c.enqueue(new Uint8Array(4097));},
  cancel(){cancelled=true;},
 });
 const {client}=make({enabled:true,fetchImpl:async()=>
  new Response(stream,{status:200,headers})});
 await assert.rejects(client.getSelf(),/STARRY_SELF_RESPONSE_INVALID/);
 assert.equal(cancelled,true);
});
test('M1 SDK accepts exact contract UTF-8 response with no-store, no redirect',async()=>{
 const {client}=make({enabled:true,fetchImpl:async()=>
  new Response(JSON.stringify(dto),{status:200,headers:{
   'content-type':'application/json; charset=utf-8',
   'cache-control':'private, no-store',
  }})});
 assert.deepEqual(await client.getSelf(),dto);
});
