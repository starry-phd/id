/**
 * SOURCE-ONLY synthetic binding contract; no remote Cloudflare/Google calls,
 * no real credentials, no public Worker entry or deployment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import {createM1StagingBoundRuntime,M1_STAGING_BOUND_RUNTIME_LIVE}
 from '../src/m1-staging-bound-runtime.ts';
import {handleRequest as publicWorker} from '../src/index.ts';

const server='https://staging.starry.invalid/';
const app='https://app.starry.invalid/oauth/complete';
const fromByte=n=>Buffer.from(new Uint8Array(32).fill(n)).toString('base64url');
function setup(changes={}){
 const stats={prepare:0,batch:0};
 const db={
  prepare(){stats.prepare++;throw Error('TEST_ONLY_DB_NEVER_PUBLIC');},
  async batch(){stats.batch++;throw Error('TEST_ONLY_DB_NEVER_PUBLIC');},
 };
 const vars={
  STARRY_ENVIRONMENT:'staging',
  STARRY_APP_ID:'starry-id',
  M1_STAGING_SOURCE_ASSEMBLY_ENABLED:'true',
  AUTH_DB:db,
  M1_STAGING_HTTPS_ORIGIN:server,
  M1_STAGING_APP_RETURN_URI:app,
  M1_GOOGLE_CLIENT_ID:'test-starry.apps.googleusercontent.com',
  // Fake test-only string: deliberately never a real Google credential.
  M1_GOOGLE_CLIENT_SECRET:'SYNTHETIC_LOCAL_ONLY_NOT_REAL',
  M1_GOOGLE_TEST_SUBJECTS_JSON:JSON.stringify(['allowed-google-sub']),
  M1_ACCESS_TEAM_DOMAIN:'https://only-test.cloudflareaccess.com/',
  M1_ACCESS_APP_AUD:'only-test-access-audience-012345678901',
  M1_ACCESS_TEST_SUBJECTS_JSON:JSON.stringify(['allowed-access-sub']),
  M1_SESSION_ACTIVE_KID:'test-session-kid',
  M1_SESSION_ACTIVE_SECRET:fromByte(21),
  M1_PKCE_ACTIVE_KID:'test-pkce-kid',
  M1_PKCE_ACTIVE_SECRET:fromByte(22),
  ...changes,
 };
 return {vars,stats};
}
const start='/v1/starry-id/oauth/google/start';
test('new Worker binding adapter is inert in the published health-only entry',async()=>{
 const {vars,stats}=setup();
 const bound=await createM1StagingBoundRuntime(vars);
 assert.equal(M1_STAGING_BOUND_RUNTIME_LIVE,false);
 assert.equal(bound.source_only,true);
 assert.equal(bound.live_enabled,false);
 assert.equal(bound.public_worker_route_registered,false);
 assert.equal(bound.contract,'starry.ai0.m1.source-only-worker-bindings.v1');
 assert.equal(Object.isFrozen(bound),true);
 const response=await bound.handle(new Request(new URL(start,server).href));
 assert.equal(response.status,403,
  'missing signed Access fails before original OAuth/D1');
 assert.equal(stats.prepare,0);
 assert.equal(stats.batch,0);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await bound.handle(new Request(server+'v1/echo/member'))).status,404);
 assert.equal(publicWorker(new Request(new URL(start,server).href),{
  STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id',
 }).status,404,'no new public route on the old Worker');
 const serialized=JSON.stringify(bound);
 assert.doesNotMatch(serialized,/SYNTHETIC_LOCAL_ONLY|test-session-kid|test-pkce-kid|AUTH_DB|secretB64url/);
 assert.equal('auth' in bound,false);
 assert.equal('keyMaterial' in bound,false);
 assert.equal('readGoogleClientSecret' in bound,false);
});
test('missing source opt-in, wrong brand/environment or absent dedicated D1 fail closed',async()=>{
 const bad=[
  {M1_STAGING_SOURCE_ASSEMBLY_ENABLED:undefined},
  {M1_STAGING_SOURCE_ASSEMBLY_ENABLED:'false'},
  {STARRY_ENVIRONMENT:'production'},
  {STARRY_ENVIRONMENT:'development'},
  {STARRY_APP_ID:'h-global'},
  {STARRY_APP_ID:'echo-starry'},
  {AUTH_DB:undefined},{AUTH_DB:{prepare(){}}},
  {AUTH_DB:{batch(){}}},
 ];
 for(const change of bad){
  const {vars,stats}=setup(change);
  await assert.rejects(createM1StagingBoundRuntime(vars),/M1_STAGING_BINDINGS_DENIED/);
  assert.deepEqual(stats,{prepare:0,batch:0});
 }
 for(const input of [undefined,null,false,[],{},'staging']){
  await assert.rejects(createM1StagingBoundRuntime(input),
   /M1_STAGING_BINDINGS_DENIED/);
 }
});
test('reject forged authority, unsafe URLs, malformed consent/tester sets and missing credentials',async()=>{
 const bad=[
  {M1_STAGING_HTTPS_ORIGIN:'http://staging.starry.invalid/'},
  {M1_STAGING_HTTPS_ORIGIN:'https://staging.starry.invalid/?token=secret'},
  {M1_STAGING_HTTPS_ORIGIN:'https://bad:pass@staging.starry.invalid/'},
  {M1_STAGING_HTTPS_ORIGIN:app},
  {M1_STAGING_APP_RETURN_URI:server},
  {M1_STAGING_APP_RETURN_URI:'https://evil.invalid/next'},
  {M1_STAGING_APP_RETURN_URI:'https://app.starry.invalid/oauth/complete#access_token=x'},
  {M1_GOOGLE_CLIENT_ID:'https://attacker.invalid'},
  {M1_GOOGLE_CLIENT_SECRET:undefined},
  {M1_GOOGLE_CLIENT_SECRET:'bad\nsecret'},
  {M1_GOOGLE_TEST_SUBJECTS_JSON:'[]'},
  {M1_GOOGLE_TEST_SUBJECTS_JSON:'["a","a"]'},
  {M1_GOOGLE_TEST_SUBJECTS_JSON:'{"admin":true}'},
  {M1_GOOGLE_TEST_SUBJECTS_JSON:'["a\\nb"]'},
  {M1_ACCESS_TEST_SUBJECTS_JSON:'["sub","sub"]'},
  {M1_ACCESS_TEST_SUBJECTS_JSON:undefined},
  {M1_ACCESS_TEAM_DOMAIN:'https://evil.invalid/'},
  {M1_ACCESS_TEAM_DOMAIN:'https://only-test.cloudflareaccess.com/evil'},
  {M1_ACCESS_APP_AUD:''},
  {M1_SESSION_ACTIVE_SECRET:undefined},
  {M1_PKCE_ACTIVE_KID:''},
  {M1_SESSION_PREVIOUS_KID:'previous-without-secret'},
  {M1_PKCE_PREVIOUS_SECRET:fromByte(23)},
 ];
 for(const change of bad){
  const {vars,stats}=setup(change);
  await assert.rejects(createM1StagingBoundRuntime(vars),
   /M1_STAGING_BINDINGS_DENIED|M1_CF_ACCESS_CONFIGURATION_DENIED|M1_KEYRING_CONFIGURATION_DENIED/,
   JSON.stringify(Object.keys(change)));
  assert.equal(stats.prepare,0);
 }
});
test('optional previous keys are accepted only as distinct rotation material',async()=>{
 const {vars}=setup({
  M1_SESSION_PREVIOUS_KID:'retired-session',
  M1_SESSION_PREVIOUS_SECRET:fromByte(23),
  M1_PKCE_PREVIOUS_KID:'retired-pkce',
  M1_PKCE_PREVIOUS_SECRET:fromByte(24),
 });
 const root=await createM1StagingBoundRuntime(vars);
 assert.equal((await root.handle(new Request(new URL(start,server).href))).status,403);
 for(const change of [
  {M1_SESSION_PREVIOUS_KID:vars.M1_SESSION_ACTIVE_KID},
  {M1_PKCE_PREVIOUS_SECRET:vars.M1_SESSION_ACTIVE_SECRET},
 ]) {
  await assert.rejects(createM1StagingBoundRuntime({...vars,...change}),
   /M1_KEYRING_CONFIGURATION_DENIED/);
 }
});
