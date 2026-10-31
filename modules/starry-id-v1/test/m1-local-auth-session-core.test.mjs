import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {bytesToBase64url} from '../src/oidc-crypto.ts';
import {createM1LocalAuthSessionCore,M1_AUTH_LIVE_ENABLED} from '../src/m1-local-auth-session-core.ts';
import {createM1OAuthVerifierCustody} from '../src/m1-oauth-verifier-custody.ts';
import {createM1GoogleCodeExchange,M1_GOOGLE_TOKEN_ENDPOINT} from '../src/m1-google-oauth-exchange.ts';
import {createM1M2LocalGoogleFlow,M1_M2_GOOGLE_FLOW_LIVE_ENABLED}
  from '../src/m1-m2-local-google-member-flow.ts';
import {createM1LocalMemberPlatformBridge}
  from '../../../apps/api/src/m1-local-member-platform-bridge.ts';
import {createM1SingleAuthHttpComposition,M1_SINGLE_AUTH_HTTP_LIVE_ENABLED}
  from '../../../apps/api/src/m1-single-auth-http-composition.ts';
const now=1793000000;
const origin='https://id.starry.example';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const utf=x=>new TextEncoder().encode(x);
const b64=x=>bytesToBase64url(x);
async function makeFixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../schema/002_m1_local_oauth_attempts.DRAFT.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../schema/003_m2_local_member_self_mutations.DRAFT.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
   .run('u1','active',3,1,'Registered Member',0,0,now,now);
 db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .run('google','verified-sub','u1');
 const signing=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const providerPair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',providerPair.publicKey);
 const provider={provider:'google',clientId:'starry-test-only-client',issuer:'https://accounts.google.com',
   jwks:[{...jwk,kid:'test-only-kid',alg:'RS256',use:'sig'}]};
 const state={reads:0,writes:0,exchanges:0,keyReads:0,clock:now,blockedWrite:false,failKey:false,beforeInsert:null,dbFault:false,verifySub:'verified-sub'};
 const adapter={
   prepare(sql){
     const values=[];
     return {
       bind(...params){values.splice(0,values.length,...params);return this;},
       async first(){state.reads++;return db.prepare(sql).get(...values)??null;},
       async run(){
         state.writes++;
         if(state.dbFault)throw Error('PRIVATE_SQL_TABLE_NAME');
         if(state.blockedWrite&&sql.startsWith('INSERT INTO starry_sessions'))
           return {success:true,meta:{changes:0}};
         const out=db.prepare(sql).run(...values);
         return {success:true,meta:{changes:out.changes}};
       },
     };
   },
   async batch(statements){
     // Simulate an independent revoke after identity read but BEFORE transaction.
     if(state.beforeInsert){const hook=state.beforeInsert;state.beforeInsert=null;hook();}
     db.exec('BEGIN IMMEDIATE');
     try{
       const results=[];
       for(const statement of statements)results.push(await statement.run());
       if(results.some(v=>v.success===false||v.meta?.changes!==1)){
         db.exec('ROLLBACK');return results;
       }
       db.exec('COMMIT');return results;
     }catch(error){db.exec('ROLLBACK');throw error;}
   },
 };
 const verifier='v'.repeat(43),challenge=b64(new Uint8Array(await webcrypto.subtle.digest('SHA-256',utf(verifier))));
 let counter=0;
 function addAttempt(){
   const oauthState=('s'+String(++counter).padStart(3,'0')).repeat(8);
   const nonce='nonce-'+String(counter).padStart(24,'0');
   db.prepare('INSERT INTO starry_m1_oauth_attempts VALUES(?,?,?,?,?,?,?,?,?,?)')
     .run(oauthState,'google',provider.clientId,verifier,challenge,nonce,'starry-id','staging',now+150,null);
   return {oauthState,nonce};
 }
 async function signIdToken(nonce,subject=state.verifySub,expiresAt=now+300){
   const head=b64(utf(JSON.stringify({alg:'RS256',kid:'test-only-kid',typ:'JWT'})));
   const payload=b64(utf(JSON.stringify({iss:provider.issuer,aud:provider.clientId,
     sub:subject,nonce,iat:now,exp:expiresAt})));
   const signed=head+'.'+payload;
   const mac=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',providerPair.privateKey,utf(signed));
   return signed+'.'+b64(new Uint8Array(mac));
 }
 const tokens=new Map();
 const deps={enabled:true,serverScope:scope,expectedOrigin:origin,authDb:adapter,
   provider,now:()=>state.clock,
   activeKey:async()=>{if(state.failKey)throw Error('PRIVATE_KMS');return {kid:'local-kid',key:signing};},
   getVerificationKey:async kid=>{state.keyReads++;return kid==='local-kid'?signing:null;},
   exchangeCode:async ({code})=>{state.exchanges++;return tokens.has(code)?{idToken:tokens.get(code)}:null;},
 };
 async function prepare(subject='verified-sub'){
   const {oauthState,nonce}=addAttempt();
   const code='code-'+counter;
   tokens.set(code,await signIdToken(nonce,subject));
   return {code,state:oauthState};
 }
 return {db,state,adapter,deps,prepare,signIdToken,addAttempt,close:()=>db.close()};
}
test('M1 default OFF and foreign/production scopes fail closed without DB access',async()=>{
 const f=await makeFixture();try{
  assert.equal(M1_AUTH_LIVE_ENABLED,false);
  const core=createM1LocalAuthSessionCore({...f.deps,enabled:false});
  assert.equal(await core.issueFromVerifiedCallback(await f.prepare()),null);
  assert.equal(f.state.reads,0);assert.equal(f.state.exchanges,0);
  for(const serverScope of [{...scope,environment:'production'},{...scope,brand_id:'hglobal'},{...scope,app_id:'other'}])
   assert.throws(()=>createM1LocalAuthSessionCore({...f.deps,serverScope}));
 }finally{f.close();}
});
test('REAL RS256 OIDC callback + SQLite attempt CAS + durable HMAC session + W3 exact five fields',async()=>{
 const f=await makeFixture();try{
  const input=await f.prepare();
  const core=createM1LocalAuthSessionCore(f.deps);
  const issued=await core.issueFromVerifiedCallback(input);
  assert.equal(issued?.status,'issued');
  assert.equal(issued?.s_user_id,'u1');
  const stored=f.db.prepare('SELECT * FROM starry_sessions WHERE session_id=?')
    .get(JSON.parse(Buffer.from(issued.bearer.split('.')[1],'base64url').toString()).session_id);
  assert.equal(stored.s_user_id,'u1');assert.equal(stored.app_id,'starry-id');
  assert.equal(stored.environment,'staging');assert.equal(stored.auth_version,3);
  assert.equal(stored.refresh_hash.length,64);
  const response=await core.readSelf(new Request(origin+'/v1/starry-id/members/me',{
    headers:{authorization:'Bearer '+issued.bearer},
  }));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{s_user_id:'u1',display_name:'Registered Member',
    directory_opt_in:false,display_name_public:false,profile_revision:1});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(await core.issueFromVerifiedCallback(input),null);
  assert.equal(f.state.exchanges,1);
 }finally{f.close();}
});
test('one-time OAuth CAS concurrent callback gives exactly one signer and one Session',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore(f.deps),input=await f.prepare();
  const results=await Promise.all([core.issueFromVerifiedCallback(input),core.issueFromVerifiedCallback(input)]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,1);
  assert.equal(f.state.exchanges,1);
 }finally{f.close();}
});
test('first verified subject creates member+identity+session+two minimal audit events atomically, never links by email',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore(f.deps);
  const got=await core.issueFromVerifiedCallback(await f.prepare('unlinked-subject'));
  assert.equal(got?.status,'issued');
  assert.ok(got.s_user_id.startsWith('su-'));
  assert.notEqual(got.s_user_id,'u1');
  const record=f.db.prepare('SELECT * FROM starry_members WHERE s_user_id=?').get(got.s_user_id);
  assert.equal(record.display_name,null);
  assert.equal(record.directory_opt_in,0);assert.equal(record.display_name_public,0);
  assert.equal(record.status,'active');assert.equal(record.auth_version,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_identities WHERE provider=? AND subject=? AND s_user_id=?')
    .get('google','unlinked-subject',got.s_user_id).n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').get().n,2);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_members').get().n,2);
 }finally{f.close();}
});
test('unknown code and expired attempt reject before issuance',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore(f.deps);
  const bad=await f.prepare();
  assert.equal(await core.issueFromVerifiedCallback({code:'unknown',state:bad.state}),null);
  const expired=await f.prepare();f.state.clock=now+151;
  assert.equal(await core.issueFromVerifiedCallback(expired),null);
 }finally{f.close();}
});
test('session insert fence rejects revoked/suspended member and failed commit with no bearer',async()=>{
 for(const mode of ['suspended','deleted','blocked']){
  const f=await makeFixture();try{
   const core=createM1LocalAuthSessionCore(f.deps);
   const input=await f.prepare();
   if(mode==='blocked')f.state.blockedWrite=true;
   else f.db.prepare('UPDATE starry_members SET status=? WHERE s_user_id=?').run(mode,'u1');
   assert.equal(await core.issueFromVerifiedCallback(input),null);
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
  }finally{f.close();}
 }
});
test('revoked Session and provider unlink immediately deny previously issued W3 read',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at=1793000000",
  "DELETE FROM starry_identities WHERE provider='google'",
  "UPDATE starry_members SET auth_version=4",
 ]){
  const f=await makeFixture();try{
   const core=createM1LocalAuthSessionCore(f.deps);
   const issued=await core.issueFromVerifiedCallback(await f.prepare());
   assert.ok(issued);
   f.db.exec(sql);
   const response=await core.readSelf(new Request(origin+'/v1/starry-id/members/me',{
    headers:{authorization:'Bearer '+issued.bearer},
   }));
   assert.notEqual(response.status,200);
  }finally{f.close();}
 }
});

test('RS256 signature tamper and wrong nonce deny without a Session',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore(f.deps);
  const first=await f.prepare();
  const good=f.db.prepare('SELECT nonce FROM starry_m1_oauth_attempts WHERE state=?').get(first.state).nonce;
  const valid=await f.signIdToken(good);
  const parts=valid.split('.');
  const tampered=parts[0]+'.'+parts[1]+'.'+(parts[2].endsWith('A')?'B':'A');
  const badCore=createM1LocalAuthSessionCore({...f.deps,exchangeCode:async()=>({idToken:tampered})});
  assert.equal(await badCore.issueFromVerifiedCallback(first),null);
  const second=await f.prepare();
  const wrongNonceCore=createM1LocalAuthSessionCore({...f.deps,
    exchangeCode:async()=>({idToken:await f.signIdToken('nonce-not-the-original-state')})});
  assert.equal(await wrongNonceCore.issueFromVerifiedCallback(second),null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
 }finally{f.close();}
});
test('wrong KID or inaccessible signer fails closed before session INSERT',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore({...f.deps,activeKey:async()=>null});
  const input=await f.prepare();
  assert.equal(await core.issueFromVerifiedCallback(input),null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
 }finally{f.close();}
});

test('SQL/KMS exceptions are sanitized and no bearer or SQL detail escapes',async()=>{
 for(const fault of ['key','db']){
  const f=await makeFixture();try{
   if(fault==='key')f.state.failKey=true;
   else f.state.dbFault=true;
   const core=createM1LocalAuthSessionCore(f.deps);
   const got=await core.issueFromVerifiedCallback(await f.prepare());
   assert.equal(got,null);
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
  }finally{f.close();}
 }
});
test('mutable provider clientId/issuer/JWKS after constructor cannot change trusted authority',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore(f.deps);
  const input=await f.prepare();
  f.deps.provider.clientId='attacker-client';
  f.deps.provider.issuer='https://appleid.apple.com';
  f.deps.provider.jwks=[];
  const got=await core.issueFromVerifiedCallback(input);
  assert.equal(got?.status,'issued');
  const token=JSON.parse(Buffer.from(got.bearer.split('.')[1],'base64url').toString());
  assert.equal(token.provider,'google');assert.equal(token.provider_subject,'verified-sub');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,1);
 }finally{f.close();}
});
test('INSERT fence rejects member version bump, suspension or provider unlink after identity pre-read',async()=>{
 for(const action of [
  ()=>"UPDATE starry_members SET auth_version=auth_version+1 WHERE s_user_id='u1'",
  ()=>"UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  ()=>"DELETE FROM starry_identities WHERE provider='google'",
 ]){
  const f=await makeFixture();try{
   const core=createM1LocalAuthSessionCore(f.deps);
   f.state.beforeInsert=()=>f.db.exec(action());
   assert.equal(await core.issueFromVerifiedCallback(await f.prepare()),null);
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
  }finally{f.close();}
 }
});
test('bad client callback claims fail strict parser; no DB-authenticated principal from client JSON',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore(f.deps);
  const input=await f.prepare();
  assert.equal(await core.issueFromVerifiedCallback({...input,s_user_id:'other'}),null);
  assert.equal(await core.issueFromVerifiedCallback({...input,app_id:'other'}),null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
 }finally{f.close();}
});
test('expired trusted time during key await rejects issuance and leaves Session absent',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore({...f.deps,activeKey:async()=>{
   f.state.clock=now+301;
   return f.deps.activeKey();
  }});
  const got=await core.issueFromVerifiedCallback(await f.prepare());
  assert.equal(got,null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
 }finally{f.close();}
});

test('server-generated login-start persists unique PKCE SHA256 challenge, nonce and state only in local SQLite',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore(f.deps);
  const a=await core.beginOAuthAttempt(),b=await core.beginOAuthAttempt();
  assert.ok(a?.state);assert.notEqual(a.state,b.state);
  assert.equal(a.provider,'google');assert.equal(Object.hasOwn(a,'codeVerifier'),false);
  assert.equal(typeof a.nonce,'string');
  const stored=f.db.prepare('SELECT * FROM starry_m1_oauth_attempts WHERE state=?').get(a.state);
  const digest=new Uint8Array(await webcrypto.subtle.digest('SHA-256',utf(stored.code_verifier)));
  assert.equal(b64(digest),a.codeChallenge);
  assert.equal(stored.consumed_at,null);assert.equal(stored.environment,'staging');
  assert.ok(stored.nonce.length>=16);
 }finally{f.close();}
});
test('two valid first-login attempts for one subject never create orphan member or replace mapping',async()=>{
 const f=await makeFixture();try{
  const core=createM1LocalAuthSessionCore(f.deps);
  const [a,b]=await Promise.all([
    core.issueFromVerifiedCallback(await f.prepare('first-login-sub')),
    core.issueFromVerifiedCallback(await f.prepare('first-login-sub')),
  ]);
  const identities=f.db.prepare('SELECT s_user_id FROM starry_identities WHERE provider=? AND subject=?')
    .all('google','first-login-sub');
  assert.equal(identities.length,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_members').get().n,2);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,[a,b].filter(Boolean).length);
  for(const result of [a,b].filter(Boolean))assert.equal(result.s_user_id,identities[0].s_user_id);
 }finally{f.close();}
});
test('first-login SQL audit failure atomically rolls back member, identity and Session but never reactivates OAuth state',async()=>{
 const f=await makeFixture();try{
  const adapter={...f.adapter,batch:async stmts=>{
    const base=stmts[stmts.length-1];
    // inject an impossible audit event to force SQLite CHECK/FK failure
    const illegal=f.adapter.prepare('INSERT INTO starry_m1_audit_intents(event_id,source_operation_id,event_type,brand_id,app_id,environment,s_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind('invalid','invalid','invalid-event','starry','starry-id','staging','u1',now);
    return f.adapter.batch([...stmts,illegal]);
  }};
  const core=createM1LocalAuthSessionCore({...f.deps,authDb:adapter});
  const input=await f.prepare('will-not-register');
  assert.equal(await core.issueFromVerifiedCallback(input),null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_members').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_identities').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').get().n,0);
  assert.notEqual(f.db.prepare('SELECT consumed_at FROM starry_m1_oauth_attempts WHERE state=?')
    .get(input.state).consumed_at,null);
  assert.equal(await core.issueFromVerifiedCallback(input),null);
 }finally{f.close();}
});

test('Google token exchange + sealed PKCE + real RS256/HMAC + SQLite and W3 five-field compose',async()=>{
 const f=await makeFixture();try{
  const aes=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const custody=createM1OAuthVerifierCustody({
   activeKey:async()=>({kid:'test-only-aes-1',key:aes}),
   findKey:async kid=>kid==='test-only-aes-1'?aes:null,
  });
  const transportLog=[];
  let nonce='';
  const exchangeCode=createM1GoogleCodeExchange({
   enabled:true,clientId:f.deps.provider.clientId,
   redirectUri:origin+'/v1/starry-id/oauth/google/callback',
   readClientSecret:async()=> 'test-only-secret-not-for-deployment',
   transport:async(url,init)=>{
    transportLog.push({url,init});
    return new Response(JSON.stringify({id_token:await f.signIdToken(nonce),access_token:'not-for-client'}),
      {headers:{'content-type':'application/json'}});
   },
  });
  const core=createM1LocalAuthSessionCore({...f.deps,verifierCustody:custody,
    requireSealedVerifier:true,exchangeCode});
  const started=await core.beginOAuthAttempt();
  assert.equal(started?.provider,'google');
  nonce=started.nonce;
  const attempt=f.db.prepare('SELECT * FROM starry_m1_oauth_attempts WHERE state=?').get(started.state);
  assert.ok(attempt.code_verifier.startsWith('m1gcm1.test-only-aes-1.'));
  assert.equal(attempt.code_verifier.includes('v'.repeat(43)),false);
  const issued=await core.issueFromVerifiedCallback({state:started.state,code:'test-only-google-code'});
  assert.equal(issued?.status,'issued');assert.equal(issued?.s_user_id,'u1');
  assert.equal(transportLog.length,1);
  assert.equal(transportLog[0].url,M1_GOOGLE_TOKEN_ENDPOINT);
  const sent=new URLSearchParams(transportLog[0].init.body);
  assert.ok(/^[A-Za-z0-9._~-]{43,128}$/.test(sent.get('code_verifier')));
  assert.equal(sent.get('client_id'),f.deps.provider.clientId);
  const response=await core.readSelf(new Request(origin+'/v1/starry-id/members/me',{
    headers:{authorization:'Bearer '+issued.bearer},
  }));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    s_user_id:'u1',display_name:'Registered Member',
    directory_opt_in:false,display_name_public:false,profile_revision:1,
  });
  assert.equal(await core.issueFromVerifiedCallback({state:started.state,code:'test-only-google-code'}),null);
  assert.equal(transportLog.length,1);
 }finally{f.close();}
});
test('encrypted PKCE authority binding and KID mutation deny before code exchange',async()=>{
 for(const mutation of [
  "UPDATE starry_m1_oauth_attempts SET expires_at=expires_at+1",
  "UPDATE starry_m1_oauth_attempts SET client_id='tampered-client'",
  "UPDATE starry_m1_oauth_attempts SET code_verifier=replace(code_verifier,'m1gcm1.','m1gcm1.other-')",
 ]){
  const f=await makeFixture();try{
   const aes=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   const custody=createM1OAuthVerifierCustody({
    activeKey:async()=>({kid:'kid-a',key:aes}),
    findKey:async kid=>kid==='kid-a'?aes:null,
   });
   const core=createM1LocalAuthSessionCore({...f.deps,verifierCustody:custody,requireSealedVerifier:true});
   const started=await core.beginOAuthAttempt();
   assert.ok(started);
   f.db.exec(mutation);
   assert.equal(await core.issueFromVerifiedCallback({state:started.state,code:'unused-code'}),null);
   assert.equal(f.state.exchanges,0);
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
  }finally{f.close();}
 }
});
test('remote staging verifier custody required refuses plaintext fallback at construction',async()=>{
 const f=await makeFixture();try{
  assert.throws(()=>createM1LocalAuthSessionCore({...f.deps,requireSealedVerifier:true}),
    /M1_AUTH_CONFIGURATION_DENIED/);
 }finally{f.close();}
});

/** The single shared SQLite authority is the actual M1+M2 local composition.
 * All credential responses below use freshly generated test-only RS256 keys,
 * never a real Google credential or provider network request.
 */
async function createClosedLocalGoogleFlow(f,configureDeps){
 const aes=await webcrypto.subtle.generateKey(
  {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const custody=createM1OAuthVerifierCustody({
  activeKey:async()=>({kid:'local-test-aes',key:aes}),
  findKey:async kid=>kid==='local-test-aes'?aes:null,
 });
 const ctx={nonce:'',subject:'verified-sub',calls:[],overrideToken:null};
 const config={
  enabled:true,serverScope:f.deps.serverScope,expectedOrigin:f.deps.expectedOrigin,
  redirectUri:origin+'/v1/starry-id/oauth/google/callback',
  authDb:f.adapter,googleProvider:f.deps.provider,verifierCustody:custody,
  activeKey:f.deps.activeKey,getVerificationKey:f.deps.getVerificationKey,
  now:f.deps.now,
  readGoogleClientSecret:async()=> 'test-only-confidential-client-secret',
  googleTransport:async (url,init)=>{
   ctx.calls.push({url,init});
   const idToken=ctx.overrideToken ?? await f.signIdToken(ctx.nonce,ctx.subject);
   return new Response(JSON.stringify({id_token:idToken,access_token:'NOT_FOR_CLIENT'}),
    {status:200,headers:{'content-type':'application/json'}});
  },
 };
 configureDeps?.(config);
 const flow=createM1M2LocalGoogleFlow(config);
 async function start(){
  const authorizeUrl=await flow.beginGoogleLogin();
  assert.equal(typeof authorizeUrl,'string');
  const url=new URL(authorizeUrl);
  ctx.nonce=url.searchParams.get('nonce');
  const state=url.searchParams.get('state');
  assert.ok(state&&ctx.nonce);
  return {url,state,code:'test-only-auth-code'};
 }
 const request=(path,bearer,init={})=>new Request(origin+path,{
  ...init,headers:{authorization:'Bearer '+bearer,...init.headers},
 });
 const self=bearer=>request('/v1/starry-id/members/me',bearer);
 const patch=(bearer,revision,body)=>request('/v1/starry-id/members/me',bearer,{
  method:'PATCH',headers:{'content-type':'application/json','if-match':'"rev-'+revision+'"'},
  body:JSON.stringify(body),
 });
 const logout=bearer=>request('/v1/starry-id/sessions/logout',bearer,{method:'POST'});
 return {flow,config,ctx,start,self,patch,logout,custody};
}
// Independent post-#281 scoped regression with a REAL signed HMAC session,
// original Google/SQLite Auth handler and original M2 mutation port.
test('merged M1 bridge preserves safe 400 on forbidden PATCH and nonempty logout without SQLite writes',async()=>{
 const f=await makeFixture();try{
  const x=await createClosedLocalGoogleFlow(f);
  const bridge=createM1LocalMemberPlatformBridge({
   enabled:true,scope,expectedOrigin:origin,
   readPort:{handle:request=>x.flow.readSelf(request)},
   mutationPort:{handle:request=>x.flow.mutateSelf(request)},
  });
  const attempt=await x.start();
  const issued=await x.flow.completeGoogleLogin({state:attempt.state,code:attempt.code});
  assert.equal(issued?.status,'issued');
  const forbidden=await bridge.handle(x.patch(issued.bearer,1,{
   unsafe_member_field:'DO_NOT_STORE',
  }));
  assert.equal(forbidden.status,400);
  assert.deepEqual(await forbidden.json(),{error:{code:'PROFILE_FIELDS_DENIED'}});
  const badLogout=await bridge.handle(new Request(origin+'/v1/starry-id/sessions/logout',{
   method:'POST',headers:{authorization:'Bearer '+issued.bearer,'content-type':'application/json'},
   body:'{}',
  }));
  assert.equal(badLogout.status,400);
  assert.deepEqual(await badLogout.json(),{error:{code:'REQUEST_DENIED'}});
  assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members WHERE s_user_id=?')
   .get('u1').profile_revision,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m2_member_mutation_audit')
   .get().n,0);
  const session=f.db.prepare('SELECT revoked_at FROM starry_sessions').get();
  assert.equal(session.revoked_at,null);
  assert.equal((await bridge.handle(x.self(issued.bearer))).status,200);
 }finally{f.close();}
});

// A mutable trusted DI object must not silently split the M1 OAuth Session
// and M2 profile/logout across two D1 authorities or environments.
test('M1 and M2 capture one Starry D1 and scope despite changing composition getters',async()=>{
 for(const dimension of ['authDb','serverScope']){
  const f=await makeFixture();try{
   let reads=0;
   const x=await createClosedLocalGoogleFlow(f,config=>{
    Object.defineProperty(config,dimension,{get(){
     reads++;
     if(dimension==='authDb')return reads===1?f.adapter:{
      prepare(){throw Error('WRONG_AUTH_DATABASE');},
      async batch(){throw Error('WRONG_AUTH_DATABASE');},
     };
     return reads===1?scope:{...scope,environment:'development'};
    }});
   });
   const attempt=await x.start();
   const issued=await x.flow.completeGoogleLogin({state:attempt.state,code:attempt.code});
   assert.equal(issued?.status,'issued',dimension);
   assert.equal((await x.flow.readSelf(x.self(issued.bearer))).status,200,dimension);
   const patched=await x.flow.mutateSelf(x.patch(issued.bearer,1,{
    display_name:'One Starry Authority',
   }));
   assert.equal(patched.status,200,dimension+' cannot redirect the M2 write');
   assert.equal(f.db.prepare('SELECT display_name FROM starry_members WHERE s_user_id=?')
    .get('u1').display_name,'One Starry Authority');
   assert.equal((await x.flow.mutateSelf(x.logout(issued.bearer))).status,204,dimension);
   assert.equal(reads,1,dimension+' must be read just once at composition');
  }finally{f.close();}
 }
});

// Complement the already merged #296 single-D1/scope fence: a signed
// Session's verification key provider and clock must also be identical for
// M1 issuer/reader and M2 mutation/logout. No new Auth or DB fixture.
test('M1/M2 key verification and clock function are each captured once in the original signed SQLite flow',async()=>{
 for(const field of ['getVerificationKey','now']){
  const f=await makeFixture();try{
   let getterReads=0;
   const x=await createClosedLocalGoogleFlow(f,config=>{
    Object.defineProperty(config,field,{get(){
     getterReads++;
     if(getterReads===1)return f.deps[field];
     // Simulates a misconfigured mutable container switching Auth authority
     // after the core is constructed, before M2 receives its dependencies.
     return field==='getVerificationKey'?async()=>null:()=>now+3600;
    }});
   });
   const attempt=await x.start();
   const issued=await x.flow.completeGoogleLogin({state:attempt.state,code:attempt.code});
   assert.equal(issued?.status,'issued',field);
   assert.equal((await x.flow.readSelf(x.self(issued.bearer))).status,200,field);
   const update=await x.flow.mutateSelf(x.patch(issued.bearer,1,{
    display_name:'Shared Auth Clock and Key',
   }));
   assert.equal(update.status,200,field+' must keep the original Session authority');
   assert.equal(f.db.prepare('SELECT display_name,profile_revision FROM starry_members WHERE s_user_id=?')
    .get('u1').display_name,'Shared Auth Clock and Key');
   assert.equal((await x.flow.mutateSelf(x.logout(issued.bearer))).status,204,field);
   assert.equal((await x.flow.readSelf(x.self(issued.bearer))).status,401,field);
   assert.equal(getterReads,1,field+' must be read exactly once at flow construction');
  }finally{f.close();}
 }
});

test('single REAL local Google → sealed attempt → RS256 → SQLite Session → W3 GET → CAS → logout loop',async()=>{
 const f=await makeFixture();try{
  const x=await createClosedLocalGoogleFlow(f);
  assert.equal(M1_M2_GOOGLE_FLOW_LIVE_ENABLED,false);
  assert.equal(x.flow.public_worker_route_registered,false);
  const begin=await x.start();
  assert.equal(begin.url.origin,'https://accounts.google.com');
  assert.equal(begin.url.searchParams.get('scope'),'openid');
  assert.equal(begin.url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(begin.url.searchParams.has('client_secret'),false);
  assert.equal(begin.url.searchParams.has('code_verifier'),false);
  const stored=f.db.prepare('SELECT code_verifier,consumed_at FROM starry_m1_oauth_attempts WHERE state=?').get(begin.state);
  assert.ok(stored.code_verifier.startsWith('m1gcm1.local-test-aes.'));
  assert.equal(stored.consumed_at,null);
  const issued=await x.flow.completeGoogleLogin({code:begin.code,state:begin.state});
  assert.equal(issued?.status,'issued');
  assert.equal(issued?.s_user_id,'u1');
  assert.equal(x.ctx.calls.length,1);
  assert.equal(x.ctx.calls[0].url,M1_GOOGLE_TOKEN_ENDPOINT);
  const posted=new URLSearchParams(x.ctx.calls[0].init.body);
  assert.equal(posted.get('grant_type'),'authorization_code');
  assert.match(posted.get('code_verifier'),/^[A-Za-z0-9._~-]{43,128}$/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').get().n,1);
  assert.deepEqual(await (await x.flow.readSelf(x.self(issued.bearer))).json(),{
   s_user_id:'u1',display_name:'Registered Member',
   directory_opt_in:false,display_name_public:false,profile_revision:1,
  });
  const updated=await x.flow.mutateSelf(x.patch(issued.bearer,1,{
   display_name:'Approved Public Name',directory_opt_in:true,display_name_public:true,
  }));
  assert.equal(updated.status,200);
  assert.deepEqual(await updated.json(),{
   s_user_id:'u1',display_name:'Approved Public Name',
   directory_opt_in:true,display_name_public:true,profile_revision:2,
  });
  const latest=await x.flow.readSelf(x.self(issued.bearer));
  assert.equal(latest.status,200);
  assert.deepEqual(await latest.json(),{
   s_user_id:'u1',display_name:'Approved Public Name',
   directory_opt_in:true,display_name_public:true,profile_revision:2,
  });
  const [a,b]=await Promise.all([
   x.flow.mutateSelf(x.patch(issued.bearer,2,{display_name:'First Winner'})),
   x.flow.mutateSelf(x.patch(issued.bearer,2,{display_name:'Second Winner'})),
  ]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members WHERE s_user_id=?').get('u1').profile_revision,3);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m2_member_mutation_audit WHERE event_type=?').get('profile_updated').n,2);
  const logout=await x.flow.mutateSelf(x.logout(issued.bearer));
  assert.equal(logout.status,204);
  assert.equal((await x.flow.readSelf(x.self(issued.bearer))).status,401);
  assert.equal((await x.flow.mutateSelf(x.logout(issued.bearer))).status,401);
  assert.equal((await x.flow.mutateSelf(x.patch(issued.bearer,3,{display_name:'Denied'}))).status,401);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m2_member_mutation_audit WHERE event_type=?').get('session_revoked').n,1);
  assert.equal(await x.flow.completeGoogleLogin({code:begin.code,state:begin.state}),null);
  assert.equal(x.ctx.calls.length,1);
  const allAudits=JSON.stringify(f.db.prepare('SELECT * FROM starry_m2_member_mutation_audit').all());
  for(const secret of ['Approved Public Name','First Winner','Second Winner',issued.bearer,'NOT_FOR_CLIENT']){
   assert.equal(allAudits.includes(secret),false);
  }
 }finally{f.close();}
});
test('first verified Google subject registers new private member, CAS owns ONLY that member, no email matching',async()=>{
 const f=await makeFixture();try{
  const x=await createClosedLocalGoogleFlow(f);
  x.ctx.subject='first-login-new-subject';
  const begin=await x.start();
  const issued=await x.flow.completeGoogleLogin({state:begin.state,code:begin.code});
  assert.equal(issued?.status,'issued');
  assert.ok(issued.s_user_id.startsWith('su-'));
  assert.notEqual(issued.s_user_id,'u1');
  const old=f.db.prepare('SELECT display_name,profile_revision FROM starry_members WHERE s_user_id=?').get('u1');
  assert.deepEqual({...old},{display_name:'Registered Member',profile_revision:1});
  const created=await x.flow.readSelf(x.self(issued.bearer));
  assert.deepEqual(await created.json(),{
   s_user_id:issued.s_user_id,display_name:null,
   directory_opt_in:false,display_name_public:false,profile_revision:1,
  });
  const changed=await x.flow.mutateSelf(x.patch(issued.bearer,1,{display_name:'Self Only'}));
  assert.equal(changed.status,200);
  const record=f.db.prepare('SELECT display_name,profile_revision FROM starry_members WHERE s_user_id=?').get(issued.s_user_id);
  assert.equal(record.display_name,'Self Only');assert.equal(record.profile_revision,2);
  assert.deepEqual({...f.db.prepare('SELECT display_name,profile_revision FROM starry_members WHERE s_user_id=?').get('u1')},{...old});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').get().n,2);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m2_member_mutation_audit').get().n,1);
 }finally{f.close();}
});
test('one-time Google callback concurrent replay grants only one durable Session, others denied',async()=>{
 const f=await makeFixture();try{
  const x=await createClosedLocalGoogleFlow(f);
  const begin=await x.start();
  const results=await Promise.all(Array.from({length:3},
   ()=>x.flow.completeGoogleLogin({state:begin.state,code:begin.code})));
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(x.ctx.calls.length,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').get().n,1);
 }finally{f.close();}
});
test('pinned Google issuer/audience, nonce, RS256 signature and clock reject without member or Session mutation',async()=>{
 for(const scenario of ['wrong-nonce','wrong-issuer','wrong-audience','bad-signature','expired-state']){
  const f=await makeFixture();try{
   const x=await createClosedLocalGoogleFlow(f);
   const begin=await x.start();
   if(scenario==='wrong-nonce')x.ctx.nonce='attacker-invalid-nonce-0123456789';
   if(scenario==='wrong-issuer')f.deps.provider.issuer='https://appleid.apple.com';
   if(scenario==='wrong-audience')f.deps.provider.clientId='forged-client';
   if(scenario==='bad-signature'){
    const original=await f.signIdToken(x.ctx.nonce);
    const parts=original.split('.');
    parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
    x.ctx.overrideToken=parts.join('.');
   }
   if(scenario==='expired-state')f.state.clock=now+181;
   assert.equal(await x.flow.completeGoogleLogin({state:begin.state,code:begin.code}),null,scenario);
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0,scenario);
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').get().n,0,scenario);
   assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m2_member_mutation_audit').get().n,0,scenario);
  }finally{f.close();}
 }
});
test('current auth_version, suspension, identity unlink and cross-origin deny W3/CAS/logout after Google issue',async()=>{
 for(const change of [
  "UPDATE starry_members SET auth_version=auth_version+1 WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "DELETE FROM starry_identities WHERE provider='google' AND s_user_id='u1'",
 ]){
  const f=await makeFixture();try{
   const x=await createClosedLocalGoogleFlow(f),begin=await x.start();
   const issued=await x.flow.completeGoogleLogin({state:begin.state,code:begin.code});
   assert.ok(issued);
   assert.notEqual((await x.flow.readSelf(new Request('https://foreign.example/v1/starry-id/members/me',{
    headers:{authorization:'Bearer '+issued.bearer},
   }))).status,200);
   assert.notEqual((await x.flow.mutateSelf(new Request('https://foreign.example/v1/starry-id/members/me',{
    method:'PATCH',headers:{authorization:'Bearer '+issued.bearer},
   }))).status,200);
   f.db.exec(change);
   assert.equal((await x.flow.readSelf(x.self(issued.bearer))).status,401);
   assert.notEqual((await x.flow.mutateSelf(x.patch(issued.bearer,1,{display_name:'Denied'}))).status,200);
   assert.notEqual((await x.flow.mutateSelf(x.logout(issued.bearer))).status,204);
   assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members WHERE s_user_id=?').get('u1').profile_revision,1);
  }finally{f.close();}
 }
});
test('composed Google flow OFF / foreign scope / cross-origin callback / missing custody fail closed',async()=>{
 const f=await makeFixture();try{
  assert.throws(()=>createM1M2LocalGoogleFlow({
   enabled:true,serverScope:scope,expectedOrigin:origin,
   redirectUri:'https://foreign.example/v1/starry-id/oauth/google/callback',
   authDb:f.adapter,googleProvider:f.deps.provider,
   verifierCustody:null,activeKey:f.deps.activeKey,
   getVerificationKey:f.deps.getVerificationKey,now:f.deps.now,
   readGoogleClientSecret:async()=>null,googleTransport:async()=>new Response(),
  }),/M1_M2_GOOGLE_FLOW_CONFIGURATION_DENIED|ORIGIN_DENIED/);
  const x=await createClosedLocalGoogleFlow(f);
  const off=createM1M2LocalGoogleFlow({
   enabled:false,serverScope:scope,expectedOrigin:origin,
   redirectUri:origin+'/v1/starry-id/oauth/google/callback',
   authDb:f.adapter,googleProvider:f.deps.provider,
   verifierCustody:x.custody,activeKey:f.deps.activeKey,
   getVerificationKey:f.deps.getVerificationKey,now:f.deps.now,
   readGoogleClientSecret:async()=>{throw Error('NEVER_LOAD_SECRETS');},
   googleTransport:async()=>{throw Error('NEVER_CALL_PROVIDER');},
  });
  assert.equal(await off.beginGoogleLogin(),null);
  assert.equal(await off.completeGoogleLogin({code:'x',state:'s'.repeat(43)}),null);
  assert.equal((await off.readSelf(new Request(origin+'/v1/starry-id/members/me'))).status,503);
  assert.equal((await off.mutateSelf(new Request(origin+'/v1/starry-id/sessions/logout',{
   method:'POST',
  }))).status,503);
 }finally{f.close();}
});

// Pause inside the real sealed-attempt await, then mutate the caller-owned
// configuration. Authorization and token exchange must share the validated URL.
test('Google redirect stays pinned when caller mutates deps during beginOAuthAttempt await',async()=>{
 const f=await makeFixture();try{
  const x=await createClosedLocalGoogleFlow(f);
  let entered,release;
  const paused=new Promise(resolve=>{entered=resolve;});
  const resumed=new Promise(resolve=>{release=resolve;});
  const redirectUri=origin+'/v1/starry-id/oauth/google/callback';
  const deps={enabled:true,serverScope:scope,expectedOrigin:origin,redirectUri,
   authDb:f.adapter,googleProvider:f.deps.provider,
   verifierCustody:{
    async seal(...args){entered();await resumed;return x.custody.seal(...args);},
    open:(...args)=>x.custody.open(...args),
   },
   activeKey:f.deps.activeKey,getVerificationKey:f.deps.getVerificationKey,
   now:f.deps.now,readGoogleClientSecret:async()=> 'test-only-secret',
   googleTransport:async (_url,init)=>{
    assert.equal(new URLSearchParams(init.body).get('redirect_uri'),redirectUri);
    return new Response(JSON.stringify({id_token:await f.signIdToken(nonce)}),{
     status:200,headers:{'content-type':'application/json'},
    });
   },
  };
  const flow=createM1M2LocalGoogleFlow(deps);
  const pending=flow.beginGoogleLogin();
  await paused;
  deps.redirectUri='https://foreign.example/changed-callback';
  release();
  const url=new URL(await pending);
  assert.equal(url.searchParams.get('redirect_uri'),redirectUri);
  const nonce=url.searchParams.get('nonce');
  const issued=await flow.completeGoogleLogin({code:'test-only-code',state:url.searchParams.get('state')});
  assert.ok(issued?.bearer);
  assert.equal((await flow.readSelf(x.self(issued.bearer))).status,200);
 }finally{f.close();}
});

test('single-Auth HTTP composition executes original RS256+AES-GCM+HMAC+SQLite member lifecycle through the REAL bridge',async()=>{
 const f=await makeFixture();try{
  const x=await createClosedLocalGoogleFlow(f);
  const slice=createM1SingleAuthHttpComposition(x.config);
  assert.equal(M1_SINGLE_AUTH_HTTP_LIVE_ENABLED,false);
  assert.equal(slice.live_enabled,false);
  assert.equal(slice.public_worker_route_registered,false);
  assert.equal(slice.local_only,true);
  const authorization=await slice.beginGoogleLogin();
  const url=new URL(authorization);
  assert.equal(url.origin,'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.has('code_verifier'),false);
  x.ctx.nonce=url.searchParams.get('nonce');
  const issued=await slice.completeGoogleLogin({
   code:'test-only-auth-code',state:url.searchParams.get('state'),
  });
  assert.equal(issued?.status,'issued');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM starry_sessions').get().n,1);
  const first=await slice.handleMember(x.self(issued.bearer));
  assert.equal(first.status,200);
  assert.deepEqual(await first.json(),{
   s_user_id:'u1',display_name:'Registered Member',directory_opt_in:false,
   display_name_public:false,profile_revision:1,
  });
  const updated=await slice.handleMember(x.patch(issued.bearer,1,{
   display_name:'One Scoped Http Auth',
  }));
  assert.equal(updated.status,200);
  assert.equal((await updated.json()).profile_revision,2);
  assert.equal(f.db.prepare('SELECT display_name FROM starry_members WHERE s_user_id=?')
   .get('u1').display_name,'One Scoped Http Auth');
  const forbidden=await slice.handleMember(x.patch(issued.bearer,2,{
   forbidden_member_id:'never',
  }));
  assert.equal(forbidden.status,400);
  assert.deepEqual(await forbidden.json(),{error:{code:'PROFILE_FIELDS_DENIED'}});
  assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members WHERE s_user_id=?')
   .get('u1').profile_revision,2);
  const logout=await slice.handleMember(x.logout(issued.bearer));
  assert.equal(logout.status,204);
  assert.equal((await slice.handleMember(x.self(issued.bearer))).status,401);
  assert.equal(x.ctx.calls.length,1);
 }finally{f.close();}
});

test('single-Auth composition is OFF by default and refuses wrong scope/origin before any HTTP member route',async()=>{
 const f=await makeFixture();try{
  const x=await createClosedLocalGoogleFlow(f);
  const off=createM1SingleAuthHttpComposition({...x.config,enabled:false});
  const before=f.db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal(await off.beginGoogleLogin(),null);
  assert.equal(await off.completeGoogleLogin({state:'ignored',code:'ignored'}),null);
  const denied=await off.handleMember(x.self('not-a-real-bearer'));
  assert.equal(denied.status,503);
  assert.deepEqual(await denied.json(),{error:{code:'FEATURE_DISABLED'}});
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,before);
  for(const serverScope of [
   {...scope,brand_id:'hglobal'}, {...scope,app_id:'echo-starry'},
   {...scope,environment:'production'},
  ])assert.throws(()=>createM1SingleAuthHttpComposition({
   ...x.config,serverScope,
  }));
  assert.throws(()=>createM1SingleAuthHttpComposition({
   ...x.config,redirectUri:'https://attacker.invalid/oauth',
  }),/ORIGIN_DENIED/);
  const slice=createM1SingleAuthHttpComposition(x.config);
  const fake=await slice.handleMember(new Request('https://wrong.invalid/v1/starry-id/members/me',{
   headers:{authorization:'Bearer v1.'+'a'.repeat(48)+'.'+'b'.repeat(43)},
  }));
  assert.equal(fake.status,404);
 }finally{f.close();}
});

test('real local SQLite Auth never issues a signed Session using a Google JWT expired during exchange',async()=>{
 const f=await makeFixture();
 try{
  const input=await f.prepare();
  const nonce=f.db.prepare(
   'SELECT nonce FROM starry_m1_oauth_attempts WHERE state=?'
  ).get(input.state).nonce;
  // The token is valid at callback entry, expires before Google's awaited
  // token exchange finishes, but remains inside the original 30-second
  // issuance guard. This specifically distinguishes the old stale-time bug.
  const shortToken=await f.signIdToken(nonce,'verified-sub',now+4);
  const core=createM1LocalAuthSessionCore({...f.deps,
   exchangeCode:async()=>{
    f.state.clock=now+7;
    return {idToken:shortToken};
   },
  });
  const issued=await core.issueFromVerifiedCallback(input);
  assert.equal(issued,null);
  assert.equal(f.state.clock,now+7);
  assert.equal(f.db.prepare(
   'SELECT count(*) AS n FROM starry_sessions'
  ).get().n,0,'expired JWT cannot commit a signed Session');
  assert.equal(f.db.prepare(
   'SELECT count(*) AS n FROM starry_m1_audit_intents'
  ).get().n,0,'no issuance audit without a real Session');
 }finally{f.close();}
});
