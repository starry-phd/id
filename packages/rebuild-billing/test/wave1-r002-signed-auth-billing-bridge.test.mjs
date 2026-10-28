import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {signServerSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createOfflineWave1SignedBillingBridge,
 WAVE1_R002_BILLING_BRIDGE,WAVE1_R002_BILLING_LIVE}
 from '../src/wave1-r002-signed-auth-billing-bridge.ts';

const NOW=1793000000;
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const origin='https://id.starry.example';
const flow_ref='wave2_'+'A'.repeat(48);
const intent=()=>({...scope,flow_ref});
const buyout={product_key:'premium.buyout',kind:'NON_CONSUMABLE',period:null,
 sku_ios:'starry.id.ios.buyout',sku_android:'starry.id.android.buyout',
 features:['permanent_access']};
const monthly={product_key:'premium.monthly',kind:'AUTO_RENEWABLE_SUBSCRIPTION',
 period:'MONTH',sku_ios:'starry.id.ios.month',
 sku_android:'starry.id.android.month',features:['cloud_sync']};
const yearly={product_key:'premium.yearly',kind:'AUTO_RENEWABLE_SUBSCRIPTION',
 period:'YEAR',sku_ios:'starry.id.ios.year',
 sku_android:'starry.id.android.year',features:['cloud_sync']};
const ev=(member_digest,product_key='premium.monthly',x={})=>({
 event_ref:'r_'+'a'.repeat(64),brand_id:'starry',app_id:'starry-id',
 environment:'staging',member_digest,product_key,platform:'ios',
 source:'revenuecat_unverified_fixture',version:1,status:'active',
 expires_at_sec:product_key==='premium.buyout'?null:NOW+3600,...x
});
function denied(r){
 assert.equal(r.contract,WAVE1_R002_BILLING_BRIDGE);
 assert.equal(r.official_store_verified,false);
 assert.equal(r.official_revenuecat_verified,false);
 assert.equal(r.live_auth_approved,false);
 assert.equal(r.live_member_binding_approved,false);
 for(const k of ['can_start_purchase','can_restore','can_grant',
  'can_remove_ads','can_ack_webhook','can_publish','live',
  'cross_store_transaction_transfer'])assert.equal(r[k],false,k);
 const raw=JSON.stringify(r);
 for(const secret of ['u1','sess1','apple-sub','m_'+'a'.repeat(64),
  'Bearer','refresh_hash'])assert.equal(raw.includes(secret),false,secret);
}
async function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 for(const [user,subject] of [['u1','apple-sub'],['u2','second-sub']]){
  db.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(user,'active',3,1,'synthetic',0,0,NOW,NOW);
  db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .run('apple',subject,user);
 }
 for(const [session,user,hash] of [['sess1','u1','a'],['sess2','u2','b']]){
  db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(session,user,scope.app_id,scope.environment,3,hash.repeat(64),NOW+300,null,null,null);
 }
 const flags={out:false,keyOut:false,reads:0,events:0};
 const authDb={prepare(sql){
  assert.match(sql,/^SELECT /);
  return {bind(...args){return {first:async()=>{
   flags.reads++;
   if(flags.out)throw Error('d1 outage');
   return db.prepare(sql).get(...args)??null;
  }}};
 }};
 const key=await crypto.subtle.generateKey(
  {name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const digestKey=await crypto.subtle.generateKey(
  {name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const token=async(user='u1')=>signServerSession({
  brand_id:'starry',app_id:scope.app_id,environment:scope.environment,
  provider:'apple',provider_subject:user==='u1'?'apple-sub':'second-sub',
  s_user_id:user,session_id:user==='u1'?'sess1':'sess2',
  auth_version:3,expires_at:NOW+300,issued_at:NOW,key_id:'w2'},scope,NOW,
  {kid:'w2',key});
 const t1=await token(),t2=await token('u2');
 const request=(user='u1')=>new Request(origin+'/purchase-identity',{
  method:'POST',headers:{authorization:'Bearer '+(user==='u1'?t1:t2)}
 });
 const digest=async(user='u1')=>{
  const data=new TextEncoder().encode(
   'starry-billing-r002\0'+scope.app_id+'\0'+scope.environment+'\0'+user);
  const hash=new Uint8Array(await crypto.subtle.sign('HMAC',digestKey,data));
  return 'm_'+[...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
 };
 const state={events:[]};
 const make=(override={})=>createOfflineWave1SignedBillingBridge({
  enabled:true,scope,expectedOrigin:origin,
  products:[buyout,monthly,yearly],
  ports:{
   authDb,getVerificationKey:async kid=>{
    if(flags.keyOut)throw Error('key outage');
    return kid==='w2'?key:null;
   },offlineDigestKey:digestKey,
   readCandidateEvents:async()=>{flags.events++;return state.events;}
  },...override
 });
 return {db,flags,state,make,request,digest,key,digestKey,close(){db.close();}};
}
test('r002 default OFF and no unapproved purchase authority',async()=>{
 const x=await setup();try{
  assert.equal(WAVE1_R002_BILLING_LIVE,false);
  const off=x.make({enabled:false});
  const r=await off.inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(r);assert.equal(r.state,'blocked');
  assert.equal(x.flags.reads,0);
 }finally{x.close();}
});
test('actual signed Session + SQLite Auth triple-read into Billing review',async()=>{
 const x=await setup();try{
  x.state.events=[ev(await x.digest())];
  const o=await x.make().inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(o);assert.equal(o.state,'review_only');
  assert.equal(o.auth_source,'ai1_signed_session_sql_offline');
  assert.equal(o.signed_session_revalidated_offline,true);
  assert.equal(o.candidate.subscription_candidate,'active_local');
  assert.equal(x.flags.events,1);
  assert.ok(x.flags.reads>=9); // 3 Session/Member/provider SELECT x3
 }finally{x.close();}
});
test('anonymous, fake UI login flag or forged JWT cannot reach candidate read',async()=>{
 const x=await setup();try{
  const unknown=new Request(origin+'/purchase-identity',{method:'POST'});
  for(const [req,int] of [
   [unknown,intent()],
   [x.request(),{...intent(),isLoggedIn:true}],
   [new Request(origin+'/purchase-identity',{method:'POST',headers:{
    authorization:'Bearer v1.fake.not-a-signature'}}),intent()],
   [x.request(),{...intent(),app_id:'other-app'}]
  ]){
   const o=await x.make().inspect(req,int,'premium.monthly',NOW);
   denied(o);assert.equal(o.state,'blocked');
  }
  assert.equal(x.flags.events,0);
 }finally{x.close();}
});
test('revoked, deleted and stale auth_version fail closed before Store',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='sess1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'"
 ]){
  const x=await setup();try{
   x.db.exec(sql);
   const out=await x.make().inspect(x.request(),intent(),'premium.monthly',NOW);
   denied(out);assert.equal(out.state,'blocked');
   assert.equal(x.flags.events,0);
  }finally{x.close();}
 }
});
test('revocation DURING Billing event read is detected by final signed SQL',async()=>{
 const x=await setup();try{
  const review=x.make({ports:{
   authDb:{prepare(sql){return {bind(...a){return {first:async()=>{
    x.flags.reads++;
    return x.db.prepare(sql).get(...a)??null;
   }}}}},
   getVerificationKey:async()=>x.key,offlineDigestKey:x.digestKey,
   readCandidateEvents:async()=>{
    x.flags.events++;
    x.db.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='sess1'");
    return [ev(await x.digest())];
   }
  }});
  const out=await review.inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(out);assert.equal(out.state,'blocked');
  assert.equal(out.reason,'AUTH_CHANGED_AFTER_BILLING');
 }finally{x.close();}
});
test('account switched after initial read cannot authorize current review',async()=>{
 const x=await setup();try{
  const a=await x.digest('u1');
  x.state.events=[ev(a,{...{}})];
  const out=await x.make().inspect(x.request('u2'),intent(),'premium.monthly',NOW);
  denied(out);assert.equal(out.state,'blocked');
 }finally{x.close();}
});
test('App B event cannot unlock App A even with genuine Auth session',async()=>{
 const x=await setup();try{
  x.state.events=[ev(await x.digest(),'premium.monthly',{app_id:'starry.other'})];
  const out=await x.make().inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(out);assert.equal(out.state,'blocked');
  assert.equal(out.reason,'BILLING_CANDIDATE_REJECTED');
 }finally{x.close();}
});
test('another member HMAC digest does not match same-App signed identity',async()=>{
 const x=await setup();try{
  x.state.events=[ev(await x.digest('u2'))];
  const out=await x.make().inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(out);assert.equal(out.state,'blocked');
 }finally{x.close();}
});
test('buyout survives expired subscription even when scope bound',async()=>{
 const x=await setup();try{
  const m=await x.digest();
  x.state.events=[
   ev(m,'premium.buyout',{event_ref:'r_'+'b'.repeat(64),
    expires_at_sec:null}),
   ev(m,'premium.monthly',{event_ref:'r_'+'c'.repeat(64),
    status:'expired',expires_at_sec:NOW-2})
  ];
  const buy=await x.make().inspect(x.request(),intent(),'premium.buyout',NOW);
  denied(buy);assert.equal(buy.state,'review_only');
  assert.equal(buy.candidate.permanent_candidate,'active_local');
  const month=await x.make().inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(month);assert.equal(month.candidate.subscription_candidate,'expired_local');
 }finally{x.close();}
});
test('later refund and void event remain local, never purchase or restore',async()=>{
 const x=await setup();try{
  const m=await x.digest();
  x.state.events=[
   ev(m,'premium.monthly',{event_ref:'r_'+'a'.repeat(64),version:1}),
   ev(m,'premium.monthly',{event_ref:'r_'+'d'.repeat(64),version:9,status:'refunded'})
  ];
  const o=await x.make().inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(o);assert.equal(o.state,'review_only');
  assert.equal(o.candidate.subscription_candidate,'revoked_local');
 }finally{x.close();}
});
test('HMAC key, SQL and Store service outage all deny',async()=>{
 const x=await setup();try{
  x.flags.keyOut=true;
  denied(await x.make().inspect(x.request(),intent(),'premium.monthly',NOW));
  x.flags.keyOut=false;x.flags.out=true;
  denied(await x.make().inspect(x.request(),intent(),'premium.monthly',NOW));
  x.flags.out=false;
  const broken=x.make({ports:{
   authDb:{prepare(){throw Error('sql outage')}},
   getVerificationKey:async()=>x.key,offlineDigestKey:x.digestKey,
   readCandidateEvents:async()=>{throw Error('fixture Store down');}
  }});
  const o=await broken.inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(o);assert.equal(o.state,'blocked');
 }finally{x.close();}
});
test('invalid brand/production HMAC algorithm or duplicate SKU rejected',async()=>{
 const x=await setup();try{
  for(const s of [
   {...scope,brand_id:'hglobal'},
   {...scope,environment:'production'}
  ])assert.throws(()=>x.make({scope:s}));
  const shaKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},
   false,['verify']);
  assert.throws(()=>x.make({ports:{
   authDb:{prepare(){throw Error()}},getVerificationKey:async()=>x.key,
   offlineDigestKey:shaKey,readCandidateEvents:async()=>[]
  }}));
  const duplicate={...monthly,product_key:'premium.another',
   sku_ios:monthly.sku_ios};
  const o=await x.make({products:[monthly,duplicate]})
   .inspect(x.request(),intent(),'premium.monthly',NOW);
  denied(o);assert.equal(o.state,'blocked');
 }finally{x.close();}
});
test('unknown IAP, Battery product and invalid flow cannot gain a grant',async()=>{
 const x=await setup();try{
  for(const product of ['starry.battery.topup','unknown.product',null]){
   const o=await x.make().inspect(x.request(),intent(),product,NOW);
   denied(o);assert.equal(o.state,'blocked');
  }
 }finally{x.close();}
});
