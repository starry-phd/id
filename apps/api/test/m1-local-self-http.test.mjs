import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1LocalSelfHttp,M1_HTTP_LIVE_ENABLED} from '../src/m1-local-self-http.ts';

const origin='https://staging.starry.invalid';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const valid={s_user_id:'su-123',display_name:null,directory_opt_in:false,
  display_name_public:false,profile_revision:1};
const token='Bearer '+ 'A'.repeat(48);
const make=(input={})=>{
  let calls=0;
  const core={async readSelf(){calls++;return new Response(JSON.stringify(valid),{status:200});}};
  const handler=createM1LocalSelfHttp({scope,expectedOrigin:origin,core,...input});
  return {handler,calls:()=>calls};
};
const get=(path='/v1/starry-id/members/me',headers={authorization:token},method='GET')=>
 new Request(origin+path,{method,headers});

test('M1 platform HTTP is OFF by default despite valid trusted-looking token',async()=>{
  const {handler,calls}=make();
  assert.equal(M1_HTTP_LIVE_ENABLED,false);
  assert.equal(handler.live_enabled,false);
  assert.equal(handler.public_worker_route_registered,false);
  const r=await handler.handle(get());
  assert.equal(r.status,503);assert.equal(calls(),0);
  assert.deepEqual(await r.json(),{error:{code:'FEATURE_DISABLED'}});
});
test('M1 explicit local staging dispatch only delegates to reviewed AI1 readSelf port',async()=>{
  const {handler,calls}=make({enabled:true});
  const r=await handler.handle(get());
  assert.equal(r.status,200);assert.equal(calls(),1);
  assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(await r.json(),valid);
});
test('M1 local transport never dispatches on foreign env, brand or app',async()=>{
 for(const e of ['development','production','preview']){
   if(e==='development'){
    const {handler,calls}=make({enabled:true,scope:{...scope,environment:e}});
    assert.equal((await handler.handle(get())).status,503);assert.equal(calls(),0);
   }else assert.throws(()=>make({enabled:true,scope:{...scope,environment:e}}));
 }
 for(const wrong of [{...scope,brand_id:'hglobal'},{...scope,app_id:'echo-starry'}])
   assert.throws(()=>make({enabled:true,scope:wrong}));
});
test('M1 local HTTP rejects alias, method, query, host, credential forwarding, missing bearer before DB',async()=>{
 const {handler,calls}=make({enabled:true});
 for(const request of [
   get('/v1/profile'),get('/v1/member/self'),
   get('/v1/starry-id/members/me?q=1'),
   get('/v1/starry-id/members/me',{authorization:token},'POST'),
   get('/v1/starry-id/members/me',{}),
   get('/v1/starry-id/members/me',{authorization:'Bearer bad'}),
   get('/v1/starry-id/members/me',{authorization:token,cookie:'sid=xx'}),
   get('/v1/starry-id/members/me',{authorization:token,'proxy-authorization':'Basic x'}),
   get('/v1/starry-id/members/me',{authorization:token,'x-forwarded-user':'admin'}),
   get('/v1/starry-id/members/me',{authorization:token,origin:'https://attacker.invalid'}),
   get('/v1/starry-id/members/me',{authorization:token,host:'attacker.invalid'}),
   new Request('https://other.invalid/v1/starry-id/members/me',{headers:{authorization:token}}),
 ]){const response=await handler.handle(request);assert.notEqual(response.status,200);}
 assert.equal(calls(),0);
});
test('M1 local port response fail closed: raw SQL errors, extra keys, invalid DTO, revoke/status',async()=>{
 for(const failure of [
   {async readSelf(){throw Error('PRIVATE_SQL_secret');}},
   {async readSelf(){return new Response(JSON.stringify({...valid,email:'bad@example.invalid'}),{status:200});}},
   {async readSelf(){return new Response(JSON.stringify({...valid,profile_revision:'1'}),{status:200});}},
   {async readSelf(){return new Response(JSON.stringify({error:'sensitive'}),{status:200});}},
   {async readSelf(){return new Response('PRIVATE_SQL_SECRET',{status:500});}},
   {async readSelf(){return new Response('revoked',{status:401});}},
 ]) {
   const {handler}=make({enabled:true,core:failure});
   const r=await handler.handle(get());assert.notEqual(r.status,200);
   const body=await r.text();
   assert.doesNotMatch(body,/PRIVATE_SQL|sensitive|email|secret/i);
   assert.equal(r.headers.get('cache-control'),'no-store');
 }
});
test('M1 TLS origin and userinfo strict before any auth adapter registration',()=>{
 for(const expectedOrigin of [
  'http://staging.starry.invalid','https://user:pwd@staging.starry.invalid',
  'https://staging.starry.invalid/path','https://staging.starry.invalid/?x=1',
 ])assert.throws(()=>make({expectedOrigin}));
});
