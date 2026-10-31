/**
 * Source-only integration: fresh Google Discovery/JWKS -> the EXISTING one
 * M1 Auth/OIDC callback -> PKCE + one-time SQLite CAS -> signed Starry Session
 * -> original AI-4 member bridge. No remote Google, Worker route or deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createM1SingleAuthHttpComposition} from '../../../apps/api/src/m1-single-auth-http-composition.ts';
import {createM1GoogleJwksSource,M1_GOOGLE_DISCOVERY_URL,M1_GOOGLE_JWKS_URL}
 from '../src/m1-google-jwks-source.ts';
import {createM1OAuthVerifierCustody} from '../src/m1-oauth-verifier-custody.ts';
import {bytesToBase64url} from '../src/oidc-crypto.ts';

const NOW=1793000000;
const origin='https://staging.starry.invalid';
const clientId='local-starry-jwks-wired-client';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const redirectUri=origin+'/v1/starry-id/oauth/google/callback';
const SELF='/v1/starry-id/members/me';
const CALLBACK='/v1/starry-id/oauth/google/callback';
const EXCHANGE='/v1/starry-id/sessions/exchange';
const APP_RETURN='https://app.starry.invalid/oauth/complete';
const enc=v=>bytesToBase64url(new TextEncoder().encode(JSON.stringify(v)));
function json(body,headers={}){
 return new Response(JSON.stringify(body),{status:200,headers:{
  'content-type':'application/json','cache-control':'public, max-age=60',...headers,
 }});
}
async function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 for(const file of [
  '001_starry_identity.DRAFT.sql','002_m1_local_oauth_attempts.DRAFT.sql',
  '003_m2_local_member_self_mutations.DRAFT.sql',
  '004_m2_local_deletion_request_receipt.DRAFT.sql',
  '005_m1_session_handoffs.DRAFT.sql',
 ]){
  db.exec(readFileSync(new URL('../schema/'+file,import.meta.url),'utf8'));
 }
 db.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('u1','active',3,1,'Local Test',0,0,NOW,NOW);
 db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
  .run('google','known-subject','u1');
 const adapter={
  prepare(sql){
   const args=[];
   return {
    bind(...v){args.splice(0,args.length,...v);return this;},
    async first(){return db.prepare(sql).get(...args)??null;},
    async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:r.changes}};},
   };
  },
  async batch(statements){
   db.exec('BEGIN IMMEDIATE');
   try{
    const result=[];
    for(const statement of statements)result.push(await statement.run());
    if(result.some(r=>r.success===false||r.meta?.changes!==1)){
     db.exec('ROLLBACK');return result;
    }
    db.exec('COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
 };
 const signing=await crypto.subtle.generateKey({
  name:'HMAC',hash:'SHA-256',length:256,
 },false,['sign','verify']);
 const aes=await crypto.subtle.generateKey({
  name:'AES-GCM',length:256,
 },false,['encrypt','decrypt']);
 const rsa=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
 },false,['sign','verify']);
 const publicKey=await crypto.subtle.exportKey('jwk',rsa.publicKey);
 const kid='locally-generated-rsa-only';
 const provider={provider:'google',clientId,issuer:'https://accounts.google.com',
  jwks:[], // Deliberately NO static test key. Only fetched JWKS can verify.
 };
 const minted={...publicKey,kid,alg:'RS256',use:'sig'};
 const custody=createM1OAuthVerifierCustody({
  activeKey:async()=>({kid:'local-aes',key:aes}),
  findKey:async k=>k==='local-aes'?aes:null,
 });
 let jwksNow=NOW,authNow=NOW,offline=false,jwksCalls=0,tokenCalls=0;
 let providerValue=provider;
 const pending=new Map();
 async function idToken(nonce,subject='known-subject'){
  const h=enc({alg:'RS256',kid,typ:'JWT'});
  const p=enc({iss:provider.issuer,aud:clientId,sub:subject,
   nonce,iat:NOW,exp:NOW+300});
  const payload=h+'.'+p;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
   rsa.privateKey,new TextEncoder().encode(payload));
  return payload+'.'+bytesToBase64url(new Uint8Array(sig));
 }
 const jwks=createM1GoogleJwksSource({
  enabled:true,clientId,issuer:provider.issuer,
  now:()=>jwksNow,
  transport:async(url,init)=>{
   if(offline)throw Error('SIMULATED_PRIVATE_GOOGLE_NETWORK_FAILURE');
   assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
   assert.equal(init.credentials,'omit');
   jwksCalls++;
   if(url===M1_GOOGLE_DISCOVERY_URL)
    return json({issuer:provider.issuer,jwks_uri:M1_GOOGLE_JWKS_URL});
   if(url===M1_GOOGLE_JWKS_URL)
    return json({keys:[minted]});
   throw Error('FOREIGN_GOOGLE_URL');
  },
 });
 const deps={
  enabled:true,serverScope:scope,expectedOrigin:origin,
  redirectUri,authDb:adapter,googleProvider:provider,
  googleJwksSource:jwks,allowedGoogleTestSubjects:['known-subject'],
  sessionHandoffEnabled:true,appReturnUri:APP_RETURN,
  verifierCustody:custody,
  activeKey:async()=>({kid:'local-hmac',key:signing}),
  getVerificationKey:async k=>k==='local-hmac'?signing:null,
  readGoogleClientSecret:async()=> 'local-secret-not-real',
  googleTransport:async(url,init)=>{
   assert.equal(url,'https://oauth2.googleapis.com/token');
   assert.equal(init.method,'POST');
   const code=new URLSearchParams(init.body).get('code');
   const value=pending.get(code);
   if(!value)return json({error:'missing-code'});
   pending.delete(code);tokenCalls++;
   return json({id_token:await idToken(value.nonce,value.subject),
    access_token:'should-never-escape'});
  },
  now:()=>authNow,
 };
 const flow=createM1SingleAuthHttpComposition(deps);
 let index=0;
 async function begin(subject='known-subject'){
  const url=new URL(await flow.beginGoogleLogin());
  const state=url.searchParams.get('state'),nonce=url.searchParams.get('nonce');
  const code='mock-code-'+(++index);
  assert.equal(url.origin,'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.ok(state&&nonce);
  pending.set(code,{nonce,subject});
  return {state,code};
 }
 return {db,flow,begin,deps,jwks,
  close:()=>db.close(),setNow:value=>{authNow=value;},
  expireJwksAndDisconnect:()=>{jwksNow=NOW+61;offline=true;},
  getCalls:()=>({jwksCalls,tokenCalls}),getProviderValue:()=>providerValue};
}
async function callbackFor(f,started){
 const url=origin+CALLBACK+'?'+new URLSearchParams({
  code:started.code,state:started.state,scope:'openid email',prompt:'select_account',
 }).toString();
 return f.flow.handleOAuthCallback(new Request(url,{method:'GET'}));
}
function exchangeRequest(code,headers={}){
 return new Request(origin+EXCHANGE,{method:'POST',headers:{
  'content-type':'application/json',...headers,
 },body:JSON.stringify({handoff_code:code})});
}
test('OAuth browser callback returns only a fragment-bound one-time code; native POST redeems one bearer once',async()=>{
 const f=await setup();try{
  assert.equal(f.flow.public_worker_route_registered,false);
  const started=await f.begin();
  const callback=await callbackFor(f,started);
  assert.equal(callback.status,303);
  assert.equal(callback.headers.get('cache-control'),'no-store');
  assert.equal(callback.headers.get('referrer-policy'),'no-referrer');
  const location=callback.headers.get('location');
  assert.ok(location?.startsWith(APP_RETURN+'#handoff='));
  assert.doesNotMatch(location,/v1\\./,'signed bearer must never appear in redirect');
  const code=new URL(location).hash.slice('#handoff='.length);
  assert.match(code,/^[A-Za-z0-9_-]{43}$/);
  const stored=f.db.prepare('SELECT handoff_hash,session_id,provider,provider_subject,app_id,environment,created_at,expires_at,consumed_at FROM starry_m1_session_handoffs').get();
  assert.match(stored.handoff_hash,/^[a-f0-9]{64}$/);
  assert.notEqual(stored.handoff_hash,code);
  assert.equal(stored.provider_subject,'known-subject');
  assert.equal(stored.environment,'staging');
  assert.equal(stored.consumed_at,null);
  const response=await f.flow.handleSessionExchange(exchangeRequest(code));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const payload=await response.json();
  assert.deepEqual(Object.keys(payload).sort(),['access_token','expires_at','token_type']);
  assert.equal(payload.token_type,'Bearer');
  assert.match(payload.access_token,/^v1\\./);
  assert.equal(payload.expires_at,NOW+300);
  const member=await f.flow.handleMember(new Request(origin+SELF,{
   headers:{authorization:'Bearer '+payload.access_token},
  }));
  assert.equal(member.status,200);
  assert.equal((await member.json()).s_user_id,'u1');
  const replay=await f.flow.handleSessionExchange(exchangeRequest(code));
  assert.equal(replay.status,401);
  assert.deepEqual(await replay.json(),{error:{code:'HANDOFF_INVALID'}});
  assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_session_handoffs').get().consumed_at,NOW);
 }finally{f.close();}
});

test('session handoff denies wrong app Origin, cookies, ambient bearer, content type, extra body keys and malformed callback query',async()=>{
 const f=await setup();try{
  const started=await f.begin();
  const badCallback=await f.flow.handleOAuthCallback(new Request(
   origin+CALLBACK+'?code='+encodeURIComponent(started.code)+'&state='+started.state+'&redirect_uri=https%3A%2F%2Fevil.invalid',
   {method:'GET'},
  ));
  assert.equal(badCallback.status,400);
  assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_oauth_attempts WHERE state=?').get(started.state).consumed_at,null);
  const callback=await callbackFor(f,started);
  const code=new URL(callback.headers.get('location')).hash.slice('#handoff='.length);
  for(const headers of [
   {origin:'https://evil.invalid'},
   {cookie:'sid=ambient'},
   {authorization:'Bearer v1.fake'},
   {'content-type':'text/plain'},
  ]){
   const response=await f.flow.handleSessionExchange(exchangeRequest(code,headers));
   assert.notEqual(response.status,200);
   assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const extra=await f.flow.handleSessionExchange(new Request(origin+EXCHANGE,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({handoff_code:code,member_id:'u1'}),
  }));
  assert.equal(extra.status,400);
  const duplicate=await f.flow.handleOAuthCallback(new Request(
   origin+CALLBACK+'?code=x&state='+'S'.repeat(43)+'&state='+'T'.repeat(43),
  ));
  assert.equal(duplicate.status,400);
  const method=await f.flow.handleOAuthCallback(new Request(origin+CALLBACK,{method:'POST'}));
  assert.equal(method.status,405);
  const noPublic=await f.flow.handleSessionExchange(new Request(origin+EXCHANGE,{method:'OPTIONS'}));
  assert.equal(noPublic.status,405);
  assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_session_handoffs').get().consumed_at,null);
 }finally{f.close();}
});

test('expired or revoked staging Session cannot redeem a handoff; concurrent replay has exactly one winner',async()=>{
 {
  const f=await setup();try{
   const started=await f.begin();
   const callback=await callbackFor(f,started);
   const code=new URL(callback.headers.get('location')).hash.slice('#handoff='.length);
   f.setNow(NOW+61);
   const expired=await f.flow.handleSessionExchange(exchangeRequest(code));
   assert.equal(expired.status,401);
   assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_session_handoffs').get().consumed_at,null);
  }finally{f.close();}
 }
 {
  const f=await setup();try{
   const started=await f.begin();
   const callback=await callbackFor(f,started);
   const code=new URL(callback.headers.get('location')).hash.slice('#handoff='.length);
   f.db.prepare('UPDATE starry_sessions SET revoked_at=?').run(NOW+1);
   const revoked=await f.flow.handleSessionExchange(exchangeRequest(code));
   assert.equal(revoked.status,401);
   assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_session_handoffs').get().consumed_at,null);
  }finally{f.close();}
 }
 {
  const f=await setup();try{
   const started=await f.begin();
   const callback=await callbackFor(f,started);
   const code=new URL(callback.headers.get('location')).hash.slice('#handoff='.length);
   const responses=await Promise.all([
    f.flow.handleSessionExchange(exchangeRequest(code)),
    f.flow.handleSessionExchange(exchangeRequest(code)),
   ]);
   assert.deepEqual(responses.map(x=>x.status).sort(),[200,401]);
   assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_session_handoffs').get().consumed_at,NOW);
  }finally{f.close();}
 }
});

test('JWKS-enabled staging requires a server-owned explicit Google subject invite list at construction',async()=>{
 const f=await setup();try{
  for(const value of [undefined,[],null,[''],['known-subject','known-subject'],['bad\nsubject']]){
   assert.throws(()=>createM1SingleAuthHttpComposition({
    ...f.deps,allowedGoogleTestSubjects:value,
   }),/M1_AUTH_TEST_ALLOWLIST_DENIED/);
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_oauth_attempts').get().n,0);
  assert.deepEqual(f.getCalls(),{jwksCalls:0,tokenCalls:0});
 }finally{f.close();}
});

test('valid signed but uninvited Google sub cannot read membership, register, issue Session or audit',async()=>{
 const f=await setup();try{
  const uninvited=await f.begin('outside-pilot-subject');
  f.deps.allowedGoogleTestSubjects.push('outside-pilot-subject');
  const denied=await f.flow.completeGoogleLogin(uninvited);
  assert.equal(denied,null,'mutating caller-owned allowlist after construction grants no login');
  const row=f.db.prepare('SELECT consumed_at FROM starry_m1_oauth_attempts WHERE state=?')
   .get(uninvited.state);
  assert.equal(row.consumed_at,NOW,'one-time state consumed even for uninvited signed Google subject');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_members').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_identities').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').get().n,0);
  assert.deepEqual(f.getCalls(),{jwksCalls:2,tokenCalls:1});
  assert.equal(await f.flow.completeGoogleLogin(uninvited),null,'uninvited code replay denied');
  const invited=await f.begin('known-subject');
  assert.equal((await f.flow.completeGoogleLogin(invited))?.s_user_id,'u1');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_members').get().n,1);
 }finally{f.close();}
});

test('real WebCrypto Google JWK (from trusted Discovery) wires into ORIGINAL single Auth, SQLite Session and member bridge',async()=>{
 const f=await setup();try{
  assert.equal(f.flow.local_only,true);
  assert.equal(f.flow.public_worker_route_registered,false);
  assert.equal(f.flow.live_enabled,false);
  assert.equal((await f.flow.completeGoogleLogin({code:'invalid',state:'bad'})),null);
  assert.equal(await f.flow.completeGoogleLogin({
   code:'forged-valid-shape',state:'R'.repeat(43),
  }),null,'valid-looking random state has no persisted OAuth authority');
  assert.equal(f.getCalls().jwksCalls,0,
   'invalid/missing state cannot cause Google JWKS network read');
  const first=await f.begin();
  assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_oauth_attempts WHERE state=?').get(first.state).consumed_at,null);
  const issued=await f.flow.completeGoogleLogin(first);
  assert.equal(issued?.status,'issued');
  assert.equal(issued?.s_user_id,'u1');
  assert.match(issued.bearer,/^v1\./);
  assert.deepEqual(f.getCalls(),{jwksCalls:2,tokenCalls:1});
  const read=await f.flow.handleMember(new Request(origin+SELF,{
   headers:{authorization:'Bearer '+issued.bearer},
  }));
  assert.equal(read.status,200);
  assert.deepEqual(await read.json(),{
   s_user_id:'u1',display_name:'Local Test',
   directory_opt_in:false,display_name_public:false,profile_revision:1,
  });
  assert.equal((await f.flow.completeGoogleLogin(first)),null);
  assert.equal(f.getCalls().jwksCalls,2,'replayed consumed OAuth state avoids JWKS calls');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_m1_audit_intents').get().n,1);
  const second=await f.begin();
  const again=await f.flow.completeGoogleLogin(second);
  assert.equal(again?.status,'issued');
  assert.equal(f.getCalls().jwksCalls,2,'fresh JWKS reused while original TTL valid');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,2);
 }finally{f.close();}
});

test('expired Google JWKS + transport failure rejects before OAuth state CAS/exchange and cannot mint Session',async()=>{
 const f=await setup();try{
  const first=await f.begin();
  assert.equal((await f.flow.completeGoogleLogin(first))?.status,'issued');
  f.expireJwksAndDisconnect();
  const attempt=await f.begin();
  const callsBefore=f.getCalls();
  assert.equal(await f.flow.completeGoogleLogin({
   code:'forged',state:'Q'.repeat(43),
  }),null,'expired cache still must not fetch for absent OAuth state');
  assert.deepEqual(f.getCalls(),callsBefore,
   'random state cannot trigger JWKS refresh after cache expiry');
  assert.equal(await f.flow.completeGoogleLogin(attempt),null);
  assert.deepEqual(f.getCalls(),callsBefore,
   'transport failure cannot reach Google token endpoint');
  assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_oauth_attempts WHERE state=?')
   .get(attempt.state).consumed_at,null,'OAuth attempt not prematurely consumed');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,1);
 }finally{f.close();}
});

test('invalid or corrupted OAuth state and control-character code cannot cause Google JWKS traffic or CAS',async()=>{
 const f=await setup();try{
  const login=await f.begin();
  const before=f.getCalls();
  assert.equal(await f.flow.completeGoogleLogin({
   state:login.state,code:'invalid\u0000google-code',
  }),null,'control-character code is denied before key source');
  assert.deepEqual(f.getCalls(),before);
  assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_oauth_attempts WHERE state=?')
   .get(login.state).consumed_at,null);
  const rogue=f.db.prepare('UPDATE starry_m1_oauth_attempts SET code_verifier=? WHERE state=?')
   .run('untrusted-plaintext-instead-of-sealed-verifier',login.state);
  assert.equal(rogue.changes,1);
  assert.equal(await f.flow.completeGoogleLogin(login),null,
   'invalid AES-GCM PKCE custody cannot unlock Google JWKS source');
  assert.deepEqual(f.getCalls(),before,'invalid PKCE must not do JWKS requests');
  assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_oauth_attempts WHERE state=?')
   .get(login.state).consumed_at,null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
 }finally{f.close();}
});

test('mismatched JWKS issuer/audience and a disabled composition never fall back to static authority',async()=>{
 const f=await setup();try{
  assert.throws(()=>createM1SingleAuthHttpComposition({...f.deps,googleJwksSource:null}),
   /M1_M2_GOOGLE_FLOW_CONFIGURATION_DENIED/);
  const mismatched=createM1SingleAuthHttpComposition({
   ...f.deps,
   googleJwksSource:{getProvider:async()=>({
    ...f.deps.googleProvider,clientId:'attacker-client',jwks:[{}],
   })},
  });
  const login=await f.begin();
  assert.equal(await mismatched.completeGoogleLogin(login),null);
  assert.equal(f.db.prepare('SELECT consumed_at FROM starry_m1_oauth_attempts WHERE state=?')
   .get(login.state).consumed_at,null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM starry_sessions').get().n,0);
  const disabled=createM1SingleAuthHttpComposition({...f.deps,enabled:false});
  assert.equal(await disabled.beginGoogleLogin(),null);
  assert.equal(await disabled.completeGoogleLogin(login),null);
  assert.deepEqual(f.getCalls(),{jwksCalls:0,tokenCalls:0});
 }finally{f.close();}
});
