import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1GoogleSessionHandoffHttp} from
 '../src/m1-google-session-handoff-http.ts';

const server='https://staging.starry.invalid';
const callback=server+'/v1/starry-id/oauth/google/callback';
const app='https://app.starry.invalid/oauth/complete';
const state='S'.repeat(43);

function fixture(){
 const calls={complete:0,redeem:0};
 const handler=createM1GoogleSessionHandoffHttp({
  enabled:true,expectedOrigin:server+'/',redirectUri:callback,
  appReturnUri:app,
  async completeGoogleLoginForApp(){calls.complete++;return null;},
  async redeemSessionHandoff(){calls.redeem++;return null;},
 });
 return {handler,calls};
}
const url=(params)=>callback+'?'+new URLSearchParams(params).toString();

test('Google consent denied with echoed state returns only fixed app failure (no new Session)',async()=>{
 const {handler,calls}=fixture();
 const privateDescription='PRIVATE_GOOGLE_USER_DENIAL_NOT_FOR_APP';
 const response=await handler.handleOAuthCallback(new Request(url({
  error:'access_denied',state,
  error_description:privateDescription,
  error_uri:'https://example.invalid/private',
  iss:'https://accounts.google.com',
 })));
 assert.equal(response.status,303);
 assert.equal(response.headers.get('location'),app+'#error=oauth_failed');
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 const body=await response.text();
 assert.equal(body,'');
 assert.doesNotMatch(response.headers.get('location'),/PRIVATE|access_denied|[A-Z]{43}/);
 assert.deepEqual(calls,{complete:0,redeem:0},
  'an OAuth failure must not exchange, mint, or consume a Session');
 // Legacy state-less error callbacks remain a generic failure, not success.
 const legacy=await handler.handleOAuthCallback(new Request(
  url({error:'access_denied'})));
 assert.equal(legacy.status,303);
 assert.equal(legacy.headers.get('location'),app+'#error=oauth_failed');
 assert.deepEqual(calls,{complete:0,redeem:0});
});

test('malformed state, mixed success/error, wrong issuer and duplicate params fail closed',async()=>{
 const {handler,calls}=fixture();
 const cases=[
  {error:'access_denied',state:'short'},
  {error:'access_denied',state:'A'.repeat(257)},
  {error:'access_denied',state:'A'.repeat(31)},
  {error:'access_denied',state:state+'='},
  {error:'access_denied',code:'GOOGLE_CODE_MUST_NOT_ACCEPT',state},
  {error:'access_denied',state,iss:'https://attacker.invalid'},
  {error:'',state},
 ];
 for(const params of cases){
  const result=await handler.handleOAuthCallback(new Request(url(params)));
  assert.equal(result.status,400,JSON.stringify(params).slice(0,70));
  assert.equal(result.headers.get('location'),null);
  assert.equal(result.headers.get('cache-control'),'no-store');
 }
 const duplicates=callback+'?error=access_denied&state='+state+'&state='+state;
 assert.equal((await handler.handleOAuthCallback(new Request(duplicates))).status,400);
 assert.deepEqual(calls,{complete:0,redeem:0},
  'no invalid callback may call Google/D1/Session authorization ports');
});
