/**
 * AI-4 cross-owner COMPOSITE-ONLY integration gate.
 * Real local Node SQLite + WebCrypto: AI-1 #279 issues the Session and AI-4
 * #281 routes GET/PATCH/logout through the SAME current DB. In workerd only
 * the transport is an isolate; the test-only service binding delegates to the
 * original AI-1 authoritative Node SQLite port. NO remote Google/Cloudflare.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {createServer} from 'node:http';
import {Buffer} from 'node:buffer';
import {TextEncoder} from 'node:util';
import {URL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {bytesToBase64url} from '../../../modules/starry-id-v1/src/oidc-crypto.ts';
import {createM1OAuthVerifierCustody} from
 '../../../modules/starry-id-v1/src/m1-oauth-verifier-custody.ts';
import {createM1M2LocalGoogleFlow} from
 '../../../modules/starry-id-v1/src/m1-m2-local-google-member-flow.ts';
import {createM1LocalSelfHttp} from '../src/m1-local-self-http.ts';
import {createM1LocalMemberPlatformBridge} from '../src/m1-local-member-platform-bridge.ts';

const epoch=1793000000;
const origin='https://m1-integration.starry.invalid';
const scope=Object.freeze({brand_id:'starry',app_id:'starry-id',environment:'staging'});
const selfPath='/v1/starry-id/members/me';
const logoutPath='/v1/starry-id/sessions/logout';
const utf=s=>new TextEncoder().encode(s);
const b64=s=>bytesToBase64url(s);

async function fixture(){
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');
  for(const schema of [
   '001_starry_identity.DRAFT.sql',
   '002_m1_local_oauth_attempts.DRAFT.sql',
   '003_m2_local_member_self_mutations.DRAFT.sql',
  ])db.exec(readFileSync(new URL('../../../modules/starry-id-v1/schema/'+schema,import.meta.url),'utf8'));
  db.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
    .run('u1','active',3,1,'Local Fixture',0,0,epoch,epoch);
  db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
    .run('google','real-local-subject','u1');
  const signing=await webcrypto.subtle.generateKey(
   {name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
  const providerPair=await webcrypto.subtle.generateKey(
   {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
  const publicJwk=await webcrypto.subtle.exportKey('jwk',providerPair.publicKey);
  const provider={provider:'google',clientId:'starry-local-integration-only',
   issuer:'https://accounts.google.com',
   jwks:[{...publicJwk,kid:'local-provider-key',alg:'RS256',use:'sig'}]};
  let now=epoch;
  const adapter={
   prepare(sql){let args=[];return {
    bind(...values){args=values;return this;},
    async first(){return db.prepare(sql).get(...args)??null;},
    async run(){
     const result=db.prepare(sql).run(...args);
     return {success:true,meta:{changes:result.changes}};
    },
   };},
   async batch(statements){
    db.exec('BEGIN IMMEDIATE');
    try{
     const results=[];
     for(const statement of statements){
      const result=await statement.run();
      results.push(result);
      if(result.success===false||result.meta?.changes!==1){
       db.exec('ROLLBACK');return results;
      }
     }
     db.exec('COMMIT');return results;
    }catch(e){db.exec('ROLLBACK');throw e;}
   },
  };
  const aes=await webcrypto.subtle.generateKey(
   {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const custody=createM1OAuthVerifierCustody({
   activeKey:async()=>({kid:'local-aes',key:aes}),
   findKey:async kid=>kid==='local-aes'?aes:null,
  });
  let nonce='';
  let tokenCalls=0;
  const signIdToken=async()=>{
   const header=b64(utf(JSON.stringify({
    alg:'RS256',kid:'local-provider-key',typ:'JWT',
   })));
   const payload=b64(utf(JSON.stringify({
    iss:provider.issuer,aud:provider.clientId,
    sub:'real-local-subject',nonce,iat:epoch,exp:epoch+300,
   })));
   const signed=header+'.'+payload;
   const signature=await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',providerPair.privateKey,utf(signed));
   return signed+'.'+b64(new Uint8Array(signature));
  };
  const flow=createM1M2LocalGoogleFlow({
   enabled:true,serverScope:scope,expectedOrigin:origin,
   redirectUri:origin+'/v1/starry-id/oauth/google/callback',
   authDb:adapter,googleProvider:provider,verifierCustody:custody,
   activeKey:async()=>({kid:'session-local',key:signing}),
   getVerificationKey:async kid=>kid==='session-local'?signing:null,
   readGoogleClientSecret:async()=> 'integration-only-confidential-secret',
   googleTransport:async()=>{
    tokenCalls++;
    return new Response(JSON.stringify({
     id_token:await signIdToken(),access_token:'MUST_NOT_LEAK',
    }),{status:200,headers:{'content-type':'application/json'}});
   },
   now:()=>now,
  });
  const readPort=createM1LocalSelfHttp({
   enabled:true,scope,expectedOrigin:origin,
   core:{readSelf:request=>flow.readSelf(request)},
  });
  // THIS is the same AI-1-owned mutation handler and SQLite adapter.
  const mutationPort={handle:request=>flow.mutateSelf(request)};
  const bridge=createM1LocalMemberPlatformBridge({
   enabled:true,scope,expectedOrigin:origin,readPort,mutationPort,
  });
  async function issue(){
   const authorize=await flow.beginGoogleLogin();
   assert.equal(typeof authorize,'string');
   const url=new URL(authorize);
   nonce=url.searchParams.get('nonce');
   const state=url.searchParams.get('state');
   const issued=await flow.completeGoogleLogin({state,code:'local-google-test-code'});
   assert.equal(issued?.status,'issued');
   assert.equal(issued?.s_user_id,'u1');
   assert.equal(tokenCalls,1);
   assert.equal(db.prepare('SELECT count(*) n FROM starry_sessions').get().n,1);
   return {bearer:issued.bearer,state};
  }
  const request=(path,bearer,method='GET',headers={},body)=>
   new Request(origin+path,{method,headers:{
    authorization:'Bearer '+bearer,...headers,
   },body});
  return {
   db,flow,bridge,issue,close:()=>db.close(),request,
   resetNow:seconds=>{now=seconds;},
   get tokenCalls(){return tokenCalls;},
   readPort,mutationPort,
  };
 }catch(e){db.close();throw e;}
}
function patch(x,bearer,rev,name){
 return x.request(selfPath,bearer,'PATCH',{
  'content-type':'application/json','if-match':'"rev-'+rev+'"',
 },JSON.stringify({display_name:name}));
}
const self=(x,b)=>x.request(selfPath,b);
const logout=(x,b)=>x.request(logoutPath,b,'POST');

test('AI1 signed Google→SQLite Session is accepted by AI4 bridge GET/CAS/logout then revoked GET is 401',async()=>{
 const x=await fixture();
 try{
  const {bearer,state}=await x.issue();
  const read=await x.bridge.handle(self(x,bearer));
  assert.equal(read.status,200);
  assert.deepEqual(await read.json(),{
   s_user_id:'u1',display_name:'Local Fixture',
   directory_opt_in:false,display_name_public:false,profile_revision:1,
  });
  const updated=await x.bridge.handle(patch(x,bearer,1,'Bridge Owner CAS'));
  assert.equal(updated.status,200);
  assert.equal((await updated.json()).profile_revision,2);
  assert.equal(x.db.prepare("SELECT profile_revision FROM starry_members WHERE s_user_id='u1'").get().profile_revision,2);
  assert.equal((await x.bridge.handle(patch(x,bearer,1,'stale'))).status,409);
  const revoke=await x.bridge.handle(logout(x,bearer));
  assert.equal(revoke.status,204);
  assert.equal(revoke.body,null);
  assert.equal((await x.bridge.handle(self(x,bearer))).status,401);
  assert.equal((await x.bridge.handle(patch(x,bearer,2,'after-revoke'))).status,401);
  assert.equal((await x.bridge.handle(logout(x,bearer))).status,401);
  assert.equal(await x.flow.completeGoogleLogin({state,code:'local-google-test-code'}),null);
  assert.equal(x.tokenCalls,1);
  const audits=JSON.stringify(x.db.prepare('SELECT * FROM starry_m2_member_mutation_audit').all());
  assert.doesNotMatch(audits,/Bridge Owner CAS|MUST_NOT_LEAK/);
  assert.equal(x.db.prepare("SELECT count(*) n FROM starry_m2_member_mutation_audit WHERE event_type='session_revoked'").get().n,1);
 }finally{x.close();}
});

test('AI4 bridge refuses current-session provider unlink and auth_version changes using AI1 real SQLite',async()=>{
 for(const sql of [
  "DELETE FROM starry_identities WHERE provider='google' AND s_user_id='u1'",
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
 ]){
  const x=await fixture();
  try{
   const {bearer}=await x.issue();
   x.db.exec(sql);
   assert.equal((await x.bridge.handle(self(x,bearer))).status,401);
   assert.notEqual((await x.bridge.handle(patch(x,bearer,1,'forbidden'))).status,200);
   assert.notEqual((await x.bridge.handle(logout(x,bearer))).status,204);
   assert.equal(x.db.prepare("SELECT profile_revision FROM starry_members WHERE s_user_id='u1'").get().profile_revision,1);
  }finally{x.close();}
 }
});

async function withRealWorkerd(x,callback){
 // Local loopback relay to the ORIGINAL AI-1 Node SQLite handler. Binding is
 // test-only and listens on 127.0.0.1 ephemeral port, never internet-facing.
 let relayHits=0,relayFaults=0;
 const server=createServer(async (incoming,outgoing)=>{
  relayHits++;
  try{
   const chunks=[];
   for await(const part of incoming)chunks.push(part);
   const bytes=Buffer.concat(chunks);
   if(bytes.length>4096){outgoing.writeHead(413);outgoing.end();return;}
   const path=new URL(incoming.url??'/',origin);
   const headers=new globalThis.Headers(incoming.headers);
   headers.delete('host');
   const method=incoming.method??'GET';
   const request=new Request(origin+path.pathname+path.search,{
    method,headers,body:method==='PATCH'&&bytes.length?bytes:undefined,
   });
   const response=method==='GET'?
    await x.readPort.handle(request):await x.mutationPort.handle(request);
   const h=Object.fromEntries(response.headers);
   outgoing.writeHead(response.status,h);
   outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch{
   relayFaults++;
   outgoing.writeHead(503,{'cache-control':'no-store'});
   outgoing.end();
  }
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 const address=server.address();
 const port=typeof address==='object'&&address?address.port:0;
 const entry=[
  "import {createM1LocalMemberPlatformBridge} from './m1-local-member-platform-bridge.ts';",
  "const relay=async r=>{",
  "const url=new URL(r.url);const h=new Headers(r.headers);h.delete('host');",
  "const body=r.method==='PATCH'?await r.text():undefined;",
  "return fetch('http://127.0.0.1:"+port+"'+url.pathname+url.search,",
  "{method:r.method,headers:h,body,redirect:'error',cache:'no-store'});",
  "};",
  "export default {async fetch(req){",
  "const local=new Request(req.url,req);local.headers.delete('host');",
  "const handler=createM1LocalMemberPlatformBridge({",
  "enabled:true,scope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},",
  "expectedOrigin:"+JSON.stringify(origin)+",",
  "readPort:{handle:relay},mutationPort:{handle:relay}",
  "});return handler.handle(local);}};",
 ].join('\n');
 let mf;
 try{
  const bundle=await build({stdin:{
   contents:entry,resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),
   sourcefile:'m1-real-session-workerd-entry.ts',loader:'ts',
  },bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
  mf=new Miniflare({workers:[{config:{
   name:'m1-composite-real-auth-workerd',compatibilityDate:'2026-10-01',
   manifest:{mainModule:'index.js',modules:{
    'index.js':{type:'esm',contents:bundle.outputFiles[0].text},
   }},env:{},
  }}]});
  await callback(mf,()=>({relayHits,relayFaults}));
 }finally{
  if(mf)await mf.dispose();
  await new Promise(resolve=>server.close(resolve));
 }
}

test('real workerd route → one shared AI1 SQLite Session/Member → CAS → logout → GET denied',async()=>{
 const x=await fixture();
 try{
  const {bearer}=await x.issue();
  await withRealWorkerd(x,async (mf,stats)=>{
   const authorization='Bearer '+bearer;
   const get=()=>mf.dispatchFetch(origin+selfPath,{headers:{authorization}});
   const update=(rev,name)=>mf.dispatchFetch(origin+selfPath,{
    method:'PATCH',headers:{
     authorization,'content-type':'application/json','if-match':'"rev-'+rev+'"',
    },body:JSON.stringify({display_name:name}),
   });
   const drop=()=>mf.dispatchFetch(origin+logoutPath,{method:'POST',headers:{authorization}});
   const first=await get();
   assert.equal(first.status,200,JSON.stringify({...stats(),response:await first.clone().text()}));
   assert.equal((await first.json()).profile_revision,1);
   const changed=await update(1,'Workerd SQLite CAS');
   assert.equal(changed.status,200);
   assert.equal((await changed.json()).profile_revision,2);
   assert.equal((await update(1,'stale')).status,409);
   assert.equal((await drop()).status,204);
   const denied=await get();
   assert.equal(denied.status,401);
   assert.deepEqual(await denied.json(),{error:{code:'IDENTITY_DENIED'}});
   assert.equal((await update(2,'after revoke')).status,401);
   assert.equal((await drop()).status,401);
   assert.equal(x.db.prepare("SELECT profile_revision FROM starry_members WHERE s_user_id='u1'").get().profile_revision,2);
   assert.equal(x.db.prepare("SELECT count(*) n FROM starry_m2_member_mutation_audit WHERE event_type='session_revoked'").get().n,1);
  });
 }finally{x.close();}
});
