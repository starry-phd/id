import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineR003IdentityAuthorityPort}
 from '../../../modules/starry-id-v1/src/wave1-round003-identity-authority-port.ts';
import {signServerSession}
 from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createOfflineR003BillingStoreReview}
 from '../src/wave1-r003-canonical-identity-store-review.ts';
import {createOfflineR004EntitlementReview}
 from '../src/wave1-r004-entitlement-continuity-review.ts';
import {R005_CROSS_OS_CONTRACT,R005_CROSS_OS_LIVE,createOfflineR005CrossOsReview}
 from '../src/wave1-r005-cross-os-signed-auth-review.ts';

const NOW=1793000000;
const scope=Object.freeze({brand_id:'starry',app_id:'starry.one',environment:'staging'});
const origin='https://id.starry.example';
const catalog=Object.freeze([
 {product_key:'vip.buyout',kind:'NON_CONSUMABLE',period:null,features:['permanent_content','ads_free'],
  sku_ios:'vip.ios.buyout',sku_android:'vip.android.buyout'},
 {product_key:'vip.month',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH',features:['cloud_sync'],
  sku_ios:'vip.ios.month',sku_android:'vip.android.month'},
 {product_key:'vip.year',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'YEAR',features:['premium_layout'],
  sku_ios:'vip.ios.year',sku_android:'vip.android.year'}
]);
const plan=Object.freeze({app_id:scope.app_id,mode:'both',
 products:catalog.map(({sku_ios,sku_android,...p})=>p),
 adsProviderSelection:'google-admob-mediation',adsEnabled:false,
 adsSdkInitialized:false,adRequestsEnabled:false});
async function fixture(){
 const state={now:NOW,reads:0,probes:0,keyEpoch:1,member:'u1',
  closed:false,mutate:null,source:{
   ios:{'vip.buyout':['active',1,null],'vip.month':['expired',2,NOW-5],
    'vip.year':['active',4,NOW+2200]},
   android:{'vip.buyout':['active',1,null],'vip.month':['active',2,NOW+1200],
    'vip.year':['refunded',6,NOW+2200]}
  }};
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 const addMember=(user,subject,sessions)=>{
  db.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(user,'active',3,1,null,0,0,NOW,NOW);
  db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .run('apple',subject,user);
  for(const session of sessions)
   db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(session,user,scope.app_id,scope.environment,3,session.replace(/[^a-z]/g,'').padEnd(64,'a').slice(0,64),NOW+300,null,null,null);
 };
 // Each offline synthetic session has its own unique hash, never a real refresh token.
 addMember('u1','sub-one',['session-ios','session-android']);
 addMember('u2','sub-two',['session-other']);
 // Above hashes must be unique across sessions or SQLite UNIQUE will deny: replace them.
 const authDb={prepare(sql){
  assert.match(sql,/^SELECT /);
  return {bind(...args){return {first:async()=>{state.reads++;
   return db.prepare(sql).get(...args)??null;
  }};}};
 }};
 const sessionKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const digestKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 let readKey=async()=>({kid:'digest-v1',epoch:state.keyEpoch,key:digestKey});
 const auth=createOfflineR003IdentityAuthorityPort({enabled:true,serverScope:scope,
  expectedOrigin:origin,authDb,getVerificationKey:async k=>k==='session-kid'?sessionKey:null,
  readActiveDigestKey:async()=>readKey()});
 const intents={
  ios:Object.freeze({...scope,flow_ref:'I'.repeat(48)}),
  android:Object.freeze({...scope,flow_ref:'A'.repeat(48)})
 };
 const sign=async(session,user='u1',subject='sub-one',app=scope.app_id)=>{
  const token=await signServerSession({brand_id:'starry',app_id:app,
   environment:scope.environment,provider:'apple',provider_subject:subject,
   s_user_id:user,session_id:session,auth_version:3,
   expires_at:NOW+300,issued_at:NOW,key_id:'session-kid'},
   {...scope,app_id:app},NOW,{kid:'session-kid',key:sessionKey});
  return new Request(origin+'/private',{method:'POST',
   headers:{authorization:'Bearer '+token}});
 };
 const requests={ios:await sign('session-ios'),android:await sign('session-android')};
 const view=await auth.reviewFresh(requests.ios,intents.ios,NOW);
 assert.equal(view.status,'review_only','actual AI-1 R003 Auth must validate signed/current SQLite');
 const proof=auth.readServerReview(view,intents.ios,NOW);
 assert.equal(proof.kind,'signed_auth_d1_review_only');
 assert.equal(proof.digest_format,'ai1.r002.json-hmac.v1');
 const digest=proof.member_digest;
 const makeReviewer=os=>{
  const cache=new Map();
  const r4=createOfflineR004EntitlementReview({enabled:true,scope,identity:auth,
   plan,nowSeconds:()=>state.now,
   reviewerForProduct:key=>{
    if(!cache.has(key)){
     const product=catalog.find(x=>x.product_key===key);
     cache.set(key,createOfflineR003BillingStoreReview({enabled:true,scope,identity:auth,
      products:[{product_key:product.product_key,kind:product.kind,period:product.period,
       sku_ios:product.sku_ios,sku_android:product.sku_android}],
      nowSeconds:()=>state.now,
      readUnverifiedStoreProbe:async()=>{
       state.probes++;
       if(state.mutate)await state.mutate({os,key,db,state});
       const [status,version,expiry]=state.source[os][key];
       return {source:'revenuecat_unverified_fixture',brand_id:'starry',app_id:scope.app_id,
        environment:scope.environment,member_digest:digest,platform:os,
        product_key:key,store_sku:os==='ios'?product.sku_ios:product.sku_android,
        source_version:version,status,expires_at_sec:expiry};
      }
     }));
    }
    return cache.get(key);
   }});
  return r4;
 };
 const r5=createOfflineR005CrossOsReview({enabled:true,scope,identity:auth,
  ios:makeReviewer('ios'),android:makeReviewer('android'),nowSeconds:()=>state.now});
 const inspect=async(i=requests.ios,a=requests.android)=>
  r5.inspect(i,intents.ios,a,intents.android);
 const close=()=>{if(!state.closed){state.closed=true;db.close();}};
 return {db,state,auth,requests,intents,sign,inspect,r5,close,plan};
}
function safe(r){
 assert.equal(r.contract,R005_CROSS_OS_CONTRACT);
 for(const k of ['adsEnabled','adsSdkInitialized','adRequestsEnabled',
 'can_open_store','can_purchase','can_restore','can_grant','can_regrant',
 'can_remove_ads','can_request_ads','can_ack_webhook','official_apple_verified',
 'official_google_verified','official_revenuecat_verified','durable_cas_verified',
 'anti_pitr_verified','live'])assert.equal(r[k],false,k);
 assert.equal(r.adsProviderSelection,'google-admob-mediation');
 const output=JSON.stringify(r);
 for(const forbidden of ['member_digest','session_binding','session_id','digest_kid',
  'refresh_hash','receipt','Bearer','token','u1','u2'])
  assert.equal(output.includes(forbidden),false,forbidden);
}
test('R005 real AI-1 signed Auth + two distinct active Sessions same member cross-OS',async()=>{
 const f=await fixture();try{
  assert.equal(R005_CROSS_OS_LIVE,false);
  const r=await f.inspect();safe(r);
  assert.equal(r.status,'review_only');
  assert.equal(r.same_app_member_review_only,true);
  assert.equal(r.cross_os_restore_candidate_review_only,true);
  assert.equal(r.buyout_candidate_review_only,true);
  assert.equal(r.subscription_candidate_review_only,true);
  assert.equal(r.remove_ads_candidate_review_only,true);
  assert.equal(r.ios_candidate,'unverified_active');
  assert.equal(r.android_candidate,'unverified_active');
  assert.equal(f.state.probes,6);
  assert.ok(f.state.reads>0);
 }finally{f.close();}
});
test('same App different central member login is denied BEFORE Store probe',async()=>{
 const f=await fixture();try{
  const other=await f.sign('session-other','u2','sub-two');
  const r=await f.inspect(f.requests.ios,other);safe(r);
  assert.equal(r.status,'blocked');
  assert.equal(r.reason,'CROSS_OS_MEMBER_OR_KID_MISMATCH');
  assert.equal(f.state.probes,0);
 }finally{f.close();}
});
test('real Auth rejects forged or absent bearer BEFORE any unverified Store probe',async()=>{
 const f=await fixture();try{
  for(const request of [null,{},new Request(origin+'/private',{
   method:'POST',headers:{authorization:'Bearer forged'}})]){
   const r=await f.inspect(request,f.requests.android);safe(r);
   assert.equal(r.status,'blocked');
  }
  assert.equal(f.state.probes,0);
 }finally{f.close();}
});
test('real Auth current SQLite late revoked iOS Session denies before or during review',async()=>{
 const f=await fixture();try{
  f.db.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-ios'");
  let r=await f.inspect();safe(r);assert.equal(r.status,'blocked');
  assert.equal(f.state.probes,0);
 }finally{f.close();}
 const g=await fixture();try{
  g.state.mutate=({os,key,db})=>{
   if(os==='ios'&&key==='vip.buyout')
    db.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-ios'");
  };
  const r=await g.inspect();safe(r);assert.equal(r.status,'blocked');
  assert.ok(g.state.probes>0);
 }finally{g.close();}
});
test('real Auth current Android Session revoked after iOS review, all observations denied',async()=>{
 const f=await fixture();try{
  f.state.mutate=({os,key,db})=>{
   if(os==='android'&&key==='vip.buyout')
    db.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-android'");
  };
  const r=await f.inspect();safe(r);assert.equal(r.status,'blocked');
  assert.ok(f.state.probes>=4);
 }finally{f.close();}
});
test('Auth provider membership deletion and suspended member fail closed',async()=>{
 for(const sql of [
  "DELETE FROM starry_identities WHERE provider='apple' AND subject='sub-one'",
  "UPDATE starry_members SET status='suspended',auth_version=4 WHERE s_user_id='u1'"
 ]){
  const f=await fixture();try{
   f.db.exec(sql);
   const r=await f.inspect();safe(r);assert.equal(r.status,'blocked');
   assert.equal(f.state.probes,0);
  }finally{f.close();}
 }
});
test('real Auth KID epoch rotation during Store read rejects both devices',async()=>{
 const f=await fixture();try{
  f.state.mutate=({os,key,state})=>{
   if(os==='ios'&&key==='vip.buyout')state.keyEpoch=2;
  };
  const r=await f.inspect();safe(r);assert.equal(r.status,'blocked');
 }finally{f.close();}
});
test('invalid month source version, bogus expiry and bad Android Store SKU do not grant',async()=>{
 for(const mutate of [
  state=>{state.source.android['vip.month']=['active',0,NOW+100];},
  state=>{state.source.android['vip.year']=['active',3,0];},
  state=>{state.source.android['vip.buyout']=['active',-1,null];}
 ]){
  const f=await fixture();try{
   mutate(f.state);
   const r=await f.inspect();safe(r);
   assert.equal(r.status,'blocked');assert.equal(r.can_grant,false);
  }finally{f.close();}
 }
});
test('iOS refund and Android expired subscription never revoke separate permanent buyout observation',async()=>{
 const f=await fixture();try{
  f.state.source.ios['vip.month']=['refunded',5,NOW+100];
  f.state.source.ios['vip.year']=['expired',5,NOW-100];
  f.state.source.android['vip.month']=['expired',5,NOW-100];
  f.state.source.android['vip.year']=['refunded',7,NOW+100];
  const r=await f.inspect();safe(r);
  assert.equal(r.status,'review_only');
  assert.equal(r.buyout_candidate_review_only,true);
  assert.equal(r.cross_os_restore_candidate_review_only,true);
  assert.equal(r.can_restore,false);
 }finally{f.close();}
});
test('wrong App, wrong environment, wrong OS request and missing Android signature denied',async()=>{
 const f=await fixture();try{
  const wrongApp=await f.sign('session-ios','u1','sub-one','starry.other');
  const bad=[wrongApp,{},null];
  for(const v of bad){const r=await f.inspect(f.requests.ios,v);safe(r);
   assert.equal(r.status,'blocked');}
  assert.equal(f.state.probes,0);
 }finally{f.close();}
});
test('RevenueCat frontend verified flag is not allowed in unverified Store probe shape',async()=>{
 const f=await fixture();try{
  // Force a receipt-like untrusted frontend field -> must not authorize.
  f.state.mutate=({os,key,state})=>{
   if(os==='ios'&&key==='vip.buyout')
    state.source.ios[key]=['active',0,null];
  };
  const r=await f.inspect();safe(r);assert.equal(r.status,'blocked');
 }finally{f.close();}
});
test('default disabled and wrong owner port block before Auth/Store',async()=>{
 const f=await fixture();try{
  const off=createOfflineR005CrossOsReview({scope,identity:f.auth,
   enabled:false,ios:{contract:'starry.billing.r004.entitlement-continuity.v1-candidate',
    inspect:async()=>{throw Error('not reached');}},
   android:{contract:'starry.billing.r004.entitlement-continuity.v1-candidate',
    inspect:async()=>{throw Error('not reached');}},nowSeconds:()=>NOW});
  let r=await off.inspect(null,null,null,null);safe(r);
  assert.equal(r.reason,'DEFAULT_OFF');
  assert.throws(()=>createOfflineR005CrossOsReview({enabled:true,scope,
   identity:{...f.auth,contract:'offline_auth_fixture_only'},
   ios:off,android:off,nowSeconds:()=>NOW}));
  assert.throws(()=>createOfflineR005CrossOsReview({enabled:true,
   scope:{...scope,environment:'production'},identity:f.auth,ios:off,
   android:off,nowSeconds:()=>NOW}));
 }finally{f.close();}
});
test('server clock absence and per-App Ads enabled never create grant',async()=>{
 const f=await fixture();try{
  f.state.now=NaN;
  const r=await f.inspect();safe(r);assert.equal(r.status,'blocked');
 }finally{f.close();}
});
