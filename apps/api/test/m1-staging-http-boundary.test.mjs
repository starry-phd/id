import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createM1StagingHttpBoundary,M1_STAGING_HTTP_ROUTE_LIVE}
 from '../src/m1-staging-http-boundary.ts';

const origin='https://staging.starry.invalid';
const app='https://app.starry.invalid/oauth/complete';
const paths={
 start:'/v1/starry-id/oauth/google/start',
 callback:'/v1/starry-id/oauth/google/callback',
 exchange:'/v1/starry-id/sessions/exchange',
 self:'/v1/starry-id/members/me',
 logout:'/v1/starry-id/sessions/logout',
 first:'/v1/starry-id/members/me/deletion-requests',
 confirm:'/v1/starry-id/members/me/deletion-requests/confirm',
 status:'/v1/starry-id/members/me/deletion-requests/status',
};
const ok=()=>new Response(JSON.stringify({kind:'test-only'}),{
 status:200,headers:{'content-type':'application/json','cache-control':'no-store'},
});
function make(changes={}){
 const calls=[];
 const auth={
  contract:'starry.ai0.m1.staging-access-keyring-single-auth.v1',
  source_only:true,live_enabled:false,public_worker_route_registered:false,
  async handleOAuthStart(req){calls.push(['start',req.method]);return ok();},
  async handleOAuthCallback(req){calls.push(['callback',req.method]);return ok();},
  async handleSessionExchange(req){calls.push(['exchange',req.method]);return ok();},
  async handleMember(req){calls.push(['member',req.method,
   new globalThis.URL(req.url).pathname]);return ok();},
  ...changes.auth,
 };
 const router=createM1StagingHttpBoundary({
  enabled:true,appId:'starry-id',environment:'staging',
  expectedOrigin:origin,appReturnUri:app,auth,...changes.config,
 });
 return {router,calls,auth};
}
const req=(path,method='GET',headers)=>new Request(origin+path,{method,headers});
test('default OFF routing never exposes even authorized member or OAuth endpoints',async()=>{
 const {router,calls}=make({config:{enabled:undefined}});
 assert.equal(M1_STAGING_HTTP_ROUTE_LIVE,false);
 assert.equal(router.live_enabled,false);
 assert.equal(router.source_only,true);
 assert.equal(router.public_worker_route_registered,false);
 for(const name of Object.keys(paths)){
  const result=await router.handle(req(paths[name]));
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{error:{code:'FEATURE_DISABLED'}});
 }
 assert.deepEqual(calls,[]);
 const missing=createM1StagingHttpBoundary({
  appId:'starry-id',environment:'staging',
  expectedOrigin:origin,appReturnUri:app,
 });
 assert.equal((await missing.handle(req(paths.start))).status,503);
});
test('one signed Auth composition dispatches ONLY the exact reviewed eight paths',async()=>{
 const {router,calls}=make();
 const expected=[
  [paths.start,'GET','start'],
  [paths.callback+'?code=opaque&state=nonce','GET','callback'],
  [paths.exchange,'POST','exchange'],
  [paths.self,'GET','member'],
  [paths.self,'PATCH','member'],
  [paths.logout,'POST','member'],
  [paths.first,'POST','member'],
  [paths.confirm,'POST','member'],
  [paths.status,'GET','member'],
 ];
 for(const [path,method] of expected){
  assert.equal((await router.handle(req(path,method))).status,200);
 }
 assert.deepEqual(calls.map(x=>x[0]),expected.map(x=>x[2]));
 assert.deepEqual(calls.slice(0,3),[
  ['start','GET'],['callback','GET'],['exchange','POST'],
 ]);
 assert.equal(calls[3][2],paths.self);
 assert.equal(calls.at(-1)[2],paths.status);
});
test('unknown routes, alternate brand, fake host and untrusted forwarded authority fail BEFORE Auth',async()=>{
 const {router,calls}=make();
 for(const path of ['/v1/health','/v1/staging/debug','/admin',
  '/v1/hglobal/members/me',paths.self+'/../../admin',
  '//evil.invalid/v1/starry-id/members/me']){
  assert.equal((await router.handle(req(path))).status,404);
 }
 for(const request of [
  new Request('https://echo.invalid'+paths.self),
  req(paths.self,'GET',{'host':'evil.invalid'}),
  req(paths.self,'GET',{'x-forwarded-host':'evil.invalid'}),
  req(paths.self,'GET',{'forwarded':'host=evil.invalid'}),
 ]){
  assert.equal((await router.handle(request)).status,404);
 }
 assert.deepEqual(calls,[]);
});
test('wrong verbs deny without reaching any Auth callbacks or D1',async()=>{
 const {router,calls}=make();
 for(const [path,method,allow] of [
  [paths.start,'POST','GET'],[paths.callback,'POST','GET'],
  [paths.exchange,'GET','POST'],[paths.self,'POST','GET, PATCH'],
  [paths.logout,'GET','POST'],[paths.status,'POST','GET'],
  [paths.first,'GET','POST'],[paths.confirm,'GET','POST'],
 ]){
  const response=await router.handle(req(path,method));
  assert.equal(response.status,405,path);
  assert.equal(response.headers.get('allow'),allow);
 }
 assert.deepEqual(calls,[]);
});
test('query and URL fragment injections deny before member, exchange or Google start',async()=>{
 const {router,calls}=make();
 for(const path of [
  paths.start+'?scope=profile',
  paths.self+'?s_user_id=other',
  paths.exchange+'?handoff=secret',
  paths.logout+'#access_token=PRIVATE',
  paths.first+'?delete_forever=1',
  paths.callback+'#test_fragment',
 ]){
  assert.equal((await router.handle(req(path))).status,400);
 }
 assert.deepEqual(calls,[]);
});
test('response must be no-store; errors, upstream redirects and exceptions fail sanitized',async()=>{
 for(const bad of [
  new Response('PRIVATE_UPSTREAM_TOKEN',{status:200}),
  new Response('PRIVATE_UPSTREAM_TOKEN',{status:200,headers:{'cache-control':'public'}}),
  new Response(null,{status:302,headers:{'cache-control':'no-store','location':'https://evil.invalid'}}),
 ]){
  const {router}=make({auth:{handleMember:async()=>bad}});
  const result=await router.handle(req(paths.self));
  assert.equal(result.status,503);
  assert.doesNotMatch(await result.text(),/PRIVATE_UPSTREAM_TOKEN/);
  assert.equal(result.headers.get('cache-control'),'no-store');
 }
 const {router}=make({auth:{handleMember:async()=>{throw Error('PRIVATE_D1_TOKEN');}}});
 const failure=await router.handle(req(paths.self));
 assert.equal(failure.status,503);
 assert.doesNotMatch(await failure.text(),/PRIVATE_D1_TOKEN/);
});
test('Google and app redirects are pinned and are never reflected from request input',async()=>{
 const sampleGoogle='https://accounts.google.com/o/oauth2/v2/auth?'+
  'response_type=code&state='+'s'.repeat(43)+'&code_challenge_method=S256';
 const goodStart=make({auth:{handleOAuthStart:async()=>new Response(null,{
  status:303,headers:{location:sampleGoogle,'cache-control':'no-store'},
 })}});
 const good=(await goodStart.router.handle(req(paths.start)));
 assert.equal(good.status,303);
 assert.equal(good.headers.get('location'),sampleGoogle);
 const handoff=app+'#handoff='+'x'.repeat(43);
 const goodCallback=make({auth:{handleOAuthCallback:async()=>new Response(null,{
  status:303,headers:{location:handoff,'cache-control':'no-store'},
 })}});
 assert.equal((await goodCallback.router.handle(req(paths.callback))).status,303);
 for(const redirect of [
  'http://accounts.google.com/o/oauth2/v2/auth',
  'https://evil.invalid/?code=secret',
  'https://accounts.google.com.evil.invalid/o/oauth2/v2/auth',
  'https://accounts.google.com/o/oauth2/v2/auth?state=x',
 ]){
  const {router}=make({auth:{handleOAuthStart:async()=>new Response(null,{
   status:303,headers:{location:redirect,'cache-control':'no-store'},
  })}});
  assert.equal((await router.handle(req(paths.start))).status,503);
 }
 for(const redirect of [
  'https://app.starry.invalid.evil.invalid/oauth/complete#handoff='+'x'.repeat(43),
  app+'#access_token=PRIVATE',
  app+'?bearer=PRIVATE#handoff='+'x'.repeat(43),
 ]){
  const {router}=make({auth:{handleOAuthCallback:async()=>new Response(null,{
   status:303,headers:{location:redirect,'cache-control':'no-store'},
  })}});
  assert.equal((await router.handle(req(paths.callback))).status,503);
 }
});
test('reject non-Starry scope, unsafe origins and injected fake composition at build time',()=>{
 for(const changes of [
  {config:{appId:'echo-starry'}},
  {config:{environment:'production'}},
  {config:{enabled:'yes'}},
  {config:{expectedOrigin:'http://staging.starry.invalid'}},
  {config:{expectedOrigin:'https://evil.invalid/path'}},
  {config:{expectedOrigin:'https://name@staging.starry.invalid'}},
  {config:{appReturnUri:'starry-id-dev://callback'}},
  {config:{appReturnUri:origin+'/oauth/complete'}},
  {auth:{contract:'custom-bypass'}},
  {auth:{source_only:false}},
  {auth:{live_enabled:true}},
  {auth:{public_worker_route_registered:true}},
  {auth:{handleMember:undefined}},
 ]){
  assert.throws(()=>make(changes),
   /M1_STAGING_HTTP_CONFIGURATION_DENIED|M1_STAGING_HTTP_AUTH_BOUNDARY_DENIED/);
 }
});
test('public Worker and wrangler remain original health-only source; no staging route mounted',()=>{
 const index=readFileSync(fileURLToPath(
  new globalThis.URL('../src/index.ts',import.meta.url)),'utf8');
 const wrangler=readFileSync(fileURLToPath(
  new globalThis.URL('../wrangler.toml',import.meta.url)),'utf8');
 assert.doesNotMatch(index,/m1-staging-http-boundary|m1-staging-secure-auth-composition/);
 assert.match(wrangler,/main = "src\/index.ts"/);
 assert.doesNotMatch(wrangler,/STARRY_SESSION_DB|database_id|route =/);
});
