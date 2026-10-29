import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {bytesToBase64url} from '../src/oidc-crypto.ts';
import {createM1LocalAuthSessionCore,M1_AUTH_LIVE_ENABLED} from '../src/m1-local-auth-session-core.ts';
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
         if(sql.startsWith('INSERT INTO starry_sessions')&&state.beforeInsert){const hook=state.beforeInsert;state.beforeInsert=null;hook();}
         if(state.dbFault)throw Error('PRIVATE_SQL_TABLE_NAME');
         if(state.blockedWrite&&sql.startsWith('INSERT INTO starry_sessions'))
           return {success:true,meta:{changes:0}};
         const out=db.prepare(sql).run(...values);
         return {success:true,meta:{changes:out.changes}};
       },
     };
   },
   async batch(statements){
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
 async function signIdToken(nonce,subject=state.verifySub){
   const head=b64(utf(JSON.stringify({alg:'RS256',kid:'test-only-kid',typ:'JWT'})));
   const payload=b64(utf(JSON.stringify({iss:provider.issuer,aud:provider.clientId,
     sub:subject,nonce,iat:now,exp:now+300})));
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
