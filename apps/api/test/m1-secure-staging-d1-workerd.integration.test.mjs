/**
 * One REAL local Miniflare/workerd/SQLite D1 vertical M1 test through:
 * #320 RSA-verified Cloudflare Access JWT -> #321 nonextractable HMAC+AES
 * Worker Secret keyring -> #322 original unique Starry Auth factory ->
 * #325 exact HTTPS dispatcher -> #327/#328 real canonical bound-runtime
 * STARRY_SESSION_DB config -> original M1 profile GET/CAS/logout.
 *
 * Google token and Access certs are cryptographically signed TEST FIXTURES,
 * and Worker+D1 resources are ephemeral LOCAL ONLY. Not remote acceptance,
 * a signed iOS/Android build, real Access, Google OAuth or deployment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,URL} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const origin='https://staging.starry.invalid';
const app='https://app.starry.invalid/oauth/complete';
const NOW=Math.floor(Date.now()/1000);
const dbId='98765432-aaaa-4bbb-8ccc-123456789abc';
const paths=[
 '../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',
 '../../../modules/starry-id-v1/schema/002_m1_local_oauth_attempts.DRAFT.sql',
 '../../../modules/starry-id-v1/schema/003_m2_local_member_self_mutations.DRAFT.sql',
 '../../../modules/starry-id-v1/schema/004_m2_local_deletion_request_receipt.DRAFT.sql',
 '../../../modules/starry-id-v1/schema/005_m1_session_handoffs.DRAFT.sql',
];

function testWorkerSource(){
 return [
  "import {createM1StagingBoundRuntime} from './m1-staging-bound-runtime.ts';",
  "import {M1_GOOGLE_DISCOVERY_URL,M1_GOOGLE_JWKS_URL} from '../../../modules/starry-id-v1/src/m1-google-jwks-source.ts';",
  "import {bytesToBase64url} from '../../../modules/starry-id-v1/src/oidc-crypto.ts';",
  "const origin=\"https://staging.starry.invalid\";",
  "const app=\"https://app.starry.invalid/oauth/complete\";",
  "const NOW="+JSON.stringify(NOW)+";",
  "const accessIssuer='https://m1-e2e-test.cloudflareaccess.com';",
  "const accessAud='signed-access-staging-audience-123456';",
  "const utf=x=>new TextEncoder().encode(x);",
  "const b64=x=>bytesToBase64url(x);",
  "const keyPair=async()=>crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},true,['sign','verify']);",
  "let runtime=null;",
  "async function initialize(env){",
  " const googleRsa=await keyPair();const accessRsa=await keyPair();",
  " const googlePub=await crypto.subtle.exportKey('jwk',googleRsa.publicKey);",
  " const accessPub=await crypto.subtle.exportKey('jwk',accessRsa.publicKey);",
  " async function signedJwt(privateKey,head,body){",
  "  const signed=b64(utf(JSON.stringify(head)))+'.'+b64(utf(JSON.stringify(body)));",
  "  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,utf(signed));",
  "  return signed+'.'+b64(new Uint8Array(sig));",
  " }",
  " async function signAccess(sub){return signedJwt(accessRsa.privateKey,{alg:'RS256',kid:'local-access-rsa',typ:'JWT'},",
  "   {iss:accessIssuer,aud:[accessAud],type:'app',sub,iat:NOW-10,exp:NOW+300});}",
  " async function signGoogle(nonce,sub){return signedJwt(googleRsa.privateKey,{alg:'RS256',kid:'local-google-rsa',typ:'JWT'},",
  "   {iss:'https://accounts.google.com',aud:'local-starry-secure-e2e-client',sub,nonce,iat:NOW-10,exp:NOW+300});}",
  " const pending=new Map();let tokenCalls=0;",
  " const first=crypto.getRandomValues(new Uint8Array(32));",
  " const second=crypto.getRandomValues(new Uint8Array(32));",
  " // Only the ephemeral local Workerd fixture intercepts the OFFICIAL pinned",
  " // Google and Cloudflare endpoints. Production factory cannot inject hosts.",
  " globalThis.fetch=async(url,init)=>{",
  "  if(init.method==='GET'&&init.credentials==='omit'&&init.redirect==='error'){",
  "   if(url===M1_GOOGLE_DISCOVERY_URL)return new Response(JSON.stringify({issuer:'https://accounts.google.com',jwks_uri:M1_GOOGLE_JWKS_URL}),{status:200,headers:{'content-type':'application/json'}});",
  "   if(url===M1_GOOGLE_JWKS_URL)return new Response(JSON.stringify({keys:[{...googlePub,kid:'local-google-rsa',alg:'RS256',use:'sig'}]}),{status:200,headers:{'content-type':'application/json','cache-control':'public, max-age=300'}});",
  "   if(url===accessIssuer+'/cdn-cgi/access/certs')return new Response(JSON.stringify({keys:[{...accessPub,kid:'local-access-rsa',alg:'RS256',use:'sig'}]}),{status:200,headers:{'content-type':'application/json'}});",
  "  }",
  "  if(url==='https://oauth2.googleapis.com/token'&&init.method==='POST'){",
  "   const code=new URLSearchParams(init.body).get('code');",
  "   const item=pending.get(code);if(!item)return new Response('{}',{status:400});",
  "   pending.delete(code);tokenCalls++;",
  "   return new Response(JSON.stringify({id_token:await signGoogle(item.nonce,item.sub)}),{status:200,headers:{'content-type':'application/json'}});",
  "  }",
  "  throw Error('TEST_LOCAL_NETWORK_DENIED');",
  " };",
  " const router=await createM1StagingBoundRuntime({",
  "  ...env,STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id',",
  "  M1_STAGING_SOURCE_ASSEMBLY_ENABLED:'true',",
  "  M1_STAGING_HTTPS_ORIGIN:origin+'/',M1_STAGING_APP_RETURN_URI:app,",
  "  M1_GOOGLE_CLIENT_ID:'local-starry-secure-e2e-client',",
  "  M1_GOOGLE_CLIENT_SECRET:'LOCAL_FIXTURE_NEVER_REAL',",
  "  M1_GOOGLE_TEST_SUBJECTS_JSON:JSON.stringify(['known-subject']),",
  "  M1_ACCESS_TEAM_DOMAIN:accessIssuer+'/',M1_ACCESS_APP_AUD:accessAud,",
  "  M1_ACCESS_TEST_SUBJECTS_JSON:JSON.stringify(['invited-tester']),",
  "  M1_SESSION_ACTIVE_KID:'local-session-hmac',M1_SESSION_ACTIVE_SECRET:b64(first),",
  "  M1_PKCE_ACTIVE_KID:'local-pkce-aes',M1_PKCE_ACTIVE_SECRET:b64(second),",
  " });",
  " return {router,pending,tokenCalls:()=>tokenCalls,signAccess};",
  "}",
  "async function current(env){return runtime??=(initialize(env));}",
  "export default {async fetch(request,env){",
  " const u=new URL(request.url);",
  " // The __test route is generated ONLY inside this ephemeral Miniflare test.",
  " // Never appears in apps/api/src/index.ts or Wrangler.",
  " if(u.pathname==='/__test/signed-access'){",
  "  const data=await current(env);",
  "  const sub=u.searchParams.get('sub')==='foreign'?'foreign-tester':'invited-tester';",
  "  const access=await data.signAccess(sub);",
  "  return Response.json({test_only_access_jwt:access},{headers:{'cache-control':'no-store'}});",
  " }",
  " if(u.pathname==='/__test/count'){",
  "  const data=await current(env);",
  "  const row=await env.STARRY_SESSION_DB.prepare('SELECT count(*) AS n FROM starry_m1_oauth_attempts').first();",
  "  return Response.json({attempts:row.n,tokenCalls:data.tokenCalls()},{headers:{'cache-control':'no-store'}});",
  " }",
  " const data=await current(env);",
  " const headers=new Headers(request.headers);headers.delete('host');",
  " const body=request.method==='GET'||request.method==='HEAD'?undefined:await request.text();",
  " const proxied=new Request(origin+u.pathname+u.search,{method:request.method,headers,body});",
  " const response=await data.router.handle(proxied);",
  " if(u.pathname==='/v1/starry-id/oauth/google/start'&&response.status===303){",
  "  const authorize=new URL(response.headers.get('location'));",
  "  data.pending.set('test-google-code',{nonce:authorize.searchParams.get('nonce'),sub:'known-subject'});",
  " }",
  " return response;",
  "}};",
 ].join('\n');
}
async function withLocalD1(callback){
 const output=await build({stdin:{
  contents:testWorkerSource(),
  resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),
  sourcefile:'m1-security-stack-workerd.TEST_ONLY.ts',loader:'ts',
 },bundle:true,platform:'browser',format:'esm',target:'es2022',
 write:false,logLevel:'silent'});
 const mf=new Miniflare({workers:[{config:{
  name:'m1-secure-staging-stack-local-test-not-deployed',
  compatibilityDate:'2026-10-24',
  manifest:{mainModule:'index.js',modules:{
   'index.js':{type:'esm',contents:output.outputFiles[0].text},
  }},
  env:{STARRY_SESSION_DB:{type:'d1',id:dbId}},
 }}]});
 try{
  const db=await mf.getD1Database('STARRY_SESSION_DB');
  for(const p of paths){
   const sql=readFileSync(new URL(p,import.meta.url),'utf8')
    .replace(/^\s*--[^\n]*$/gm,'').trim();
   const fragments=sql.split(/;\s*(?=PRAGMA|CREATE|$)/gi)
    .map(part=>part.trim()).filter(Boolean);
   for(const statement of fragments){
    if(/^PRAGMA foreign_keys\s*=\s*ON/i.test(statement))continue;
    await db.exec(statement.replace(/\s*\n\s*/g,' '));
   }
  }
  await db.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .bind('u1','active',3,1,'Test Member',0,0,NOW,NOW).run();
  await db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .bind('google','known-subject','u1').run();
  await callback({mf,db});
 }finally{await mf.dispose();}
}
const call=(mf,path,options={})=>mf.dispatchFetch(origin+path,options);
const signedToken=async(mf,sub='invited')=>{
 const result=await call(mf,'/__test/signed-access'+(sub==='foreign'?'?sub=foreign':''));
 assert.equal(result.status,200);
 return (await result.json()).test_only_access_jwt;
};
const count=async(mf)=> (await (await call(mf,'/__test/count')).json());
test('genuine local workerd/SQLite D1 verifies signed Access + nonextractable Worker keys + one Auth HTTPS route through GET→CAS→logout→replay denial',async()=>{
 await withLocalD1(async({mf,db})=>{
  const startPath='/v1/starry-id/oauth/google/start';
  const member='/v1/starry-id/members/me';
  const logout='/v1/starry-id/sessions/logout';
  assert.equal((await call(mf,startPath)).status,403);
  assert.equal((await call(mf,startPath,{headers:{
   'cf-access-authenticated-user-email':'invited-tester',
  }})).status,403);
  const foreign=await signedToken(mf,'foreign');
  assert.equal((await call(mf,startPath,{headers:{
   'cf-access-jwt-assertion':foreign,
  }})).status,403);
  assert.deepEqual(await count(mf),{attempts:0,tokenCalls:0},
   'unsigned headers/uninvited signed subjects cannot create D1 OAuth attempts');

  const invited=await signedToken(mf);
  const begin=await call(mf,startPath,{headers:{
   'cf-access-jwt-assertion':invited,
  },redirect:'manual'});
  assert.equal(begin.status,303);
  const location=begin.headers.get('location');
  assert.equal(new URL(location).origin,'https://accounts.google.com');
  const state=new URL(location).searchParams.get('state');
  assert.match(state,/^[A-Za-z0-9_-]{32,256}$/);
  const stored=await db.prepare('SELECT code_verifier,consumed_at FROM starry_m1_oauth_attempts WHERE state=?')
   .bind(state).first();
  assert.match(stored.code_verifier,/^m1gcm1\.local-pkce-aes\./);
  assert.equal(stored.consumed_at,null);
  assert.deepEqual(await count(mf),{attempts:1,tokenCalls:0});

  const callback='/v1/starry-id/oauth/google/callback?code=test-google-code&state='+state;
  const authorized=await call(mf,callback,{redirect:'manual'});
  assert.equal(authorized.status,303);
  const redirect=authorized.headers.get('location');
  assert.equal(new URL(redirect).origin,new URL(app).origin);
  assert.equal(new URL(redirect).pathname,new URL(app).pathname);
  assert.equal(new URL(redirect).search,'');
  assert.equal(new URL(redirect).hash.startsWith('#handoff='),true);
  const handoff=new URL(redirect).hash.slice('#handoff='.length);
  assert.match(handoff,/^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await count(mf),{attempts:1,tokenCalls:1});

  const exchange='/v1/starry-id/sessions/exchange';
  const take=await call(mf,exchange,{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({handoff_code:handoff})});
  assert.equal(take.status,200);
  const session=await take.json();
  assert.deepEqual(Object.keys(session).sort(),['access_token','expires_at','token_type'].sort());
  assert.match(session.access_token,/^v1\./);
  assert.equal(session.token_type,'Bearer');
  assert.equal((await call(mf,exchange,{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({handoff_code:handoff})})).status,401);
  const authHeader={authorization:'Bearer '+session.access_token};

  const before=await call(mf,member,{headers:authHeader});
  assert.equal(before.status,200);
  assert.deepEqual(await before.json(),{
   s_user_id:'u1',display_name:'Test Member',
   directory_opt_in:false,display_name_public:false,profile_revision:1,
  });
  const edited=await call(mf,member,{method:'PATCH',
   headers:{...authHeader,'content-type':'application/json',
    'if-match':'"rev-1"'},
   body:JSON.stringify({display_name:'Secured Local User',directory_opt_in:true}),
  });
  assert.equal(edited.status,200);
  assert.equal((await edited.json()).profile_revision,2);
  const stale=await call(mf,member,{method:'PATCH',
   headers:{...authHeader,'content-type':'application/json',
    'if-match':'"rev-1"'},
   body:JSON.stringify({display_name:'Stale'}),
  });
  assert.equal(stale.status,409);
  assert.equal((await call(mf,logout,{method:'POST',
   headers:authHeader})).status,204);
  assert.equal((await call(mf,member,{headers:authHeader})).status,401);
  assert.equal((await call(mf,logout,{method:'POST',
   headers:authHeader})).status,401);
  const revoked=(await db.prepare('SELECT revoked_at FROM starry_sessions').first()).revoked_at;
  assert.equal(Number.isSafeInteger(revoked),true);
  assert.ok(revoked>=NOW&&revoked<=Math.floor(Date.now()/1000)+2,
   'real bound Worker uses wall-clock time, not the former injected frozen test time');
  const audit=(await db.prepare('SELECT event_type FROM starry_m2_member_mutation_audit').all()).results;
  assert.deepEqual(audit.map(x=>x.event_type).sort(),
   ['profile_updated','session_revoked']);
  assert.equal((await call(mf,'/v1/hglobal/members/me')).status,404);
 });
});
