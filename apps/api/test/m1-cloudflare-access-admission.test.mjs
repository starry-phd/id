import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {
 createM1CloudflareAccessAdmission,M1_CF_ACCESS_ADMISSION_LIVE,
} from '../src/m1-cloudflare-access-admission.ts';
import {createM1GoogleStartHttp} from '../src/m1-google-start-http.ts';
import {createM1GoogleAuthorizeUrl} from
 '../../../modules/starry-id-v1/src/m1-google-oauth-exchange.ts';

const issuer='https://starry-access-test.cloudflareaccess.com';
const certUrl=issuer+'/cdn-cgi/access/certs';
const aud='abc123'.repeat(8);
const NOW=1793000000;
const base={iss:issuer,aud:[aud],type:'app',sub:'invited-access-sub',
 iat:NOW-10,exp:NOW+300,nbf:NOW-10};
const encode=(v)=>Buffer.from(JSON.stringify(v)).toString('base64url');
let signed;
async function fixture(){
 if(signed)return signed;
 const pair=await globalThis.crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),
 },true,['sign','verify']);
 const pub=await globalThis.crypto.subtle.exportKey('jwk',pair.publicKey);
 const kid='owned-fixture-access-rs256-kid';
 const sign=async(payload=base,header={alg:'RS256',kid,typ:'JWT'})=>{
  const encoded=encode(header)+'.'+encode(payload);
  const sig=await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,
   new globalThis.TextEncoder().encode(encoded));
  return encoded+'.'+Buffer.from(sig).toString('base64url');
 };
 signed={pub:{kty:'RSA',alg:'RS256',use:'sig',kid,n:pub.n,e:pub.e},
  sign};
 return signed;
}
function harness(options={},fixtureValue){
 let fetches=0;
 const config={
  enabled:true,environment:'staging',teamDomain:issuer,
  applicationAud:aud,allowedSubjects:['invited-access-sub'],
  now:()=>NOW,
  transport:async(url,init)=>{
   fetches++;
   assert.equal(url,certUrl);
   assert.equal(init.method,'GET');
   assert.equal(init.redirect,'error');
   assert.equal(init.credentials,'omit');
   assert.equal(init.cache,'no-store');
   const key=fixtureValue??(await fixture()).pub;
   return new Response(JSON.stringify({keys:[key]}),{
    status:200,headers:{'content-type':'application/json'},
   });
  },...options,
 };
 return {
  admission:createM1CloudflareAccessAdmission(config),
  count:()=>fetches,
 };
}
const req=(token,headerExtras={})=>new Request(
 'https://staging.starry.invalid/v1/starry-id/oauth/google/start',{
 headers:{...(token?{'cf-access-jwt-assertion':token}:{}),...headerExtras},
});
test('Access verifier remains SOURCE-ONLY and refuses missing token without remote JWKS request',async()=>{
 const {admission,count}=harness();
 assert.equal(M1_CF_ACCESS_ADMISSION_LIVE,false);
 assert.equal(admission.live_enabled,false);
 assert.equal(admission.source_only,true);
 assert.equal(await admission.verify(req(null,{
  'Cf-Access-Authenticated-User-Email':'invited-access-sub',
 })),false);
 assert.equal(count(),0);
 const disabled=harness({enabled:undefined});
 assert.equal(await disabled.admission.verify(req(await (await fixture()).sign())),false);
 assert.equal(disabled.count(),0);
});
test('real WebCrypto RS256 signed Access app JWT + exact aud and signed invited SUB grants admission',async()=>{
 const {admission,count}=harness();
 assert.equal(await admission.verify(req(await (await fixture()).sign())),true);
 assert.equal(count(),1);
});
test('signed Access tokens with WRONG issuer, audience, type, signed subject, time or extra AUD are denied',async()=>{
 const value=await fixture();
 const invalid=[
  {...base,iss:'https://evil.cloudflareaccess.com'},
  {...base,aud:['other-access-audience-99999']},
  {...base,aud:[aud,'other-access-audience-99999']},
  {...base,aud:aud},
  {...base,type:'org'},
  {...base,type:'service'},
  {...base,sub:'not-invited'},
  {...base,sub:'invited-access-sub',exp:NOW-1},
  {...base,iat:NOW+100},
  {...base,nbf:NOW+1},
  {...base,exp:NOW+90000},
  {...base,iat:NOW-90000},
  {...base,exp:NOW,iat:NOW},
 ];
 const {admission}=harness();
 for(const claims of invalid)
  assert.equal(await admission.verify(req(await value.sign(claims))),false,
   'invalid signed claims must be denied');
});
test('header spoof, unsigned payload edit, wrong key/alg, forged header fields are denied',async()=>{
 const value=await fixture();
 const valid=await value.sign();
 const p=valid.split('.');
 const falsified=p[0]+'.'+encode({...base,sub:'invited-access-sub',exp:NOW+500})+'.'+p[2];
 const invalid=[
  falsified,
  await value.sign(base,{alg:'none',kid:value.pub.kid,typ:'JWT'}),
  await value.sign(base,{alg:'HS256',kid:value.pub.kid,typ:'JWT'}),
  await value.sign(base,{alg:'RS256',kid:'not-in-set',typ:'JWT'}),
  await value.sign(base,{alg:'RS256',kid:value.pub.kid,typ:'JWT',
   jku:'https://evil.invalid/keys'}),
  'Bearer '+valid,
  valid.slice(0,-1)+'_',
  p[0]+'.'+p[1],
 ];
 const {admission}=harness();
 for(const token of invalid)
  assert.equal(await admission.verify(req(token)),false);
});
test('JWKS failure, duplicate kid, private key or wrong TLS content never grants admission',async()=>{
 const value=await fixture(),token=await value.sign();
 const fail=[
  async()=>new Response('{}',{status:503,headers:{'content-type':'application/json'}}),
  async()=>new Response('<html>access</html>',{
   status:200,headers:{'content-type':'text/html'},
  }),
  async()=>new Response(JSON.stringify({keys:[]}),{
   status:200,headers:{'content-type':'application/json'},
  }),
  async()=>new Response(JSON.stringify({keys:[value.pub,value.pub]}),{
   status:200,headers:{'content-type':'application/json'},
  }),
  async()=>new Response(JSON.stringify({keys:[{...value.pub,d:'private'}]}),{
   status:200,headers:{'content-type':'application/json'},
  }),
  async()=>new Response(JSON.stringify({keys:[{...value.pub,kty:'oct'}]}),{
   status:200,headers:{'content-type':'application/json'},
  }),
  async()=>new Response(JSON.stringify({keys:[value.pub]}),{
   status:200,headers:{'content-type':'application/json','content-length':'999999'},
  }),
  async()=>{throw Error('PRIVATE_CONNECTOR_SECRET');},
 ];
 for(const transport of fail){
  const {admission}=harness({transport});
  assert.equal(await admission.verify(req(token)),false);
 }
});
test('signed invitees are captured by value; later config array mutation cannot widen admission',async()=>{
 const allowed=['invited-access-sub'];
 const {admission}=harness({allowedSubjects:allowed});
 allowed.push('not-invited');
 assert.equal(await admission.verify(req(
  await (await fixture()).sign({...base,sub:'not-invited'}))),false);
});
test('Cloudflare Access configuration requires strict team HTTPS domain, AUD, tester SUB and transport',()=>{
 const invalid=[
  {environment:'production'},
  {teamDomain:'https://evil.invalid'},
  {teamDomain:'https://starry-access-test.cloudflareaccess.com.attacker.invalid'},
  {teamDomain:'http://starry-access-test.cloudflareaccess.com'},
  {teamDomain:issuer+'/redirect'},
  {teamDomain:'https://user:password@starry-access-test.cloudflareaccess.com'},
  {teamDomain:issuer+'?aud=x'},
  {applicationAud:'x'},
  {allowedSubjects:[]},
  {allowedSubjects:['invited-access-sub','invited-access-sub']},
  {allowedSubjects:['invited-access-sub','']},
  {transport:null},{now:null},{enabled:'yes'},
 ];
 for(const extra of invalid)
  assert.throws(()=>harness(extra),/M1_CF_ACCESS_CONFIGURATION_DENIED/);
});
test('only signed Access admission unlocks existing Google browser START and never returns bearer',async()=>{
 const {admission}=harness();
 let attempts=0;
 const google=createM1GoogleAuthorizeUrl({
  clientId:'staging-test-client',
  redirectUri:'https://staging.starry.invalid/v1/starry-id/oauth/google/callback',
  state:'S'.repeat(43),nonce:'N'.repeat(32),codeChallenge:'C'.repeat(43),
 });
 const start=createM1GoogleStartHttp({
  enabled:true,environment:'staging',expectedOrigin:'https://staging.starry.invalid',
  callbackUri:'https://staging.starry.invalid/v1/starry-id/oauth/google/callback',
  googleClientId:'staging-test-client',
  admitTestRequest:admission.verify,
  beginGoogleLogin:async()=>{attempts++;return google;},
 });
 const wrong=req(await (await fixture()).sign({...base,sub:'not-invited'}));
 const denied=await start.handle(wrong);
 assert.equal(denied.status,403);
 assert.equal(attempts,0);
 assert.equal(denied.headers.get('location'),null);
 const success=await start.handle(req(await (await fixture()).sign()));
 assert.equal(success.status,303);
 assert.equal(success.headers.get('cache-control'),'no-store');
 assert.ok(success.headers.get('location').startsWith(
  'https://accounts.google.com/o/oauth2/v2/auth?'));
 assert.equal(attempts,1);
 assert.equal(await success.text(),'');
});


test('Access JWT expiring during JWKS fetch cannot open Google OAuth start or persist an attempt',async()=>{
 const value=await fixture();
 const shortLived=await value.sign({...base,exp:NOW+2});
 let clock=NOW,certReads=0,oauthAttempts=0;
 const {admission}=harness({
  now:()=>clock,
  transport:async(url)=>{
   assert.equal(url,certUrl);
   certReads++;clock=NOW+3; // Still valid at entry, EXPIRED at signature check.
   return new Response(JSON.stringify({keys:[value.pub]}),{
    status:200,headers:{'content-type':'application/json'},
   });
  },
 });
 const google=createM1GoogleAuthorizeUrl({
  clientId:'staging-test-client',
  redirectUri:'https://staging.starry.invalid/v1/starry-id/oauth/google/callback',
  state:'S'.repeat(43),nonce:'N'.repeat(32),codeChallenge:'C'.repeat(43),
 });
 const start=createM1GoogleStartHttp({
  enabled:true,environment:'staging',expectedOrigin:'https://staging.starry.invalid',
  callbackUri:'https://staging.starry.invalid/v1/starry-id/oauth/google/callback',
  googleClientId:'staging-test-client',
  admitTestRequest:admission.verify,
  beginGoogleLogin:async()=>{oauthAttempts++;return google;},
 });
 const result=await start.handle(req(shortLived));
 assert.equal(result.status,403,
  'Google start MUST NOT use an Access JWT expired during remote cert download');
 assert.deepEqual(await result.json(),{error:{code:'TESTER_ACCESS_DENIED'}});
 assert.equal(result.headers.get('location'),null);
 assert.equal(oauthAttempts,0,'no OAuth state/PKCE write after stale Access admission');
 assert.equal(certReads,1,'real pinned Access public JWKS was fetched exactly once');
});

test('Access admission rejects clock rollback after JWKS await, accepts only still-current JWT',async()=>{
 const value=await fixture();
 const shortLived=await value.sign({...base,exp:NOW+2});
 let clock=NOW;
 const {admission}=harness({
  now:()=>clock,
  transport:async()=>{
   clock=NOW-1;
   return new Response(JSON.stringify({keys:[value.pub]}),{
    status:200,headers:{'content-type':'application/json'},
   });
  },
 });
 assert.equal(await admission.verify(req(shortLived)),false,
  'a rolled-back server clock cannot extend signed tester access');
 const valid=harness({
  now:()=>clock,
  transport:async()=>new Response(JSON.stringify({keys:[value.pub]}),{
   status:200,headers:{'content-type':'application/json'},
  }),
 });
 clock=NOW+1;
 assert.equal(await valid.admission.verify(req(shortLived)),true,
  'same verified short-lived token remains accepted before exp');
});
