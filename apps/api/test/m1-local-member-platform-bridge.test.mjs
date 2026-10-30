import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadableStream} from 'node:stream/web';
import {URL} from 'node:url';
import {
 createM2DeletionRequestClient,M2DeletionClientError,
} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';
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
test('M1 bridge preserves AI1 PATCH/logout HTTP 400, whitelists known codes, never echoes private error bodies',async()=>{
 const cases=[
  {method:'PATCH',path:self,upstreamCode:'PROFILE_FIELDS_DENIED',expected:'PROFILE_FIELDS_DENIED'},
  {method:'PATCH',path:self,upstreamCode:'REQUEST_DENIED',expected:'REQUEST_DENIED'},
  {method:'POST',path:logout,upstreamCode:'REQUEST_DENIED',expected:'REQUEST_DENIED'},
 ];
 for(const {method,path,upstreamCode,expected} of cases){
  const {bridge}=make({enabled:true,mutationPort:{async handle(){
   return new Response(JSON.stringify({error:{code:upstreamCode}}),{
    status:400,headers:{'content-type':'application/json','cache-control':'no-store'},
   });
  }}});
  const result=await bridge.handle(req(path,method,
   method==='PATCH'?{'if-match':'"rev-1"','content-type':'application/json'}:{},
   method==='PATCH'?'{"s_user_id":"forbidden"}':undefined));
  assert.equal(result.status,400);
  assert.deepEqual(await result.json(),{error:{code:expected}});
  assert.equal(result.headers.get('cache-control'),'no-store');
 }
 for(const response of [
  new Response('PRIVATE_SQL_STACK',{status:400}),
  new Response(JSON.stringify({error:{code:'PRIVATE_SQL_STACK',secret:'Bearer private'}}),{
   status:400,headers:{'content-type':'application/json','cache-control':'no-store'},
  }),
  new Response(JSON.stringify({error:{code:'PROFILE_FIELDS_DENIED'},token:'PRIVATE_BEARER'}),{
   status:400,headers:{'content-type':'application/json','cache-control':'no-store'},
  }),
  new Response(JSON.stringify({error:{code:'PROFILE_FIELDS_DENIED'}}),{
   status:400,headers:{'content-type':'application/json','cache-control':'public'},
  }),
 ]){
  const {bridge}=make({enabled:true,mutationPort:{async handle(){return response;}}});
  const result=await bridge.handle(req(self,'PATCH',
   {'if-match':'"rev-1"','content-type':'application/json'},'{}'));
  assert.equal(result.status,400);
  const text=await result.text();
  assert.deepEqual(JSON.parse(text),{error:{code:'REQUEST_DENIED'}});
  assert.doesNotMatch(text,/PRIVATE|SQL|BEARER|PROFILE_FIELDS_DENIED/);
 }
 const {bridge}=make({enabled:true,readPort:{async handle(){
  return new Response('PRIVATE_SOURCE',{status:400});
 }}});
 const deniedRead=await bridge.handle(req(self));
 assert.equal(deniedRead.status,503);
 assert.doesNotMatch(await deniedRead.text(),/PRIVATE_SOURCE/);
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


// Regression: original #281 bridge returned router 404 on all three already
// merged #291 deletion routes; #293 typed SDK treats HTML/router 404 as a
// broken route, not NO_REQUEST. This checks a NEW cross-component behavior,
// not another duplicate default-OFF assertion.
const deletionId='m2del-'+'a'.repeat(48);
const firstReceipt=Object.freeze({
 request_id:deletionId,status:'awaiting_second_confirmation',
 first_confirmed_at:1793000000,second_confirmed_at:null,
 physical_erasure_completed:false,execution_authorized:false,
});
const secondReceipt=Object.freeze({
 ...firstReceipt,status:'pending_processing',
 second_confirmed_at:1793000002,
});
const deletionPaths=[
 '/v1/starry-id/members/me/deletion-requests',
 '/v1/starry-id/members/me/deletion-requests/confirm',
 '/v1/starry-id/members/me/deletion-requests/status',
];
function json(value,status){
 return new Response(JSON.stringify(value),{status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'private, no-store',
 }});
}
test('M1 bridge requires explicit AI1 deletion port; missing port is 503, never misleading NO_REQUEST 404',async()=>{
 const {bridge,calls}=make({enabled:true});
 for(const [i,path] of deletionPaths.entries()){
  const method=i===2?'GET':'POST';
  const response=await bridge.handle(req(path,method,
   method==='POST'?{'content-type':'application/json'}:{},
   method==='POST'?'{}':undefined));
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:{code:'FEATURE_DISABLED'}});
 }
 assert.equal(calls.length,0);
});
test('AI4 bridge routes merged #291 three deletion endpoints into exact #293 typed client without duplicate Auth',async()=>{
 const calls=[];let receipt=null;
 const port={async handle(request){
  const path=new URL(request.url).pathname;
  calls.push({path,method:request.method,bearer:request.headers.get('authorization')});
  if(path===deletionPaths[2])
   return receipt?json(receipt,200):json({error:{code:'NO_REQUEST'}},404);
  const body=await request.json();
  if(path===deletionPaths[0]){
   assert.deepEqual(body,{confirmation:'REQUEST_MY_ACCOUNT_DELETION'});
   receipt=firstReceipt;
   return json(receipt,202);
  }
  assert.deepEqual(body,{confirmation:'CONFIRM_MY_ACCOUNT_DELETION',request_id:deletionId});
  receipt=secondReceipt;
  return json(receipt,202);
 }};
 const {bridge}=make({enabled:true,deletionPort:port});
 const client=createM2DeletionRequestClient({
  enabled:true,appId:'starry-id',environment:'staging',
  baseUrl:origin,getSessionBearer:async()=>bearer.slice(7),
  fetchImpl:async (url,init)=>bridge.handle(new Request(url,init)),
 });
 assert.equal(await client.getStatus(),null);
 assert.deepEqual(await client.requestDeletion(),firstReceipt);
 assert.deepEqual(await client.getStatus(),firstReceipt);
 assert.deepEqual(await client.confirmDeletion(deletionId),secondReceipt);
 assert.deepEqual(await client.getStatus(),secondReceipt);
 assert.deepEqual(calls.map(c=>[c.path,c.method]),[
  [deletionPaths[2],'GET'],[deletionPaths[0],'POST'],
  [deletionPaths[2],'GET'],[deletionPaths[1],'POST'],[deletionPaths[2],'GET'],
 ]);
 assert.ok(calls.every(c=>c.bearer===bearer));
 // The upstream is not given authority to promise physical erasure.
 assert.equal(secondReceipt.physical_erasure_completed,false);
 assert.equal(secondReceipt.execution_authorized,false);
});
test('AI4 deletion routes fail closed on bogus method, host, aliases and forwarded identity before AI1 port',async()=>{
 const calls=[];
 const port={async handle(r){calls.push(r);return json(firstReceipt,202);}};
 const {bridge}=make({enabled:true,deletionPort:port});
 for(const r of [
  req(deletionPaths[0],'GET'),req(deletionPaths[1],'PATCH'),
  req(deletionPaths[2],'POST',{'content-type':'application/json'},'{}'),
  req(deletionPaths[0]+'/anything','POST',{'content-type':'application/json'},'{}'),
  req(deletionPaths[2]+'?member=u2'),
  req(deletionPaths[2],'GET',{'x-forwarded-host':'evil.invalid'}),
  req(deletionPaths[0],'POST',{cookie:'session=not-allowed'}),
  req(deletionPaths[2],'GET',{host:'evil.invalid'}),
 ]){
  const out=await bridge.handle(r);
  assert.notEqual(out.status,200);
  assert.notEqual(out.status,202);
  assert.equal(out.headers.get('cache-control'),'no-store');
 }
 assert.equal(calls.length,0);
});
test('AI4 deletion response guard refuses raw error, cacheable/HTML 404, extra keys, physical erased claim and bad JSON',async()=>{
 const invalid=[
  json({error:{code:'NOT_FOUND'}},404),
  json({error:{code:'NO_REQUEST',private:'SENSITIVE'}},404),
  new Response('<html>not found</html>',{status:404,headers:{'content-type':'text/html'}}),
  new Response(JSON.stringify({error:{code:'NO_REQUEST'}}),
   {status:404,headers:{'content-type':'application/json'}}),
  json({...firstReceipt,email:'PRIVATE_EMAIL'},200),
  json({...firstReceipt,physical_erasure_completed:true},200),
  json({...firstReceipt,execution_authorized:true},200),
  json({...firstReceipt,request_id:'PRIVATE_EMAIL'},200),
  json({...firstReceipt,second_confirmed_at:1793000000},200),
  json({...secondReceipt,second_confirmed_at:1792999999},200),
  json(firstReceipt,202),
  json({error:{code:'NO_REQUEST'}},200),
  json(firstReceipt,404),
  new Response('PRIVATE_SQL_ERROR',{status:500}),
  new Response('x'.repeat(4097),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store',
  }}),
 ];
 for(const reply of invalid){
  const {bridge}=make({enabled:true,deletionPort:{
   async handle(){return reply;},
  }});
  const out=await bridge.handle(req(deletionPaths[2]));
  assert.equal(out.status,503);
  const body=await out.text();
  assert.doesNotMatch(body,/PRIVATE|EMAIL|SQL|s_user_id|m2del-/i);
  assert.equal(out.headers.get('cache-control'),'no-store');
 }
});
test('AI4 deletion status exact NO_REQUEST 404 is preserved; other path 404 remains an SDK error',async()=>{
 const good={error:{code:'NO_REQUEST'}};
 const {bridge}=make({enabled:true,deletionPort:{
  async handle(){return json(good,404);},
 }});
 const r=await bridge.handle(req(deletionPaths[2]));
 assert.equal(r.status,404);
 assert.deepEqual(await r.json(),good);
 const c=createM2DeletionRequestClient({
  enabled:true,appId:'starry-id',environment:'staging',baseUrl:origin,
  getSessionBearer:async()=>bearer.slice(7),
  fetchImpl:async(url,init)=>bridge.handle(new Request(url,init)),
 });
 assert.equal(await c.getStatus(),null);
 await assert.rejects(()=>c.requestDeletion(),
  e=>e instanceof M2DeletionClientError&&e.code==='NO_REQUEST');
});
test('AI4 deletion confirm never accepts awaiting status or elevated erasure claims',async()=>{
 for(const reply of [firstReceipt,{...secondReceipt,physical_erasure_completed:true},
  {...secondReceipt,execution_authorized:true}]){
  const {bridge}=make({enabled:true,deletionPort:{
   async handle(){return json(reply,202);},
  }});
  const response=await bridge.handle(req(deletionPaths[1],'POST',
   {'content-type':'application/json'},'{}'));
  assert.equal(response.status,503);
 }
});
