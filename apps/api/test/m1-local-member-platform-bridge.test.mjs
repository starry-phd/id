import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadableStream} from 'node:stream/web';
import {createM1LocalMemberPlatformBridge,M1_LOCAL_MEMBER_BRIDGE_LIVE}
 from '../src/m1-local-member-platform-bridge.ts';

const origin='https://staging.starry.invalid';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const bearer='Bearer v1.'+'a'.repeat(48)+'.'+'b'.repeat(43);
const dto={s_user_id:'su-123',display_name:'Local test',
 directory_opt_in:false,display_name_public:false,profile_revision:2};
const ok=()=>new Response(JSON.stringify(dto),{status:200,headers:{
 'content-type':'application/json; charset=utf-8',
 'cache-control':'private, no-store',
}});
const req=(path,method='GET',headers={},body)=>
 new Request(origin+path,{method,headers:{authorization:bearer,...headers},body});
const make=(changes={})=>{
 const calls=[];
 const readPort={async handle(r){calls.push(['read',r]);return ok();}};
 const mutationPort={async handle(r){calls.push(['mutation',r]);
  return r.method==='PATCH'?ok():new Response(null,{status:204,headers:{
   'cache-control':'no-store',
  }});
 }};
 return {calls,bridge:createM1LocalMemberPlatformBridge({
  scope,expectedOrigin:origin,readPort,mutationPort,...changes,
 })};
};
const self='/v1/starry-id/members/me';
const logout='/v1/starry-id/sessions/logout';

test('M1 bridge is source-only default OFF and never calls Auth ports',async()=>{
 const {calls,bridge}=make();
 assert.equal(M1_LOCAL_MEMBER_BRIDGE_LIVE,false);
 assert.equal(bridge.live_enabled,false);
 assert.equal(bridge.public_worker_route_registered,false);
 const r=await bridge.handle(req(self));
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{error:{code:'FEATURE_DISABLED'}});
 assert.equal(calls.length,0);
});
test('M1 bridge local staging forwards original GET, PATCH CAS and logout requests to respective AI1 ports',async()=>{
 const {calls,bridge}=make({enabled:true});
 const a=req(self),b=req(self,'PATCH',{'content-type':'application/json','if-match':'"rev-1"'},JSON.stringify({display_name:'Local test'}));
 const c=req(logout,'POST');
 assert.deepEqual(await (await bridge.handle(a)).json(),dto);
 assert.deepEqual(await (await bridge.handle(b)).json(),dto);
 const revoked=await bridge.handle(c);
 assert.equal(revoked.status,204);
 assert.equal(await revoked.text(),'');
 assert.equal(revoked.headers.get('cache-control'),'no-store');
 assert.deepEqual(calls.map(x=>x[0]),['read','mutation','mutation']);
 assert.equal(calls[0][1],a);
 assert.equal(calls[1][1],b);
 assert.equal(calls[2][1],c);
 assert.equal(calls[1][1].headers.get('if-match'),'"rev-1"');
});
test('M1 bridge refuses origin, method, aliases, query, forwarded credentials and environment before Auth',async()=>{
 const {calls,bridge}=make({enabled:true});
 const requests=[
  req('/v1/profile'),req('/v1/admin'),req(self+'?probe=1'),
  req(self,'PUT'),req(logout,'GET'),
  req(self,'GET',{cookie:'sid=1'}),
  req(self,'GET',{'proxy-authorization':'Basic attacker'}),
  req(self,'GET',{'x-forwarded-authorization':'Bearer evil'}),
  req(self,'GET',{'x-forwarded-user':'admin'}),
  req(self,'GET',{'x-forwarded-host':'evil.invalid'}),
  req(self,'GET',{origin:'https://evil.invalid'}),
  req(self,'GET',{host:'evil.invalid'}),
  req(self,'GET',{authorization:'Bearer not-valid'}),
  new Request('https://evil.invalid'+self,{headers:{authorization:bearer}}),
 ];
 for(const r of requests){
  const out=await bridge.handle(r);
  assert.notEqual(out.status,200);
  assert.equal(out.headers.get('cache-control'),'no-store');
 }
 assert.equal(calls.length,0);
 for(const env of ['development','production','preview']){
  if(env==='development'){
   const {bridge:dev,calls:dc}=make({enabled:true,scope:{...scope,environment:env}});
   assert.equal((await dev.handle(req(self))).status,503);
   assert.equal(dc.length,0);
  }else{
   assert.throws(()=>make({enabled:true,scope:{...scope,environment:env}}));
  }
 }
 for(const sc of [{...scope,brand_id:'hglobal'},{...scope,app_id:'echo-starry'}])
  assert.throws(()=>make({scope:sc}));
 for(const expectedOrigin of ['http://staging.starry.invalid',
  'https://bad:secret@staging.starry.invalid',origin+'/other',origin+'?a=1'])
  assert.throws(()=>make({expectedOrigin}));
});
test('M1 bridge sanitizes upstream errors, unexpected replies and private fields',async()=>{
 const bad=[
  [new Response(JSON.stringify({...dto,email:'private@example.invalid'}),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store'}}),503],
  [new Response(JSON.stringify(dto),{status:200,headers:{
   'content-type':'application/json','cache-control':'public'}}),503],
  [new Response(JSON.stringify(dto),{status:200,headers:{
   'content-type':'text/html','cache-control':'no-store'}}),503],
  [new Response(JSON.stringify(dto),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store','content-length':'5000'}}),503],
  [new Response(JSON.stringify({...dto,profile_revision:Number.MAX_SAFE_INTEGER}),{
   status:200,headers:{'content-type':'application/json','cache-control':'no-store'}}),503],
  [new Response('PRIVATE_SQL_ERROR',{status:500}),503],
  [new Response('PRIVATE_PROVIDER',{status:401}),401],
  [new Response('PRIVATE_SQL',{status:409}),409],
  [new Response('PRIVATE_DATA',{status:428}),428],
 ];
 for(const [upstream,status] of bad){
  const {bridge}=make({enabled:true,mutationPort:{async handle(){return upstream;}}});
  const r=await bridge.handle(req(self,'PATCH',{'if-match':'"rev-1"','content-type':'application/json'},'{}'));
  assert.equal(r.status,status);
  assert.doesNotMatch(await r.text(),/PRIVATE|email|SQL|PROVIDER|s_user_id/i);
 }
 const {bridge}=make({enabled:true,readPort:{async handle(){throw Error('PRIVATE_KEY_AND_SQL');}}});
 const failed=await bridge.handle(req(self));
 assert.equal(failed.status,503);
 assert.doesNotMatch(await failed.text(),/PRIVATE|SQL|KEY/);
});
test('M1 bridge accepts logout ONLY as zero-body 204, rejects forged 200/204 bodies',async()=>{
 for(const response of [
  ok(),new Response(JSON.stringify({ok:true}),{status:200}),
  Object.defineProperty(new Response(null,{status:204}),'body',{value:new ReadableStream()}),
 ]){
  const {bridge}=make({enabled:true,mutationPort:{async handle(){return response;}}});
  const r=await bridge.handle(req(logout,'POST'));
  assert.equal(r.status,503);
 }
});
test('M1 bridge fails closed on streamed oversized profile even when length unreported',async()=>{
 let cancelled=false;
 const stream=new ReadableStream({
  start(ctrl){ctrl.enqueue(new Uint8Array(4097));},
  cancel(){cancelled=true;},
 });
 const {bridge}=make({enabled:true,readPort:{async handle(){return new Response(stream,{
  status:200,headers:{'content-type':'application/json','cache-control':'no-store'},
 });}}});
 assert.equal((await bridge.handle(req(self))).status,503);
 assert.equal(cancelled,true);
});
