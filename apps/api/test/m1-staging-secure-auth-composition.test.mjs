import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createM1StagingSecureAuthComposition,
 M1_STAGING_SECURE_AUTH_COMPOSITION_LIVE}
 from '../src/m1-staging-secure-auth-composition.ts';
import {handleRequest as liveWorker} from '../src/index.ts';

const NOW=1793000000;
const origin='https://staging.starry.invalid';
const issuer='https://starry-stage-test.cloudflareaccess.com';
const aud='stage-test-audience-abc123456789012345';
const kid='access-test-signing-key';
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const material={
 sessionActive:{kid:'staging-hmac-v1',
  secretB64url:Buffer.from(new Uint8Array(32).fill(5)).toString('base64url')},
 pkceActive:{kid:'staging-aes-v1',
  secretB64url:Buffer.from(new Uint8Array(32).fill(6)).toString('base64url')},
};
let once;
async function signedAccess(){
 if(once)return once;
 const keys=await globalThis.crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),
 },true,['sign','verify']);
 const pub=await globalThis.crypto.subtle.exportKey('jwk',keys.publicKey);
 const jwk={kty:'RSA',kid,use:'sig',alg:'RS256',n:pub.n,e:pub.e};
 const sign=async(claims={iss:issuer,aud:[aud],type:'app',sub:'tester-sub',
  iat:NOW-10,exp:NOW+300})=>{
  const data=encode({alg:'RS256',kid,typ:'JWT'})+'.'+encode(claims);
  const signature=await globalThis.crypto.subtle.sign(
   'RSASSA-PKCS1-v1_5',keys.privateKey,new globalThis.TextEncoder().encode(data));
  return data+'.'+Buffer.from(signature).toString('base64url');
 };
 once={jwk,sign};
 return once;
}
function inputs(changes={}){
 const stats={dbCalls:0,certCalls:0,googleCalls:0};
 const authDb={
  prepare:()=>{stats.dbCalls++;throw Error('LOCAL_TEST_DB_NO_REMOTE_WRITES');},
  batch:async()=>{stats.dbCalls++;throw Error('LOCAL_TEST_NO_BATCH');},
 };
 const setup={
  enabled:true,
  serverScope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},
  expectedOrigin:origin,
  redirectUri:origin+'/v1/starry-id/oauth/google/callback',
  appReturnUri:'https://app.starry.invalid/oauth/complete',
  authDb, keyMaterial:material,
  googleProvider:{provider:'google',issuer:'https://accounts.google.com',
   clientId:'local-staging-client',jwks:[]},
  googleJwksSource:{getProvider:async()=>null},
  allowedGoogleTestSubjects:['approved-google-sub'],
  cloudflareAccessAdmission:{
   enabled:true,environment:'staging',teamDomain:issuer,
   applicationAud:aud,allowedSubjects:['tester-sub'],now:()=>NOW,
   transport:async url=>{
    stats.certCalls++;
    assert.equal(url,issuer+'/cdn-cgi/access/certs');
    return new Response(JSON.stringify({keys:[(await signedAccess()).jwk]}),{
     status:200,headers:{'content-type':'application/json'},
    });
   },
  },
  readGoogleClientSecret:async()=>null,
  googleTransport:async()=>{stats.googleCalls++;throw Error('NO_LIVE_GOOGLE');},
  now:()=>NOW,
  ...changes,
 };
 return {setup,stats};
}
const startPath='/v1/starry-id/oauth/google/start';
const request=(token)=>new Request(origin+startPath,{
 headers:token?{'cf-access-jwt-assertion':token}:{},
});
test('staging secure composition is source-only; public Worker remains strictly health-only',async()=>{
 const {setup}=inputs();
 const root=await createM1StagingSecureAuthComposition(setup);
 assert.equal(M1_STAGING_SECURE_AUTH_COMPOSITION_LIVE,false);
 assert.equal(root.live_enabled,false);
 assert.equal(root.local_only,true);
 assert.equal(root.source_only,true);
 assert.equal(root.public_worker_route_registered,false);
 assert.equal('activeKey' in root,false);
 assert.equal('verifierCustody' in root,false);
 assert.equal('keyMaterial' in root,false);
 const env={STARRY_APP_ID:'starry-id',STARRY_ENVIRONMENT:'staging'};
 for(const path of [startPath,
  '/v1/starry-id/oauth/google/callback','/v1/starry-id/sessions/exchange']){
  const reply=liveWorker(new Request(origin+path),env);
  assert.equal(reply.status,404,'no live Auth route must be registered');
 }
});
test('same Auth assembly checks signed Access BEFORE any PKCE/D1 work; Access denial never falls back',async()=>{
 const {setup,stats}=inputs();
 const root=await createM1StagingSecureAuthComposition(setup);
 const noHeader=await root.handleOAuthStart(request());
 assert.equal(noHeader.status,403);
 assert.equal(stats.dbCalls,0);
 assert.equal(stats.certCalls,0);
 const uninvited=await root.handleOAuthStart(request(
  await (await signedAccess()).sign({
   iss:issuer,aud:[aud],type:'app',sub:'attacker',
   iat:NOW-10,exp:NOW+300,
  })));
 assert.equal(uninvited.status,403);
 assert.equal(stats.dbCalls,0);
 assert.equal(stats.certCalls,1);
 const valid=await root.handleOAuthStart(
  request(await (await signedAccess()).sign()));
 assert.equal(valid.status,503,
  'valid signed Access reaches original Auth, but synthetic DB rejects writes');
 assert.ok(stats.dbCalls>=1,
  'original signed M1 Auth attempts D1 ONLY AFTER valid Access verification');
 assert.equal(stats.googleCalls,0,
  'a Google token exchange must not run merely from START');
 assert.equal(valid.headers.get('cache-control'),'no-store');
});
test('secure assembly rejects absent Access, fake admission, replaced credential ports and wrong environment',async()=>{
 const negatives=[
  {enabled:undefined},{enabled:false},
  {serverScope:{brand_id:'echo',app_id:'starry-id',environment:'staging'}},
  {serverScope:{brand_id:'starry',app_id:'starry-id',environment:'production'}},
  {serverScope:{brand_id:'starry',app_id:'echo',environment:'staging'}},
  {googleJwksSource:undefined},
  {allowedGoogleTestSubjects:[]},
  {cloudflareAccessAdmission:undefined},
  {cloudflareAccessAdmission:{...inputs().setup.cloudflareAccessAdmission,enabled:false}},
  {authStartAdmission:async()=>true},
  {activeKey:async()=>({kid:'attacker',key:null})},
  {getVerificationKey:async()=>null},
  {verifierCustody:{seal:async()=>null,open:async()=>null}},
 ];
 for(const extra of negatives){
  const {setup,stats}=inputs(extra);
  await assert.rejects(createM1StagingSecureAuthComposition(setup),
   /M1_STAGING_SECURE_COMPOSITION_DENIED/);
  assert.equal(stats.dbCalls,0);
 }
});
test('bad cloudflare Access configuration or keyring is rejected before any database writes',async()=>{
 for(const extra of [
  {cloudflareAccessAdmission:{...inputs().setup.cloudflareAccessAdmission,
   teamDomain:'https://evil.invalid'}},
  {keyMaterial:{...material,pkceActive:material.sessionActive}},
  {keyMaterial:undefined},
 ]){
  const {setup,stats}=inputs(extra);
  await assert.rejects(createM1StagingSecureAuthComposition(setup),
   /M1_CF_ACCESS_CONFIGURATION_DENIED|M1_KEYRING_CONFIGURATION_DENIED/);
  assert.equal(stats.dbCalls,0);
 }
});
