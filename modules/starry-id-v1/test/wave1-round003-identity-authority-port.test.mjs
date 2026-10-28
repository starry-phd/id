import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {signServerSession} from '../src/session-crypto.ts';
import {createOfflineR003IdentityAuthorityPort,R003_AUTHORITY_VERSION,
 R003_AUTHORITY_LIVE} from '../src/wave1-round003-identity-authority-port.ts';
import {createOfflineWave1BillingPolicy} from '../../../packages/rebuild-billing/src/wave1-billing-revenuecat-review.ts';

const NOW=1793000000,origin='https://id.starry.example';
const REF='r3_'+'A'.repeat(45);
const scope=(app_id='starry.one',environment='staging')=>({
 brand_id:'starry',app_id,environment});
const intent=(s=scope(),flow_ref=REF)=>({...s,flow_ref});
async function fixture(){
 const raw=new DatabaseSync(':memory:');
 raw.exec('PRAGMA foreign_keys=ON');
 raw.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 for(const [u,sub] of [['u1','sub-one'],['u2','sub-two']]){
  raw.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(u,'active',3,1,null,0,0,NOW,NOW);
  raw.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .run('apple',sub,u);
  for(const app of ['starry.one','starry.two'])
   raw.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('session-'+app+'-'+u,u,app,'staging',3,
     (app==='starry.one'?'a':'b').repeat(63)+(u==='u1'?'1':'2'),
     NOW+300,null,null,null);
 }
 const state={reads:0,dbOut:false,keyOut:false,digestOut:false,rotateAfterFirst:false,
  midReadRevocation:false,activeEpoch:1,sessionKidOn:true};
 const db={prepare(sql){
  assert.match(sql,/^SELECT /);state.reads++;
  return {bind(...args){return {first:async()=>{
   if(state.dbOut)throw Error('D1 disconnected');
   if(state.midReadRevocation&&state.reads>=4)
    raw.exec("UPDATE starry_sessions SET revoked_at="+NOW+
     " WHERE session_id='session-starry.one-u1'");
   return raw.prepare(sql).get(...args)??null;
  }};}};
 }};
 const signKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const digest1=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const digest2=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const config=(s=scope())=>({
  enabled:true,serverScope:s,expectedOrigin:origin,authDb:db,
  getVerificationKey:async kid=>{
   if(state.keyOut)throw Error('signing key outage');
   return state.sessionKidOn&&kid==='session-kid'?signKey:null;
  },
  readActiveDigestKey:async()=>{
   if(state.digestOut)return null;
   const current=state.activeEpoch;
   if(state.rotateAfterFirst)state.activeEpoch=2;
   return {kid:current===1?'digest-v1':'digest-v2',
    epoch:current,key:current===1?digest1:digest2};
  }
 });
 const token=async(s=scope(),u='u1')=>signServerSession({
  brand_id:'starry',app_id:s.app_id,environment:s.environment,
  provider:'apple',provider_subject:u==='u1'?'sub-one':'sub-two',
  s_user_id:u,session_id:'session-'+s.app_id+'-'+u,
  auth_version:3,expires_at:NOW+300,issued_at:NOW,key_id:'session-kid'
 },s,NOW,{kid:'session-kid',key:signKey});
 const request=async(s=scope(),u='u1')=>new Request(origin+'/private',
  {method:'POST',headers:{authorization:'Bearer '+await token(s,u)}});
 const port=(s=scope())=>createOfflineR003IdentityAuthorityPort(config(s));
 return {raw,state,config,request,port,close(){raw.close();}};
}
function assertSafe(v,status){
 assert.equal(v.contract,R003_AUTHORITY_VERSION);
 assert.equal(v.status,status);
 for(const k of ['verified_live','may_open_store','may_purchase','may_restore',
  'may_grant','may_charge','may_ack_webhook'])assert.equal(v[k],false,k);
 const json=JSON.stringify(v);
 for(const bad of ['u1','u2','sub-one','session-','member_digest','digest_kid',
  'session_binding','auth_version','Bearer ','m_'])
  assert.equal(json.includes(bad),false,bad);
}
test('R003 default disabled, missing token and forged app status cannot provide proof',async()=>{
 const f=await fixture();try{
  assert.equal(R003_AUTHORITY_LIVE,false);
  const off=createOfflineR003IdentityAuthorityPort({...f.config(),enabled:false});
  assertSafe(await off.reviewFresh(await f.request(),intent(),NOW),'blocked');
  assert.equal(f.state.reads,0);
  const b=f.port();
  assertSafe(await b.reviewFresh({loggedIn:true},intent(),NOW),'blocked');
  assert.equal(b.readServerReview({status:'review_only'},intent(),NOW),null);
  assert.equal(f.state.reads,0);
 }finally{f.close();}
});
test('signed WebCrypto Session + two current Auth SQLite reads produce non-public one-use candidate',async()=>{
 const f=await fixture();try{
  const b=f.port(),v=await b.reviewFresh(await f.request(),intent(),NOW);
  assertSafe(v,'review_only');
  assert.equal(f.state.reads,6);
  const p=b.readServerReview(v,intent(),NOW);
  assert.equal(p.kind,'signed_auth_d1_review_only');
  assert.equal(p.brand_id,'starry');
  assert.equal(p.digest_format,'ai1.r002.json-hmac.v1');
  assert.equal(p.digest_kid,'digest-v1');
  assert.equal(p.auth_version,3);
  assert.match(p.member_digest,/^m_[a-f0-9]{64}$/);
  assert.match(p.session_binding,/^s_[a-f0-9]{64}$/);
  assert.equal(p.verified_live,false);
  assert.equal(p.billing_authorized,false);
  assert.equal(b.readServerReview(v,intent(),NOW),null);
  assert.equal(b.readServerReview({...v},intent(),NOW),null);
  assert.equal(b.readServerReview(JSON.parse(JSON.stringify(v)),intent(),NOW),null);
 }finally{f.close();}
});
test('same app same member stays stable but different App keys yield distinct digest',async()=>{
 const f=await fixture();try{
  const a=f.port(),b=f.port(scope('starry.two'));
  const v=await a.reviewFresh(await f.request(),intent(),NOW);
  const w=await b.reviewFresh(await f.request(scope('starry.two')),
   intent(scope('starry.two')),NOW);
  assertSafe(v,'review_only');assertSafe(w,'review_only');
  assert.notEqual(a.readServerReview(v,intent(),NOW).member_digest,
   b.readServerReview(w,intent(scope('starry.two')),NOW).member_digest);
 }finally{f.close();}
});
test('account switch, session rotation and cloned previous flow cannot pass replay gate',async()=>{
 const f=await fixture();try{
  const a=f.port(),first=await a.reviewFresh(await f.request(),intent(),NOW);
  assertSafe(first,'review_only');
  assertSafe(await a.reviewFresh(await f.request(scope(),'u2'),intent(),NOW,first),'blocked');
  assertSafe(await a.reviewFresh(await f.request(),intent(),NOW,{...first}),'blocked');
  assertSafe(await a.reviewFresh(await f.request(),intent(),NOW+6,first),'blocked');
  assert.equal(a.readServerReview(first,intent(scope(),'Z'.repeat(48)),NOW),null);
  const second=await a.reviewFresh(await f.request(),intent(),NOW,first);
  assertSafe(second,'review_only');
  f.raw.exec("UPDATE starry_sessions SET session_id='replacement-session' WHERE session_id='session-starry.one-u1'");
  assertSafe(await a.reviewFresh(await f.request(),intent(),NOW,first),'blocked');
 }finally{f.close();}
});
test('revoked, suspended, deleted, stale auth_version and provider mismatch fail closed',async()=>{
 const sqls=[
  "UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-starry.one-u1'",
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
  "DELETE FROM starry_identities WHERE s_user_id='u1'",
  "UPDATE starry_sessions SET expires_at="+(NOW-1)+" WHERE session_id='session-starry.one-u1'"
 ];
 for(const sql of sqls){
  const f=await fixture();try{
   f.raw.exec(sql);
   assertSafe(await f.port().reviewFresh(await f.request(),intent(),NOW),'blocked');
  }finally{f.close();}
 }
});
test('concurrent SQL revoke between first and second signed reads is DENIED',async()=>{
 const f=await fixture();try{
  f.state.midReadRevocation=true;
  assertSafe(await f.port().reviewFresh(await f.request(),intent(),NOW),'blocked');
  assert.equal(f.state.reads>=4,true);
 }finally{f.close();}
});
test('KID/epoch rotation, keyring outage, verifier revocation and D1 outage deny',async()=>{
 const f=await fixture();try{
  f.state.rotateAfterFirst=true;
  assertSafe(await f.port().reviewFresh(await f.request(),intent(),NOW),'blocked');
  f.state.rotateAfterFirst=false;f.state.activeEpoch=1;
  const b=f.port(),first=await b.reviewFresh(await f.request(),intent(),NOW);
  assertSafe(first,'review_only');
  f.state.activeEpoch=2;
  assertSafe(await b.reviewFresh(await f.request(),intent(),NOW,first),'blocked');
  f.state.digestOut=true;
  assertSafe(await b.reviewFresh(await f.request(),intent(),NOW),'blocked');
  f.state.digestOut=false;f.state.sessionKidOn=false;
  assertSafe(await b.reviewFresh(await f.request(),intent(),NOW),'blocked');
  f.state.sessionKidOn=true;f.state.dbOut=true;
  assertSafe(await b.reviewFresh(await f.request(),intent(),NOW),'blocked');
 }finally{f.close();}
});
test('cross-brand/app/env, malicious member digest, invalid scope/time all denied without SQL',async()=>{
 const f=await fixture();try{
  const b=f.port(),req=await f.request();
  const invalid=[
   {...intent(),brand_id:'hglobal'}, {...intent(),app_id:'starry.two'},
   {...intent(),environment:'production'}, {...intent(),member_digest:'m_'+'f'.repeat(64)},
   {...intent(),isLoggedIn:true}, {...intent(),flow_ref:'bad'} ];
  for(const x of invalid)assertSafe(await b.reviewFresh(req,x,NOW),'blocked');
  assertSafe(await b.reviewFresh(req,intent(),Number.NaN),'blocked');
  assert.equal(f.state.reads,0);
  assert.throws(()=>f.port(scope('starry.one','production')),/SCOPE_OR_KEYRING/);
 }finally{f.close();}
});
test('AI-2 fixture-only Billing policy rejects the R003 review-only private kind',async()=>{
 const f=await fixture();try{
  const b=f.port(),v=await b.reviewFresh(await f.request(),intent(),NOW);
  assertSafe(v,'review_only');
  const proof=b.readServerReview(v,intent(),NOW);
  const policy=createOfflineWave1BillingPolicy({enabled:true,scope:scope(),nowSeconds:NOW,
   products:[{product_key:'premium.buyout',kind:'NON_CONSUMABLE',period:null,
    sku_ios:'starry.one.ios.buyout',sku_android:'starry.one.android.buyout',
    features:['premium_access']}],
   ports:{readIdentity:async()=>proof,readCandidateEvents:async()=>[]}
  });
  const out=await policy.purchasePreflight('premium.buyout');
  assert.equal(out.status,'blocked');
  assert.equal(out.reason,'SIGNED_STARRY_SESSION_REQUIRED');
  assert.equal(out.may_start_purchase,false);
  assert.equal(out.may_grant,false);
 }finally{f.close();}
});
