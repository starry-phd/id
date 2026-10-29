import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {signServerSession} from '../src/session-crypto.ts';
import {isTrustedPrincipal,readSelf} from '../src/index.ts';
import {createOfflineStarryRequestAuthBoundary,R23_HTTP_AUTH_CONTRACT,
 R23_HTTP_AUTH_LIVE_ENABLED,R23_HTTP_AUTH_PRODUCTION_APPROVED}
 from '../src/r23-signed-session-d1-request-boundary.ts';

const now=1793000000;
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const origin='https://id.starry.example';
async function setup(overrides={}){
 const rawDb=new DatabaseSync(':memory:');
 rawDb.exec('PRAGMA foreign_keys=ON');
 rawDb.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 rawDb.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'Only in DB',0,0,?,?)").run(now,now);
 rawDb.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)').run('apple','apple-sub','u1');
 rawDb.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('sess1','u1','starry-id','staging',3,'a'.repeat(64),now+300,null,null,null);
 const state={reads:0,queries:[],failDb:false,failKey:false};
 const db={prepare(sql){
  assert.match(sql,/^SELECT /); // test asserts no write in request adapter
  state.queries.push(sql);state.reads++;
  return {bind(...args){return {first:async()=>{
   if(state.failDb)throw Error('D1 OFFLINE');
   return rawDb.prepare(sql).get(...args)??null;
  }};}};}};
 const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
  false,['sign','verify']);
 const claims={brand_id:'starry',app_id:'starry-id',environment:'staging',
  provider:'apple',provider_subject:'apple-sub',s_user_id:'u1',session_id:'sess1',
  auth_version:3,expires_at:now+300,issued_at:now,key_id:'kid-r23'};
 const signed=await signServerSession(claims,scope,now,{kid:'kid-r23',key});
 const config={serverScope:scope,expectedOrigin:origin,authDb:db,
  getVerificationKey:async kid=>{
   if(state.failKey)throw Error('KEY RING UNAVAILABLE');
   return kid==='kid-r23'?key:null;
  }};
 const guard=createOfflineStarryRequestAuthBoundary({enabled:true,...config});
 const req=(token=signed,change={})=>new Request(change.origin??origin+'/private',
  {method:change.method??'GET',headers:{
   authorization:change.authorization??('Bearer '+token),
   ...change.headers}});
 return {guard,req,config,rawDb,state,signed,key,claims,
  close(){rawDb.close();}};
}
test('R23 boundary default OFF, prod/foreign config prohibited before DB read',async()=>{
 const x=await setup();try{
  assert.equal(R23_HTTP_AUTH_LIVE_ENABLED,false);
  assert.equal(R23_HTTP_AUTH_PRODUCTION_APPROVED,false);
  assert.equal(R23_HTTP_AUTH_CONTRACT,'starry.auth.request-boundary.r23-offline');
  const off=createOfflineStarryRequestAuthBoundary(x.config);
  assert.equal(await off.authenticate(x.req(),now),null);
  assert.equal(x.state.reads,0);
  assert.throws(()=>createOfflineStarryRequestAuthBoundary({...x.config,
   serverScope:{...scope,environment:'production'}}),/SCOPE_OR_PORT_DENIED/);
  assert.throws(()=>createOfflineStarryRequestAuthBoundary({...x.config,
   serverScope:{...scope,brand_id:'hglobal'}}),/SCOPE_OR_PORT_DENIED/);
  assert.throws(()=>createOfflineStarryRequestAuthBoundary({...x.config,
   expectedOrigin:'http://id.starry.example'}),/ORIGIN_DENIED/);
 }finally{x.close();}
});
test('real HMAC signature + actual SQLite Member, Session and stable subject issue sealed server principal',async()=>{
 const x=await setup();try{
  const p=await x.guard.authenticate(x.req(),now);
  assert.equal(isTrustedPrincipal(p),true);
  assert.equal(p.s_user_id,'u1');
  assert.equal(p.app_id,'starry-id');
  assert.equal(x.state.reads,3);
  assert.ok(x.state.queries.every(sql=>sql.startsWith('SELECT ')));
  assert.throws(()=>readSelf({...p},scope,{
   s_user_id:'u1',status:'active',auth_version:3,profile_revision:1,
   display_name:'Only in DB',directory_opt_in:false,display_name_public:false
  },now),/IDENTITY_DENIED/);
  assert.equal(readSelf(p,scope,{s_user_id:'u1',status:'active',auth_version:3,
   profile_revision:1,display_name:'Only in DB',
   directory_opt_in:false,display_name_public:false},now).s_user_id,'u1');
 }finally{x.close();}
});
test('revoked Session or expired signer time rejects on subsequent real D1 query',async()=>{
 const x=await setup();try{
  assert.ok(await x.guard.authenticate(x.req(),now));
  x.rawDb.prepare("UPDATE starry_sessions SET revoked_at=? WHERE session_id='sess1'").run(now);
  assert.equal(await x.guard.authenticate(x.req(),now),null);
  assert.equal(await x.guard.authenticate(x.req(),now+301),null);
 }finally{x.close();}
});
test('suspended/deleted Member or auth_version bump immediately denies signed bearer',async()=>{
 for(const sql of [
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'"
 ]){
  const x=await setup();try{
   x.rawDb.exec(sql);
   assert.equal(await x.guard.authenticate(x.req(),now),null);
  }finally{x.close();}
 }
});
test('wrong provider link, member owner, App or environment cannot mint principal',async()=>{
 for(const sql of [
  "DELETE FROM starry_identities WHERE s_user_id='u1'",
  "UPDATE starry_sessions SET app_id='other-app' WHERE session_id='sess1'",
  "UPDATE starry_sessions SET environment='development' WHERE session_id='sess1'"
 ]){
  const x=await setup();try{x.rawDb.exec(sql);
   assert.equal(await x.guard.authenticate(x.req(),now),null);
  }finally{x.close();}
 }
});
test('forged/mutated token, signing key outage and unsigned body all fail closed',async()=>{
 const x=await setup();try{
  const t=x.signed;
  const swapped=t.slice(0,-2)+(t.endsWith('aa')?'bb':'aa');
  assert.equal(await x.guard.authenticate(x.req(swapped),now),null);
  assert.equal(await x.guard.authenticate(x.req('not-a-token'),now),null);
  x.state.failKey=true;
  assert.equal(await x.guard.authenticate(x.req(),now),null);
  x.state.failKey=false;
  assert.equal(await x.guard.authenticate({authorization:'Bearer '+t},now),null);
  assert.equal(await x.guard.authenticate(x.req(),Number.NaN),null);
 }finally{x.close();}
});
test('legacy cookie, cross-site host, duplicate bearer/header smuggling, URL query, HTTP method rejected before D1',async()=>{
 const x=await setup();try{
  const bad=[
   x.req(x.signed,{headers:{cookie:'__Host-starry_session=old'}}),
   x.req(x.signed,{headers:{'proxy-authorization':'Bearer old'}}),
   x.req(x.signed,{origin:'https://foreign.example/private'}),
   x.req(x.signed,{origin:origin+'/private?access_token=old'}),
   x.req(x.signed,{authorization:'Bearer '+x.signed+', Bearer '+x.signed}),
   x.req(x.signed,{authorization:'basic '+x.signed}),
   x.req(x.signed,{method:'PUT'})
  ];
  for(const request of bad)assert.equal(await x.guard.authenticate(request,now),null);
  assert.equal(x.state.reads,0);
 }finally{x.close();}
});
test('actual D1 reader failure, wrong signature App scope and missing Authorization fail closed',async()=>{
 const x=await setup();try{
  x.state.failDb=true;
  assert.equal(await x.guard.authenticate(x.req(),now),null);
  x.state.failDb=false;
  const foreign=createOfflineStarryRequestAuthBoundary({...x.config,
   serverScope:{...scope,app_id:'other'} ,enabled:true});
  assert.equal(await foreign.authenticate(x.req(),now),null);
  const empty=new Request(origin+'/private');
  assert.equal(await x.guard.authenticate(empty,now),null);
 }finally{x.close();}
});
