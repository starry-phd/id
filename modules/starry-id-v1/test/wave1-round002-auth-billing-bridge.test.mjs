import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {signServerSession} from '../src/session-crypto.ts';
import {createOfflineWave1BillingIdentityBridge,R002_BILLING_IDENTITY_CONTRACT,
 R002_BILLING_IDENTITY_LIVE} from '../src/wave1-round002-auth-billing-bridge.ts';
import {createOfflineWave1BillingPolicy} from '../../../packages/rebuild-billing/src/wave1-billing-revenuecat-review.ts';

const NOW=1793000000,origin='https://id.starry.example';
const flow_ref='w2_'+ 'A'.repeat(48);
const scope=(app_id='starry.one',environment='staging')=>({
 brand_id:'starry',app_id,environment});
const intent=(s=scope(),ref=flow_ref)=>({...s,flow_ref:ref});
async function make(){
 const dbRaw=new DatabaseSync(':memory:');
 dbRaw.exec('PRAGMA foreign_keys=ON');
 dbRaw.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 for(const [user,sub] of [['u1','sub-one'],['u2','sub-two']]){
  dbRaw.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(user,'active',3,1,null,0,0,NOW,NOW);
  dbRaw.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .run('apple',sub,user);
 }
 for(const app of ['starry.one','starry.two']){
  for(const user of ['u1','u2']){
   dbRaw.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('session-'+app+'-'+user,user,app,'staging',3,
     (app==='starry.one'?'a':'b').repeat(63)+(user==='u1'?'1':'2'),
     NOW+300,null,null,null);
  }
 }
 const state={reads:0,dbOut:false,keyOut:false,digestOut:false};
 const db={prepare(sql){
  assert.match(sql,/^SELECT /);state.reads++;
  return {bind(...args){return {first:async()=>{
   if(state.dbOut)throw Error('D1 offline');
   return dbRaw.prepare(sql).get(...args)??null;
  }};}};
 }};
 const sessionKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const digestKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const config=(s=scope())=>({
  enabled:true,serverScope:s,expectedOrigin:origin,authDb:db,
  getVerificationKey:async kid=>{
   if(state.keyOut)throw Error('key outage');
   return kid==='kid-wave2'?sessionKey:null;
  },getMemberDigestKey:async()=>{
   if(state.digestOut)throw Error('digest outage');
   return digestKey;
  }
 });
 const token=async(s=scope(),user='u1')=>
  signServerSession({brand_id:'starry',app_id:s.app_id,environment:s.environment,
   provider:'apple',provider_subject:user==='u1'?'sub-one':'sub-two',
   s_user_id:user,session_id:'session-'+s.app_id+'-'+user,
   auth_version:3,expires_at:NOW+300,issued_at:NOW,key_id:'kid-wave2'},
   s,NOW,{kid:'kid-wave2',key:sessionKey});
 const request=async(s=scope(),user='u1')=>new Request(origin+'/auth-private',
  {method:'POST',headers:{authorization:'Bearer '+await token(s,user)}});
 const bridge=(s=scope())=>createOfflineWave1BillingIdentityBridge(config(s));
 return {dbRaw,db,state,config,bridge,request,token,sessionKey,digestKey,
  close(){dbRaw.close();}};
}
function safe(r,status){
 assert.equal(r.contract,R002_BILLING_IDENTITY_CONTRACT);
 assert.equal(r.status,status);
 for(const p of ['verified_live','may_purchase','may_grant','may_restore',
  'may_charge','may_open_store','may_ack_webhook'])assert.equal(r[p],false,p);
 const j=JSON.stringify(r);
 for(const raw of ['u1','u2','session-starry','sub-one','m_','member_digest',
  'starryUserId','auth_version','Bearer ','refresh_hash'])
  assert.equal(j.includes(raw),false,raw);
}
test('R002 OFF by default, guest/missing signed request never maps to Billing',async()=>{
 const f=await make();try{
  assert.equal(R002_BILLING_IDENTITY_LIVE,false);
  const off=createOfflineWave1BillingIdentityBridge({...f.config(),enabled:false});
  safe(await off.reviewFresh(await f.request(),intent(),NOW),'blocked');
  assert.equal(f.state.reads,0);
  const b=f.bridge(),empty=new Request(origin+'/auth-private');
  safe(await b.reviewFresh(empty,intent(),NOW),'login_required');
  assert.equal(f.state.reads,0);
 }finally{f.close();}
});
test('TRUE WebCrypto signature + CURRENT SQLite Auth reads => HMAC app-scope digest only in private port',async()=>{
 const f=await make();try{
  const b=f.bridge(),out=await b.reviewFresh(await f.request(),intent(),NOW);
  safe(out,'identity_review_only');
  assert.equal(f.state.reads,3);
  const privateData=b.readServerReview(out,intent(),NOW);
  assert.equal(privateData.kind,'signed_auth_d1_review_only');
  assert.equal(privateData.app_id,'starry.one');
  assert.equal(privateData.auth_version,3);
  assert.match(privateData.member_digest,/^m_[a-f0-9]{64}$/);
  assert.equal(privateData.verified_live,false);
  assert.equal(privateData.billing_authorized,false);
  assert.equal(b.readServerReview({...out},intent(),NOW),null);
  assert.equal(b.readServerReview(JSON.parse(JSON.stringify(out)),intent(),NOW),null);
  assert.equal(b.readServerReview(out,intent(),NOW+6),null);
  assert.equal(b.readServerReview(out,intent(scope(),'Z'.repeat(48)),NOW),null);
 }finally{f.close();}
});
test('same app/same user digest deterministic but member SWITCH/expired or copied previous proof denied',async()=>{
 const f=await make();try{
  const b=f.bridge();
  const first=await b.reviewFresh(await f.request(),intent(),NOW);
  const next=await b.reviewFresh(await f.request(),intent(),NOW,first);
  safe(next,'identity_review_only');
  assert.equal(b.readServerReview(first,intent(),NOW).member_digest,
   b.readServerReview(next,intent(),NOW).member_digest);
  safe(await b.reviewFresh(await f.request(scope(),'u2'),intent(),NOW,first),'member_changed');
  safe(await b.reviewFresh(await f.request(),intent(),NOW,{...first}),'blocked');
  safe(await b.reviewFresh(await f.request(),intent(),NOW+6,first),'blocked');
 }finally{f.close();}
});
test('same Starry user DOES NOT share member digest across different App IDs or environment',async()=>{
 const f=await make();try{
  const a=f.bridge(scope('starry.one')),b=f.bridge(scope('starry.two'));
  const x=await a.reviewFresh(await f.request(scope('starry.one')),intent(scope('starry.one')),NOW);
  const y=await b.reviewFresh(await f.request(scope('starry.two')),intent(scope('starry.two')),NOW);
  safe(x,'identity_review_only');safe(y,'identity_review_only');
  const digestA=a.readServerReview(x,intent(scope('starry.one')),NOW).member_digest;
  const digestB=b.readServerReview(y,intent(scope('starry.two')),NOW).member_digest;
  assert.notEqual(digestA,digestB);
  assert.equal(b.readServerReview(x,intent(scope('starry.two')),NOW),null);
  safe(await b.reviewFresh(await f.request(scope('starry.one')),
   intent(scope('starry.two')),NOW),'login_required');
 }finally{f.close();}
});
test('member Session revoke or changed auth_version AFTER review forces fresh D1 rejection',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-starry.one-u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "DELETE FROM starry_identities WHERE s_user_id='u1'",
  "UPDATE starry_sessions SET expires_at="+(NOW-1)+" WHERE session_id='session-starry.one-u1'"
 ]){
  const f=await make();try{
   const b=f.bridge(),before=await b.reviewFresh(await f.request(),intent(),NOW);
   safe(before,'identity_review_only');
   f.dbRaw.exec(sql);
   const after=await b.reviewFresh(await f.request(),intent(),NOW,before);
   safe(after,'login_required');
   assert.equal(b.readServerReview(after,intent(),NOW),null);
  }finally{f.close();}
 }
});
test('foreign brand/app/environment, fake digest and fake loggedIn are denied BEFORE SQL',async()=>{
 const f=await make();try{
  const b=f.bridge(),request=await f.request();
  const invalid=[
   {...intent(),brand_id:'hglobal'},
   {...intent(),app_id:'starry.two'},
   {...intent(),environment:'production'},
   {...intent(),member_digest:'m_'+'f'.repeat(64)},
   {...intent(),loggedIn:true},
   {...intent(),flow_ref:'bad'},
  ];
  for(const x of invalid)safe(await b.reviewFresh(request,x,NOW),'blocked');
  assert.equal(f.state.reads,0);
  assert.throws(()=>createOfflineWave1BillingIdentityBridge({
   ...f.config(),serverScope:{...scope(),environment:'production'}}),/SCOPE_OR_PORT/);
  assert.throws(()=>createOfflineWave1BillingIdentityBridge({
   ...f.config(),serverScope:{...scope(),brand_id:'hglobal'}}),/SCOPE_OR_PORT/);
 }finally{f.close();}
});
test('D1 outage, Session key outage or digest key outage fail closed with NO positive billing state',async()=>{
 const f=await make();try{
  const b=f.bridge();f.state.dbOut=true;
  safe(await b.reviewFresh(await f.request(),intent(),NOW),'login_required');
  f.state.dbOut=false;f.state.keyOut=true;
  safe(await b.reviewFresh(await f.request(),intent(),NOW),'login_required');
  f.state.keyOut=false;f.state.digestOut=true;
  safe(await b.reviewFresh(await f.request(),intent(),NOW),'blocked');
  assert.equal(f.state.reads>0,true);
 }finally{f.close();}
});
test('AI-2 existing fixture-only policy MUST NOT mistake real review kind for live purchase',async()=>{
 const f=await make();try{
  const b=f.bridge(),v=await b.reviewFresh(await f.request(),intent(),NOW);
  safe(v,'identity_review_only');
  const review=b.readServerReview(v,intent(),NOW);
  // AI-2 owns its policy and explicitly rejects our DIFFERENT kind.
  const policy=createOfflineWave1BillingPolicy({enabled:true,
   scope:scope(),nowSeconds:NOW,
   products:[{product_key:'premium.buyout',kind:'NON_CONSUMABLE',period:null,
    sku_ios:'starry.one.ios.buyout',sku_android:'starry.one.android.buyout',
    features:['premium_access']}],
   ports:{readIdentity:async()=>review,readCandidateEvents:async()=>[]}
  });
  const out=await policy.purchasePreflight('premium.buyout');
  assert.equal(out.status,'blocked');
  assert.equal(out.reason,'SIGNED_STARRY_SESSION_REQUIRED');
  assert.equal(out.may_start_purchase,false);
  assert.equal(out.may_grant,false);
 }finally{f.close();}
});
test('forged response, wrong URL, invalid time cannot reuse trusted review or cause DB payment',async()=>{
 const f=await make();try{
  const b=f.bridge();
  safe(await b.reviewFresh({authenticated:true},intent(),NOW),'login_required');
  const req=new Request('https://evil.invalid/hello',{
   headers:{authorization:'Bearer '+await f.token()}});
  safe(await b.reviewFresh(req,intent(),NOW),'login_required');
  safe(await b.reviewFresh(await f.request(),intent(),Number.NaN),'blocked');
  const first=await b.reviewFresh(await f.request(),intent(),NOW);
  assert.equal(b.readServerReview(first,intent(),NOW+301),null);
  assert.equal(b.readServerReview({status:'identity_review_only'},intent(),NOW),null);
 }finally{f.close();}
});
