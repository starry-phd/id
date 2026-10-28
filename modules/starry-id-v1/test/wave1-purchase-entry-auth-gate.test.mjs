import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {signServerSession} from '../src/session-crypto.ts';
import {createOfflineStarryPurchaseEntryGate,WAVE1_PURCHASE_AUTH_SCHEMA,
 WAVE1_PURCHASE_AUTH_LIVE_ENABLED}
 from '../src/wave1-purchase-entry-auth-gate.ts';

const now=1793000000;
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const origin='https://id.starry.example';
const flow_ref='w1_'+ 'A'.repeat(48);
const intent=()=>({...scope,flow_ref});
function assertBlockedStore(v,status){
 assert.equal(v.schema_version,WAVE1_PURCHASE_AUTH_SCHEMA);
 assert.equal(v.status,status);
 for(const key of ['verified_live','may_open_store','may_purchase',
  'may_grant_entitlement','may_transfer_store_transaction','may_restore','may_charge'])
  assert.equal(v[key],false,key);
 assert.equal(v.ui_only,true);
 const serialized=JSON.stringify(v);
 for(const sensitive of ['u1','u2','sess1','sess2','apple-sub','refresh_hash',
  'starryUserId','_authToken','OAuth subject','Bearer'])
  assert.equal(serialized.includes(sensitive),false,sensitive);
}
async function setup(){
 const rawDb=new DatabaseSync(':memory:');
 rawDb.exec('PRAGMA foreign_keys=ON');
 rawDb.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 for(const [id,sub] of [['u1','apple-sub'],['u2','second-sub']]){
  rawDb.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(id,'active',3,1,'fake-'+id,0,0,now,now);
  rawDb.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)').run('apple',sub,id);
 }
 for(const [id,uid,h] of [['sess1','u1','a'],['sess2','u2','b']])
  rawDb.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(id,uid,'starry-id','staging',3,h.repeat(64),now+300,null,null,null);
 const s={reads:0,queries:[],dbOut:false,keyOut:false};
 const db={prepare(sql){
  assert.match(sql,/^SELECT /);
  s.reads++;s.queries.push(sql);
  return {bind(...args){return {first:async()=>{
   if(s.dbOut)throw Error('Auth database unavailable');
   return rawDb.prepare(sql).get(...args)??null;
  }};}};
 }};
 const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
  false,['sign','verify']);
 const makeToken=(id='u1')=>{
  const second=id==='u2';
  return signServerSession({brand_id:'starry',app_id:'starry-id',environment:'staging',
   provider:'apple',provider_subject:second?'second-sub':'apple-sub',
   s_user_id:id,session_id:second?'sess2':'sess1',auth_version:3,
   expires_at:now+300,issued_at:now,key_id:'wave1-key'},scope,now,
   {kid:'wave1-key',key});
 };
 const tokens={u1:await makeToken('u1'),u2:await makeToken('u2')};
 const request=(id='u1',extra={})=>new Request(extra.url??origin+'/purchase-identity',
  {method:extra.method??'POST',headers:{
   authorization:'Bearer '+tokens[id],...extra.headers
  }});
 const config={serverScope:scope,expectedOrigin:origin,authDb:db,
  getVerificationKey:async kid=>{
   if(s.keyOut)throw Error('key outage');
   return kid==='wave1-key'?key:null;
  }};
 const gate=createOfflineStarryPurchaseEntryGate({...config,enabled:true});
 return {rawDb,db,key,s,gate,config,request,tokens,makeToken,
  close(){rawDb.close();}};
}
test('Wave1 Q2 guest free browse NO Auth SQL; default OFF blocks all purchase attempts',async()=>{
 const x=await setup();try{
  assert.equal(WAVE1_PURCHASE_AUTH_LIVE_ENABLED,false);
  const off=createOfflineStarryPurchaseEntryGate(x.config);
  assertBlockedStore(off.guestBrowse(intent()),'blocked');
  assertBlockedStore(await off.beforeStore(x.request(),intent(),now),'blocked');
  const before=x.s.reads;
  const guest=x.gate.guestBrowse(intent());
  assertBlockedStore(guest,'guest_browsing');
  assert.equal(guest.guest_free_browse_allowed,true);
  assert.equal(guest.login_required_before_store,false);
  assert.equal(x.s.reads,before);
 }finally{x.close();}
});
test('Q2 unauthenticated purchase tap must require Starry login; cancellation returns original flow with NO Store',async()=>{
 const x=await setup();try{
  const empty=new Request(origin+'/purchase-identity',{method:'POST'});
  const before=x.s.reads;
  const login=await x.gate.beforeStore(empty,intent(),now);
  assertBlockedStore(login,'login_required');
  assert.equal(login.login_required_before_store,true);
  assert.equal(login.flow_ref,flow_ref);
  assert.equal(x.s.reads,before);
  const cancel=x.gate.cancelLogin(intent());
  assertBlockedStore(cancel,'cancelled_to_original_flow');
  assert.equal(cancel.flow_ref,flow_ref);
  assert.equal(x.gate.readServerIdentity(cancel,intent(),now),null);
 }finally{x.close();}
});
test('real HMAC signed Session + SQLite Member/provider link can bind server-only identity but NEVER start Store',async()=>{
 const x=await setup();try{
  const result=await x.gate.beforeStore(x.request(),intent(),now);
  assertBlockedStore(result,'identity_verified_only');
  assert.equal(result.reason,'IDENTITY_VERIFIED_NOT_STORE_APPROVED');
  assert.equal(x.s.reads,3);assert.ok(x.s.queries.every(q=>q.startsWith('SELECT ')));
  const binding=x.gate.readServerIdentity(result,intent(),now);
  assert.equal(binding.starryUserId,'u1');
  assert.equal(binding.session_id,'sess1');
  assert.equal(binding.app_id,'starry-id');
  assert.equal(binding.scope,'purchase_identity_only');
  assert.equal(x.gate.readServerIdentity({...result},intent(),now),null);
  assert.equal(x.gate.readServerIdentity(JSON.parse(JSON.stringify(result)),intent(),now),null);
  assert.equal(x.gate.readServerIdentity(result,intent(),now+6),null);
 }finally{x.close();}
});
test('cancel then successful login MUST revalidate actual signed request; cannot bypass with client loggedIn flag',async()=>{
 const x=await setup();try{
  const bogus={...intent(),isLoggedIn:true};
  assertBlockedStore(await x.gate.beforeStore(x.request(),bogus,now),'blocked');
  const fake={...intent(),starryUserId:'u1',sessionValid:true};
  assertBlockedStore(await x.gate.beforeStore(x.request(),fake,now),'blocked');
  assert.equal(x.s.reads,0);
  const res=await x.gate.resumeAfterLogin(x.request(),intent(),now);
  assertBlockedStore(res,'identity_verified_only');
  assert.equal(res.flow_ref,flow_ref);
  assert.equal(x.gate.readServerIdentity(res,intent(),now).starryUserId,'u1');
 }finally{x.close();}
});
test('revoked, expired, suspended/deleted or stale version Session/Membership requires login; never stores identity',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at="+now+" WHERE session_id='sess1'",
  "UPDATE starry_sessions SET expires_at="+(now-1)+" WHERE session_id='sess1'",
  "UPDATE starry_sessions SET app_id='other-app' WHERE session_id='sess1'",
  "UPDATE starry_sessions SET environment='development' WHERE session_id='sess1'",
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
  "DELETE FROM starry_identities WHERE s_user_id='u1'"
 ]){
  const x=await setup();try{
   x.rawDb.exec(sql);
   const result=await x.gate.beforeStore(x.request(),intent(),now);
   assertBlockedStore(result,'login_required');
   assert.equal(x.gate.readServerIdentity(result,intent(),now),null);
  }finally{x.close();}
 }
});
test('wrong brand, other app/env, invalid flow, replays and cross-domain request fail closed',async()=>{
 const x=await setup();try{
  for(const bad of [
   {...intent(),brand_id:'hglobal'},
   {...intent(),app_id:'other-app'},
   {...intent(),environment:'production'},
   {...intent(),flow_ref:'too-short'},
   {...intent(),loggedIn:true},
   {...intent(),store_product_id:'paid_product'},
   {...intent(),flow_ref:'u1'},
  ]){
   assertBlockedStore(await x.gate.beforeStore(x.request(),bad,now),'blocked');
  }
  assert.equal(x.s.reads,0);
  for(const req of [
   x.request('u1',{url:'https://other.invalid/purchase'}),
   x.request('u1',{url:origin+'/purchase?access_token=token'}),
   x.request('u1',{headers:{cookie:'old-session'}}),
   new Request(origin+'/purchase',{method:'POST',headers:{authorization:'Bearer fake'}})
  ]){
   assertBlockedStore(await x.gate.beforeStore(req,intent(),now),'login_required');
  }
 }finally{x.close();}
});
test('member switch after login cannot silently carry old purchase identity to another Starry account',async()=>{
 const x=await setup();try{
  const first=await x.gate.beforeStore(x.request('u1'),intent(),now);
  const same=await x.gate.resumeAfterLogin(x.request('u1'),intent(),now);
  const changed=await x.gate.resumeAfterLogin(x.request('u2'),intent(),now);
  assertBlockedStore(first,'identity_verified_only');
  assertBlockedStore(same,'identity_verified_only');
  assertBlockedStore(changed,'identity_verified_only');
  assert.equal(x.gate.sameVerifiedMember(first,same,intent(),now),true);
  assert.equal(x.gate.sameVerifiedMember(first,changed,intent(),now),false);
  assert.equal(x.gate.readServerIdentity(changed,intent(),now).starryUserId,'u2');
  assert.equal(x.gate.readServerIdentity(first,{...intent(),flow_ref:'Z'.repeat(48)},now),null);
  assert.equal(x.gate.sameVerifiedMember(first,same,intent(),now+6),false);
 }finally{x.close();}
});
test('private keyring outage, D1 outage, tampered JWT, invalid server time fail closed',async()=>{
 const x=await setup();try{
  x.s.dbOut=true;
  assertBlockedStore(await x.gate.beforeStore(x.request(),intent(),now),'login_required');
  x.s.dbOut=false;x.s.keyOut=true;
  assertBlockedStore(await x.gate.beforeStore(x.request(),intent(),now),'login_required');
  x.s.keyOut=false;
  const bad=new Request(origin+'/purchase',{method:'POST',
   headers:{authorization:'Bearer '+x.tokens.u1.slice(0,-3)+'abc'}});
  assertBlockedStore(await x.gate.beforeStore(bad,intent(),now),'login_required');
  assertBlockedStore(await x.gate.beforeStore(x.request(),intent(),Number.NaN),'blocked');
 }finally{x.close();}
});
test('Q2 identity gate denies Production/H-Global construction, no paid access or cross-store order transfer',async()=>{
 const x=await setup();try{
  assert.throws(()=>createOfflineStarryPurchaseEntryGate({
   ...x.config,serverScope:{...scope,brand_id:'hglobal'}}),/SCOPE_DENIED/);
  assert.throws(()=>createOfflineStarryPurchaseEntryGate({
   ...x.config,serverScope:{...scope,environment:'production'}}),/SCOPE_DENIED/);
  const result=await x.gate.beforeStore(x.request(),intent(),now);
  assertBlockedStore(result,'identity_verified_only');
  assert.equal(result.may_transfer_store_transaction,false);
  assert.equal(result.may_grant_entitlement,false);
  assert.equal(result.may_charge,false);
 }finally{x.close();}
});
