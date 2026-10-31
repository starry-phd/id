import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1GoogleAuthorizeUrl} from
 '../../../modules/starry-id-v1/src/m1-google-oauth-exchange.ts';
import {createM1GoogleStartHttp,M1_GOOGLE_START_HTTP_LIVE,
 M1_GOOGLE_START_PATH} from '../src/m1-google-start-http.ts';

const origin='https://staging.starry.invalid';
const callback=origin+'/v1/starry-id/oauth/google/callback';
const clientId='starry-test-client';
const uri=origin+M1_GOOGLE_START_PATH;
const authorize=()=>createM1GoogleAuthorizeUrl({
 clientId,redirectUri:callback,state:'S'.repeat(43),
 nonce:'N'.repeat(32),codeChallenge:'C'.repeat(43),
});
function make(changes={}){
 let admissionCalls=0,attemptCalls=0;
 const instance=createM1GoogleStartHttp({
  enabled:true,environment:'staging',expectedOrigin:origin,callbackUri:callback,
  googleClientId:clientId,
  admitTestRequest:async()=>{admissionCalls++;return true;},
  beginGoogleLogin:async()=>{attemptCalls++;return authorize();},
  ...changes,
 });
 return {instance,admissionCalls:()=>admissionCalls,attemptCalls:()=>attemptCalls};
}
const request=(address=uri,method='GET',headers={})=>
 new Request(address,{method,headers});
test('Google start is source-only, default OFF and cannot touch admission or D1 begin',async()=>{
 const {instance,admissionCalls,attemptCalls}=make({enabled:undefined});
 assert.equal(M1_GOOGLE_START_HTTP_LIVE,false);
 assert.equal(instance.live_enabled,false);
 assert.equal(instance.source_only,true);
 assert.equal(instance.public_worker_route_registered,false);
 const r=await instance.handle(request());
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{error:{code:'FEATURE_DISABLED'}});
 assert.equal(admissionCalls(),0);
 assert.equal(attemptCalls(),0);
});
test('admitted staging browser navigation mints only a pinned Google authorize redirect',async()=>{
 const {instance,admissionCalls,attemptCalls}=make();
 const r=await instance.handle(request(uri,'GET',{'sec-fetch-site':'none'}));
 assert.equal(r.status,303);
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 assert.equal(r.headers.get('x-frame-options'),'DENY');
 assert.equal(await r.text(),'');
 assert.equal(admissionCalls(),1);
 assert.equal(attemptCalls(),1);
 const location=new globalThis.URL(r.headers.get('location'));
 assert.equal(location.origin,'https://accounts.google.com');
 assert.equal(location.pathname,'/o/oauth2/v2/auth');
 assert.equal(location.searchParams.get('redirect_uri'),callback);
 assert.equal(location.searchParams.get('scope'),'openid');
 assert.equal(location.searchParams.get('code_challenge_method'),'S256');
 assert.equal(location.searchParams.get('state'),'S'.repeat(43));
 assert.equal(location.searchParams.get('nonce'),'N'.repeat(32));
 assert.equal(location.searchParams.has('client_secret'),false);
 assert.equal(location.searchParams.has('access_token'),false);
});
test('unadmitted/throwing admission cannot allocate OAuth attempt',async()=>{
 for(const outcome of [false,null,undefined,0,'yes']){
  let count=0;
  const {instance,attemptCalls}=make({admitTestRequest:async()=>{count++;return outcome;}});
  const r=await instance.handle(request());
  assert.equal(r.status,403);
  assert.equal(count,1);
  assert.equal(attemptCalls(),0);
  assert.deepEqual(await r.json(),{error:{code:'TESTER_ACCESS_DENIED'}});
 }
 const {instance,attemptCalls}=make({admitTestRequest:async()=>{
  throw Error('PRIVATE_ADMISSION_CREDENTIAL');
 }});
 const failed=await instance.handle(request());
 assert.equal(failed.status,503);
 assert.equal(attemptCalls(),0);
 assert.doesNotMatch(await failed.text(),/PRIVATE|ADMISSION_CREDENTIAL/);
});
test('wrong method, URL, query, origin, host, cross-site and forwarded credentials deny BEFORE admission',async()=>{
 const {instance,admissionCalls,attemptCalls}=make();
 const scenarios=[
  request(uri,'POST'),request(uri+'?next=https://evil.invalid'),
  request(uri+'#handoff=secret'),request(origin+'/other'),
  request('https://evil.invalid'+M1_GOOGLE_START_PATH),
  request(uri,'GET',{host:'evil.invalid'}),
  request(uri,'GET',{'sec-fetch-site':'cross-site'}),
  request(uri,'GET',{'sec-fetch-site':'same-site'}),
  request(uri,'GET',{origin:'https://evil.invalid'}),
  request(uri,'GET',{'x-forwarded-host':'evil.invalid'}),
  request(uri,'GET',{authorization:'Bearer fake'}),
  request(uri,'GET',{'proxy-authorization':'Basic fake'}),
  request(uri,'GET',{'forwarded':'host=evil.invalid'}),
 ];
 for(const item of scenarios){
  const r=await instance.handle(item);
  assert.ok([403,404,405].includes(r.status));
  assert.equal(r.headers.get('location'),null);
  assert.equal(r.headers.get('cache-control'),'no-store');
 }
 assert.equal(admissionCalls(),0);
 assert.equal(attemptCalls(),0);
});
test('do not redirect to wrong provider, callback, client, or unbounded authorizer',async()=>{
 const safe=authorize();
 assert.ok(safe);
 const malformed=[
  'https://evil.invalid/o/oauth2/v2/auth?'+new globalThis.URL(safe).searchParams,
  safe.replace('accounts.google.com','evil.invalid'),
  safe.replace('client_id='+clientId,'client_id=attacker-client'),
  safe.replace(encodeURIComponent(callback),encodeURIComponent('https://evil.invalid/callback')),
  safe+'&scope=profile',
  safe+'&client_secret=PRIVATE_KEY',
  safe.replace('code_challenge_method=S256','code_challenge_method=plain'),
  'not-a-url',null,'x'.repeat(4200),
 ];
 for(const candidate of malformed){
  const {instance,attemptCalls}=make({beginGoogleLogin:async()=>candidate});
  const r=await instance.handle(request());
  assert.equal(r.status,503);
  assert.equal(r.headers.get('location'),null);
  assert.deepEqual(await r.json(),{error:{code:'SERVICE_UNAVAILABLE'}});
  assert.equal(attemptCalls(),0,'overridden begin function does not mutate the default counter');
 }
});
test('origin, callback, environment, owner admission and client ID are required at construction',()=>{
 const invalid=[
  {environment:'production'},{environment:'development'},
  {expectedOrigin:'http://staging.starry.invalid'},
  {expectedOrigin:origin+'/admin'},
  {callbackUri:origin+'/oauth/untrusted'},
  {callbackUri:'https://evil.invalid/v1/starry-id/oauth/google/callback'},
  {callbackUri:callback+'?redirect=evil'},
  {googleClientId:'x'},{admitTestRequest:null},
  {beginGoogleLogin:null},{enabled:'true'},
 ];
 for(const config of invalid)
  assert.throws(()=>make(config),/M1_START_CONFIGURATION_DENIED/);
});
test('begin errors cannot leak private provider detail or cause a redirect',async()=>{
 const {instance}=make({beginGoogleLogin:async()=>{throw Error('PRIVATE_SQL_OR_GOOGLE_TOKEN');}});
 const r=await instance.handle(request());
 assert.equal(r.status,503);
 assert.equal(r.headers.get('location'),null);
 assert.doesNotMatch(await r.text(),/PRIVATE_SQL|GOOGLE_TOKEN/);
});
