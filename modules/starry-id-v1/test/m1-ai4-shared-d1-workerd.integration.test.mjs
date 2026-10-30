/**
 * AI-1+AI-4: isolated, non-deployed real workerd+D1 SQLite lifecycle test.
 *
 * This test owns its own one-use Miniflare D1 and test-only RSA/HMAC/AES keys.
 * All member GET/PATCH/logout requests pass through the EXACT AI-4 #281
 * bridge, backed by the SAME authoritative AI-1 #279 M1/M2 flow + D1.
 * Google is simulated via an injected code transport (never public network).
 * There is NO production Worker route or Cloudflare account/resource.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,URL} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const origin='https://staging.starry.invalid';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const NOW=1793000000;
const member='/v1/starry-id/members/me';
const logout='/v1/starry-id/sessions/logout';
const dbId='98765432-aaaa-4bbb-8ccc-123456789abc';
const schemaPaths=[
 '../schema/001_starry_identity.DRAFT.sql',
 '../schema/002_m1_local_oauth_attempts.DRAFT.sql',
 '../schema/003_m2_local_member_self_mutations.DRAFT.sql',
];
function testWorkerSource(){
 return [
  "import {createM1LocalMemberPlatformBridge} from './m1-local-member-platform-bridge.ts';",
  "import {createM1LocalSelfHttp} from './m1-local-self-http.ts';",
  "import {createM1M2LocalGoogleFlow} from '../../../modules/starry-id-v1/src/m1-m2-local-google-member-flow.ts';",
  "import {createM1OAuthVerifierCustody} from '../../../modules/starry-id-v1/src/m1-oauth-verifier-custody.ts';",
  "import {bytesToBase64url} from '../../../modules/starry-id-v1/src/oidc-crypto.ts';",
  "const origin="+JSON.stringify(origin)+";",
  "const scope="+JSON.stringify(scope)+";",
  "const NOW="+JSON.stringify(NOW)+";",
  "const endpoint='/v1/starry-id/oauth/google/callback';",
  "const utf=x=>new TextEncoder().encode(x);",
  "const b64=x=>bytesToBase64url(x);",
  "let runtime=null;",
  "async function initialize(env){",
  " const hmac=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);",
  " const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);",
  " const rsa=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);",
  " const pub=await crypto.subtle.exportKey('jwk',rsa.publicKey);",
  " const provider={provider:'google',issuer:'https://accounts.google.com',clientId:'local-workerd-test-client',jwks:[{...pub,kid:'local-workerd-rsa',alg:'RS256',use:'sig'}]};",
  " const custody=createM1OAuthVerifierCustody({",
  "  activeKey:async()=>({kid:'local-workerd-aes',key:aes}),",
  "  findKey:async kid=>kid==='local-workerd-aes'?aes:null,",
  " });",
  " const pending=new Map();",
  " let tokenCalls=0;",
  " async function signIdToken(nonce,subject){",
  "  const header=b64(utf(JSON.stringify({alg:'RS256',kid:'local-workerd-rsa',typ:'JWT'})));",
  "  const payload=b64(utf(JSON.stringify({iss:provider.issuer,aud:provider.clientId,sub:subject,nonce,iat:NOW,exp:NOW+300})));",
  "  const signed=header+'.'+payload;",
  "  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',rsa.privateKey,utf(signed));",
  "  return signed+'.'+b64(new Uint8Array(sig));",
  " }",
  " const flow=createM1M2LocalGoogleFlow({",
  "  enabled:true,serverScope:scope,expectedOrigin:origin,redirectUri:origin+endpoint,",
  "  authDb:env.AUTH_DB,googleProvider:provider,verifierCustody:custody,",
  "  activeKey:async()=>({kid:'local-workerd-hmac',key:hmac}),",
  "  getVerificationKey:async kid=>kid==='local-workerd-hmac'?hmac:null,",
  "  readGoogleClientSecret:async()=> 'ephemeral-test-only-not-a-real-key',",
  "  googleTransport:async(url,init)=>{",
  "   if(url!=='https://oauth2.googleapis.com/token')throw Error('TEST_AUTHORITY_DENIED');",
  "   const code=new URLSearchParams(init.body).get('code');",
  "   const value=pending.get(code);if(!value) return new Response('{}',{status:400});",
  "   pending.delete(code);tokenCalls++;",
  "   return new Response(JSON.stringify({id_token:await signIdToken(value.nonce,value.subject),access_token:'DUMMY_PRIVATE'}),{status:200,headers:{'content-type':'application/json'}});",
  "  },",
  "  now:()=>NOW,",
  " });",
  " const read=createM1LocalSelfHttp({enabled:true,scope,expectedOrigin:origin,core:{readSelf:flow.readSelf}});",
  " const bridge=createM1LocalMemberPlatformBridge({enabled:true,scope,expectedOrigin:origin,",
  "  readPort:{handle(request){return read.handle(request);}},",
  "  mutationPort:{handle(request){return flow.mutateSelf(request);}},",
  " });",
  " return {flow,bridge,pending,getTokenCalls:()=>tokenCalls};",
  "}",
  "function current(env){return runtime??=(initialize(env));}",
  "export default {async fetch(req,env){",
  " const u=new URL(req.url);",
  " // Synthetic test driver exists ONLY inside this dynamically bundled",
  " // ephemeral Miniflare instance, never inside apps/api/src/index.ts.",
  " if(u.pathname==='/__localtest/start'&&req.method==='POST'){",
  "  const r=await current(env);",
  "  const auth=await r.flow.beginGoogleLogin();",
  "  if(!auth)return new Response('{}',{status:503});",
  "  const url=new URL(auth);",
  "  const code=u.searchParams.get('code')||'local-code';",
  "  const subject=u.searchParams.get('subject')||'known-subject';",
  "  r.pending.set(code,{nonce:url.searchParams.get('nonce'),subject});",
  "  return new Response(JSON.stringify({url:auth,state:url.searchParams.get('state'),code}),{headers:{'content-type':'application/json','cache-control':'no-store'}});",
  " }",
  " if(u.pathname==='/__localtest/finish'&&req.method==='POST'){",
  "  const r=await current(env);",
  "  const value=await req.json();",
  "  const result=await r.flow.completeGoogleLogin({state:value.state,code:value.code});",
  "  return new Response(JSON.stringify(result??null),{headers:{'content-type':'application/json','cache-control':'no-store'}});",
  " }",
  " if(u.pathname==='/__localtest/count'&&req.method==='GET'){",
  "  const r=await current(env);return Response.json({tokenCalls:r.getTokenCalls()});",
  " }",
  " const r=await current(env);",
  " const local=new Request(req.url,req);",
  " // Miniflare local transport supplies a synthetic proxy Host. Remove",
  " // only that host in this test harness; production bridge keeps its own",
  " // strict trusted Host checks. Existing AI-4 tests verify forged Host.",
  " local.headers.delete('host');",
  " return r.bridge.handle(local);",
  "}};",
 ].join('\n');
}
async function withRealD1(callback){
 const bundle=await build({
  stdin:{
   contents:testWorkerSource(),
   resolveDir:fileURLToPath(new URL('../../../apps/api/src/',import.meta.url)),
   sourcefile:'m1-ai1-ai4-closed-workerd.integration.fixture.ts',loader:'ts',
  },bundle:true,platform:'browser',format:'esm',target:'es2022',
  write:false,logLevel:'silent',
 });
 const mf=new Miniflare({workers:[{config:{
  name:'ai1-ai4-real-d1-workerd-integration-fixture',
  compatibilityDate:'2026-10-24',
  d1Databases:{AUTH_DB:dbId},
  manifest:{mainModule:'index.js',modules:{
   'index.js':{type:'esm',contents:bundle.outputFiles[0].text},
  }},env:{},
 }}]});
 try{
  const db=await mf.getD1Database('AUTH_DB');
  // Each test has a unique in-memory workerd/SQLite database, shared
  // across M1 issuance, W3 GET and M2 PATCH/logout within the same test.
  for(const path of schemaPaths){
   const sql=readFileSync(new URL(path,import.meta.url),'utf8');
   await db.exec(sql);
  }
  await db.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .bind('u1','active',3,1,'Test Member',0,0,NOW,NOW).run();
  await db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .bind('google','known-subject','u1').run();
  await callback({mf,db});
 }finally{await mf.dispose();}
}
const request=(mf,path,options={})=>mf.dispatchFetch(origin+path,options);
async function start(mf,code='known-code',subject='known-subject'){
 const r=await request(mf,'/__localtest/start?code='+encodeURIComponent(code)+'&subject='+encodeURIComponent(subject),{method:'POST'});
 assert.equal(r.status,200);
 const out=await r.json();
 const url=new URL(out.url);
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('scope'),'openid');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.has('code_verifier'),false);
 assert.equal(url.searchParams.has('client_secret'),false);
 assert.ok(out.state&&out.code);
 return out;
}
async function finish(mf,started){
 const r=await request(mf,'/__localtest/finish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(started)});
 assert.equal(r.status,200);
 return r.json();
}
const authorized=(token,method='GET',headers={},body)=>({
 method,headers:{authorization:'Bearer '+token,...headers},
 ...(body!==undefined?{body}:{}),
});

test('AI1-issued real signed Google Session traverses AI4 workerd bridge on ONE Miniflare SQLite D1: GET→CAS→logout→deny',async()=>{
 await withRealD1(async({mf,db})=>{
  const begun=await start(mf);
  const stored=await db.prepare('SELECT code_verifier,consumed_at FROM starry_m1_oauth_attempts WHERE state=?').bind(begun.state).first();
  assert.match(stored.code_verifier,/^m1gcm1\.local-workerd-aes\./);
  assert.equal(stored.consumed_at,null);
  const issued=await finish(mf,begun);
  assert.equal(issued?.status,'issued');
  assert.equal(issued?.s_user_id,'u1');
  assert.match(issued.bearer,/^v1\./);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_sessions').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').first()).n,1);
  const first=await request(mf,member,authorized(issued.bearer));
  assert.equal(first.status,200);
  assert.equal(first.headers.get('cache-control'),'no-store');
  assert.deepEqual(await first.json(),{
   s_user_id:'u1',display_name:'Test Member',
   directory_opt_in:false,display_name_public:false,profile_revision:1,
  });
  const changed=await request(mf,member,authorized(issued.bearer,'PATCH',{
   'content-type':'application/json','if-match':'"rev-1"',
  },JSON.stringify({display_name:'Local Only',directory_opt_in:true,display_name_public:true})));
  assert.equal(changed.status,200);
  assert.deepEqual(await changed.json(),{
   s_user_id:'u1',display_name:'Local Only',
   directory_opt_in:true,display_name_public:true,profile_revision:2,
  });
  const second=await request(mf,member,authorized(issued.bearer));
  assert.equal(second.status,200);
  assert.equal((await second.json()).profile_revision,2);
  const stale=await request(mf,member,authorized(issued.bearer,'PATCH',{
   'content-type':'application/json','if-match':'"rev-1"',
  },JSON.stringify({display_name:'Stale'})));
  assert.equal(stale.status,409);
  const revoked=await request(mf,logout,authorized(issued.bearer,'POST'));
  assert.equal(revoked.status,204);
  assert.equal(await revoked.text(),'');
  assert.equal((await request(mf,member,authorized(issued.bearer))).status,401);
  assert.equal((await request(mf,logout,authorized(issued.bearer,'POST'))).status,401);
  assert.equal((await request(mf,member,authorized(issued.bearer,'PATCH',{
   'content-type':'application/json','if-match':'"rev-2"',
  },JSON.stringify({display_name:'Never'})))).status,401);
  const rows=await db.prepare('SELECT event_type,environment,profile_revision FROM starry_m2_member_mutation_audit ORDER BY event_type').all();
  assert.equal(rows.results.length,2);
  assert.deepEqual(rows.results.map(x=>x.event_type).sort(),['profile_updated','session_revoked']);
  assert.equal((await db.prepare('SELECT revoked_at FROM starry_sessions').first()).revoked_at,NOW);
  assert.equal((await db.prepare('SELECT profile_revision FROM starry_members WHERE s_user_id=?').bind('u1').first()).profile_revision,2);
  const replay=await finish(mf,begun);
  assert.equal(replay,null);
  assert.equal((await request(mf,'/__localtest/count').then(x=>x.json())).tokenCalls,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_sessions').first()).n,1);
 });
});

test('AI1 first Google subject creates PRIVATE new member; AI4 GET/PATCH cannot touch existing member in same D1',async()=>{
 await withRealD1(async({mf,db})=>{
  const newLogin=await start(mf,'new-code','new-subject');
  const issued=await finish(mf,newLogin);
  assert.equal(issued?.status,'issued');
  assert.notEqual(issued.s_user_id,'u1');
  assert.match(issued.s_user_id,/^su-[a-f0-9]{48}$/);
  const initial=await request(mf,member,authorized(issued.bearer));
  assert.equal(initial.status,200);
  assert.deepEqual(await initial.json(),{
   s_user_id:issued.s_user_id,display_name:null,
   directory_opt_in:false,display_name_public:false,profile_revision:1,
  });
  const updated=await request(mf,member,authorized(issued.bearer,'PATCH',{
   'content-type':'application/json','if-match':'"rev-1"',
  },JSON.stringify({display_name:'Private User'})));
  assert.equal(updated.status,200);
  const old=await db.prepare('SELECT display_name,profile_revision FROM starry_members WHERE s_user_id=?').bind('u1').first();
  assert.equal(old.display_name,'Test Member');assert.equal(old.profile_revision,1);
  const created=await db.prepare('SELECT display_name,directory_opt_in,display_name_public,profile_revision FROM starry_members WHERE s_user_id=?').bind(issued.s_user_id).first();
  assert.equal(created.display_name,'Private User');
  assert.equal(created.directory_opt_in,0);
  assert.equal(created.display_name_public,0);
  assert.equal(created.profile_revision,2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').first()).n,2);
 });
});

test('real D1 revocation/version/identity unlink and forged workerd requests deny without bridge write or audit',async()=>{
 for(const tamper of [
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=auth_version+1 WHERE s_user_id='u1'",
  "DELETE FROM starry_identities WHERE provider='google' AND s_user_id='u1'",
  "UPDATE starry_sessions SET revoked_at=1793000000 WHERE s_user_id='u1'",
 ]){
  await withRealD1(async({mf,db})=>{
   const issued=await finish(mf,await start(mf));
   assert.ok(issued?.bearer);
   await db.exec(tamper);
   const response=await request(mf,member,authorized(issued.bearer));
   assert.equal(response.status,401,tamper);
   assert.equal((await request(mf,member,authorized(issued.bearer,'PATCH',{
    'content-type':'application/json','if-match':'"rev-1"',
   },JSON.stringify({display_name:'NEVER'})))).status,401,tamper);
   const out=await request(mf,logout,authorized(issued.bearer,'POST'));
   assert.equal(out.status,401,tamper);
   assert.equal((await db.prepare("SELECT display_name FROM starry_members WHERE s_user_id='u1'").first()).display_name,'Test Member');
   assert.equal((await db.prepare("SELECT count(*) AS n FROM starry_m2_member_mutation_audit WHERE event_type='profile_updated'").first()).n,0);
  });
 }
 await withRealD1(async({mf,db})=>{
  const issued=await finish(mf,await start(mf));
  for(const [path,opts,expected] of [
   [member,authorized('bad-credential'),401],
   [member+'?admin=1',authorized(issued.bearer),400],
   ['/v1/admin',authorized(issued.bearer),404],
   [logout,authorized(issued.bearer,'GET'),405],
   [member,authorized(issued.bearer,'GET',{'cookie':'sid=forged'}),401],
   [member,authorized(issued.bearer,'GET',{'x-forwarded-authorization':'Bearer fake'}),401],
   [member,authorized(issued.bearer,'PATCH',{'if-match':'"rev-1"','content-type':'application/json'},JSON.stringify({role:'superuser'})),400],
  ]){
   const response=await request(mf,path,opts);
   assert.equal(response.status,expected,path);
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.doesNotMatch(await response.text(),/PRIVATE_SQL|DUMMY_PRIVATE|local-workerd-aes|refresh_hash/);
  }
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_member_mutation_audit').first()).n,0);
 });
});

test('one signed member with two Sessions: workerd logout revokes ONLY the selected Session in shared SQLite',async()=>{
 await withRealD1(async({mf,db})=>{
  const first=await finish(mf,await start(mf,'device-one'));
  const second=await finish(mf,await start(mf,'device-two'));
  assert.ok(first?.bearer&&second?.bearer);
  assert.notEqual(first.bearer,second.bearer);
  assert.equal(first.s_user_id,'u1');
  assert.equal(second.s_user_id,'u1');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_sessions').first()).n,2);
  assert.equal((await request(mf,member,authorized(first.bearer))).status,200);
  assert.equal((await request(mf,member,authorized(second.bearer))).status,200);
  assert.equal((await request(mf,logout,authorized(first.bearer,'POST'))).status,204);
  assert.equal((await request(mf,member,authorized(first.bearer))).status,401);
  assert.equal((await request(mf,member,authorized(second.bearer))).status,200);
  assert.equal((await request(mf,logout,authorized(second.bearer,'POST'))).status,204);
  assert.equal((await request(mf,member,authorized(second.bearer))).status,401);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM starry_sessions WHERE revoked_at=?").bind(NOW).first()).n,2);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM starry_m2_member_mutation_audit WHERE event_type='session_revoked'").first()).n,2);
 });
});
