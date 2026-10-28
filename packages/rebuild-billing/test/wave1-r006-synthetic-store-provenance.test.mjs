import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineR003IdentityAuthorityPort} from '../../../modules/starry-id-v1/src/wave1-round003-identity-authority-port.ts';
import {signServerSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createOfflineR005CrossOsReview,R005_CROSS_OS_CONTRACT} from '../src/wave1-r005-cross-os-signed-auth-review.ts';
import {createOfflineR006SignedStoreBoundary,r006SyntheticFixtureBytes,
 R006_STORE_BOUNDARY,R006_STORE_LIVE,R006_P05_DEPENDENCY,R006_P05_PURPOSE,
 R006_P05_SIGNATURE_DOMAIN} from '../src/wave1-r006-synthetic-store-provenance.ts';
const NOW=1793000000,AUTH='starry.auth.identity-authority.r003.v1-candidate';
const scope=Object.freeze({brand_id:'starry',app_id:'starry.one',environment:'staging'});
const origin='https://id.starry.example';
const sku={product_key:'vip.buyout',kind:'NON_CONSUMABLE',period:null,
 ios_sku:'vip.ios.buyout',android_sku:'vip.android.buyout'};
const month={product_key:'vip.month',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH',
 ios_sku:'vip.ios.month',android_sku:'vip.android.month'};
const year={product_key:'vip.year',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'YEAR',
 ios_sku:'vip.ios.year',android_sku:'vip.android.year'};
const catalog=[sku,month,year];
const fields=['version','source','brand_id','app_id','environment','platform','event_id',
 'webhook_id','product_key','store_sku','kind','period','transaction_id',
 'original_transaction_id','member_digest','event_type','source_version',
 'issued_at','expires_at','kid'];
async function setup(){
 const state={probes:0,reads:0,clock:NOW,epoch:1,rotateAfter:0,
  verifierReads:0,storeOnline:true,authOnline:true};
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 function person(uid,subject,sessions){
  db.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(uid,'active',3,1,null,0,0,NOW,NOW);
  db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .run('apple',subject,uid);
  for(let ix=0;ix<sessions.length;ix++){
   const sid=sessions[ix];
   db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(sid,uid,scope.app_id,scope.environment,3,uid+sid+'x'.repeat(64-uid.length-sid.length),NOW+300,null,null,null);
  }
 }
 person('user-one','sub-one',['session-ios','session-android']);
 person('user-two','sub-two',['session-other']);
 const authDb={prepare(sql){assert.match(sql,/^SELECT /);return {bind(...args){
  return {first:async()=>{
   state.reads++;
   if(!state.authOnline)throw Error('synthetic current auth outage');
   return db.prepare(sql).get(...args)??null;
  }};
 }};}};
 const authKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const digestKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const auth=createOfflineR003IdentityAuthorityPort({enabled:true,serverScope:scope,
  expectedOrigin:origin,authDb,
  getVerificationKey:async kid=>kid==='session-kid'?authKey:null,
  readActiveDigestKey:async()=>({kid:'auth-digest-v1',epoch:1,key:digestKey})});
 const intents={ios:Object.freeze({...scope,flow_ref:'I'.repeat(48)}),
  android:Object.freeze({...scope,flow_ref:'A'.repeat(48)})};
 const sign=async(session,user='user-one',sub='sub-one',app=scope.app_id)=>{
  const token=await signServerSession({brand_id:'starry',app_id:app,
   environment:scope.environment,provider:'apple',provider_subject:sub,
   s_user_id:user,session_id:session,auth_version:3,issued_at:NOW,
   expires_at:NOW+300,key_id:'session-kid'},
   {...scope,app_id:app},NOW,{kid:'session-kid',key:authKey});
  return new Request(origin+'/private',{method:'POST',
   headers:{authorization:'Bearer '+token}});
 };
 const requests={ios:await sign('session-ios'),android:await sign('session-android')};
 const authView=await auth.reviewFresh(requests.ios,intents.ios,NOW);
 assert.equal(authView.status,'review_only','real AI-1 R003 signed Auth required');
 const proof=auth.readServerReview(authView,intents.ios,NOW);
 assert.equal(proof?.kind,'signed_auth_d1_review_only');
 const memberDigest=proof.member_digest;
 function r004(os){
  return {contract:'starry.billing.r004.entitlement-continuity.v1-candidate',
   async inspect(){
    state.probes++;
    return Object.freeze({contract:this.contract,status:'review_only',
     reason:'AUTH_CONTINUITY_REVIEW_ONLY_NO_STORE_GRANT',
     app_id:scope.app_id,platform:os,mode:'buyout',
     permanent_candidate:'unverified_active',subscription_candidate:'none',
     candidates:[{product_key:sku.product_key,kind:sku.kind,period:null,
      state:'unverified_active',features:['ads_free']}],
     ads_removal_candidate_review_only:true,
     adsProviderSelection:'google-admob-mediation',adsEnabled:false,
     adsSdkInitialized:false,adRequestsEnabled:false,
     actual_identity_provider_integrated:false,official_store_verified:false,
     official_revenuecat_verified:false,can_start_purchase:false,can_restore:false,
     can_grant:false,can_regrant:false,can_remove_ads:false,
     can_request_ads:false,can_ack_webhook:false,can_publish:false,live:false});
   }
  };
 }
 const crossOs=createOfflineR005CrossOsReview({enabled:true,scope,identity:auth,
  ios:r004('ios'),android:r004('android'),nowSeconds:()=>state.clock});
 // Each provider gets its own ephemeral, synthetic sign and verify key. Verify-only
 // server lease cannot sign events; no official Apple/Google/RevenueCat key used.
 const keys=new Map();
 for(const [provider,n] of [['apple_sandbox_fixture',11],
  ['google_sandbox_fixture',23],['revenuecat_webhook_fixture',37]]){
  const raw=new Uint8Array(32).fill(n);
  keys.set(provider,{
   signer:await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']),
   verifier:await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['verify'])
  });
 }
 const reviewer=createOfflineR006SignedStoreBoundary({enabled:true,scope,identity:auth,
  crossOs,skuCatalog:catalog,nowSeconds:()=>state.clock,
  readSyntheticFixtureVerificationKey:async(src,kid)=>{
   state.verifierReads++;
   if(!state.storeOnline)return null;
   const k=keys.get(src);
   if(kid!=='store-kid-v1'||!k)return null;
   if(state.rotateAfter&&state.verifierReads>=state.rotateAfter)state.epoch=2;
   return {kid:'store-kid-v1',epoch:state.epoch,key:k.verifier};
  }});
 const payload=(change={})=>{
  const p={version:'starry.billing.r006.synthetic-event.v1',source:'apple_sandbox_fixture',
   brand_id:'starry',app_id:scope.app_id,environment:'staging',platform:'ios',
   event_id:'event-001',webhook_id:'hook-001',product_key:sku.product_key,
   store_sku:sku.ios_sku,kind:sku.kind,period:sku.period,
   transaction_id:'txn-001',original_transaction_id:'original-001',
   member_digest:memberDigest,event_type:'purchase',source_version:1,
   issued_at:NOW,expires_at:NOW+90,kid:'store-kid-v1',...change};
  return Object.fromEntries(fields.map(k=>[k,p[k]]));
 };
 const signPayload=async(p,otherSource=null)=>{
  const bytes=r006SyntheticFixtureBytes(p);
  assert.ok(bytes,'exact 20-key synthetic payload only');
  const source=otherSource??p.source;
  const signature=await crypto.subtle.sign('HMAC',keys.get(source).signer,bytes);
  const mac_hex=Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('');
  return {payload:p,mac_hex};
 };
 const inspect=async(w,ios=requests.ios,android=requests.android)=>reviewer.inspect(
  ios,intents.ios,android,intents.android,w);
 const close=()=>db.close();
 return {db,state,auth,requests,intents,payload,signPayload,inspect,reviewer,sign,close,keys};
}
function safe(r){
 assert.equal(r.contract,R006_STORE_BOUNDARY);
 assert.equal(r.p05_dependency,R006_P05_DEPENDENCY);
 assert.equal(r.adsProviderSelection,'google-admob-mediation');
 for(const key of ['official_apple_verified','official_google_verified',
  'official_revenuecat_verified','revenuecat_app_user_id_approved',
  'durable_cas_verified','independent_anti_pitr_verified',
  'adsEnabled','adsSdkInitialized','adRequestsEnabled',
  'can_purchase','can_restore','can_grant','can_regrant','can_remove_ads',
  'can_request_ads','can_ack_webhook','can_send_p05','can_publish','live'])
 assert.equal(r[key],false,key);
 const serialized=JSON.stringify(r);
 for(const secret of ['member_digest','session_binding','auth_version',
  'session-ios','user-one','refresh_hash','transaction_id','webhook_id',
  'original_transaction_id','Bearer'])assert.equal(serialized.includes(secret),false,secret);
}
test('R006 versioned AI-2 boundary pins AI-0 canonical vNext P05 but never signs P05',()=>{
 assert.equal(R006_STORE_LIVE,false);
 assert.equal(R006_P05_DEPENDENCY,'starry.p05.canonical.vnext.offline-candidate');
 assert.equal(R006_P05_PURPOSE,'p05_delivery_review_only');
 assert.equal(R006_P05_SIGNATURE_DOMAIN,'starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1');
});
test('actual AI-1 signed Auth with R005 real cross-OS source and synthetic Apple event remains deny-only',async()=>{
 const f=await setup();try{
  const result=await f.inspect(await f.signPayload(f.payload()));
  safe(result);assert.equal(result.status,'review_only');
  assert.equal(result.state_candidate,'unverified_active');
  assert.equal(result.cross_os_content_candidate_review_only,true);
  assert.equal(result.ads_removal_candidate_review_only,true);
  assert.equal(result.synthetic_signature_review_only,true);
  assert.ok(f.state.reads>0);assert.ok(f.state.probes>0);
 }finally{f.close();}
});
test('synthetic Google and RevenueCat separate OS events never grant paid entitlements',async()=>{
 const f=await setup();try{
  for(const [src,os,i] of [['google_sandbox_fixture','android',10],
   ['revenuecat_webhook_fixture','ios',20]]){
   const p=f.payload({source:src,platform:os,event_id:'event-'+i,
    webhook_id:'hook-'+i,transaction_id:'txn-'+i,original_transaction_id:'original-'+i,
    store_sku:os==='ios'?sku.ios_sku:sku.android_sku});
   const r=await f.inspect(await f.signPayload(p));
   safe(r);assert.equal(r.status,'review_only');assert.equal(r.can_grant,false);
  }
 }finally{f.close();}
});
test('forged MAC, wrong source signer and KID swap fail BEFORE auth+Store reads',async()=>{
 const f=await setup();try{
  const p=f.payload();
  for(const w of [
   {payload:p,mac_hex:'0'.repeat(64)},
   await f.signPayload(p,'google_sandbox_fixture'),
   await f.signPayload(f.payload({kid:'evil-kid'}))
  ]){
   const r=await f.inspect(w);safe(r);assert.equal(r.status,'blocked');
  }
  assert.equal(f.state.probes,0);
 }finally{f.close();}
});
test('synthetic source key epoch rotation before and after Auth fails closed',async()=>{
 for(const threshold of [2,3]){
  const f=await setup();try{
   f.state.rotateAfter=threshold;
   const r=await f.inspect(await f.signPayload(f.payload()));
   safe(r);assert.equal(r.status,'blocked');assert.equal(r.can_restore,false);
  }finally{f.close();}
 }
});
test('malicious getters, unknown data, old P05 envelope and fake frontend verified flags rejected',async()=>{
 const f=await setup();try{
  const p=f.payload();
  const w=await f.signPayload(p);
  for(const bad of [
   {...w,verified:true},
   {event:p,signature_hex:w.mac_hex},
   {envelope:p,mac:w.mac_hex},
   {payload:{...p,verified:true},mac_hex:w.mac_hex},
   {payload:{...p,event_id:'event-evil',extra:1},mac_hex:w.mac_hex},
   {payload:Object.defineProperty({...p},'event_id',{get(){throw Error('getter');}}),mac_hex:w.mac_hex}
  ]){
   const r=await f.inspect(bad);safe(r);assert.equal(r.status,'blocked');
  }
  assert.equal(f.state.probes,0);
 }finally{f.close();}
});
test('cross-App SKU and product, environment and brand cannot be promoted to paid claims',async()=>{
 const f=await setup();try{
  for(const delta of [
   {app_id:'starry.two'}, {store_sku:'vip.other.buyout'},
   {product_key:'vip.foreign'}, {environment:'production'},
   {brand_id:'hglobal'}, {product_key:'battery.topup'}, {source:'google_sandbox_fixture'}
  ]){
   const p=f.payload(delta);
   const w=await f.signPayload(p);
   const r=await f.inspect(w);safe(r);assert.equal(r.status,'blocked');
  }
 }finally{f.close();}
});
test('webhook replay even with freshly signed matching payload blocks second review',async()=>{
 const f=await setup();try{
  const w=await f.signPayload(f.payload());
  const first=await f.inspect(w);safe(first);assert.equal(first.status,'review_only');
  const again=await f.inspect(w);safe(again);assert.equal(again.status,'blocked');
  assert.equal(again.reason,'WEBHOOK_REPLAY_BLOCKED');
 }finally{f.close();}
});
test('rollback source version and conflicting equal version reject, higher version refund still no grant',async()=>{
 const f=await setup();try{
  let p=f.payload();
  assert.equal((await f.inspect(await f.signPayload(p))).status,'review_only');
  for(const [suffix,version] of [['002',1],['003',0]]){
   p=f.payload({event_id:'event-'+suffix,webhook_id:'hook-'+suffix,
    transaction_id:'txn-'+suffix,source_version:version});
   const r=await f.inspect(await f.signPayload(p));safe(r);
   assert.equal(r.status,'blocked');
  }
  p=f.payload({event_id:'event-004',webhook_id:'hook-004',
   transaction_id:'txn-004',event_type:'refund',source_version:2});
  const r=await f.inspect(await f.signPayload(p));safe(r);
  assert.equal(r.status,'review_only');assert.equal(r.state_candidate,'revoked');
  p=f.payload({event_id:'event-005',webhook_id:'hook-005',transaction_id:'txn-005',
   event_type:'restore',source_version:3});
  const restore=await f.inspect(await f.signPayload(p));safe(restore);
  assert.equal(restore.status,'blocked');assert.equal(restore.can_restore,false);
 }finally{f.close();}
});
test('cross-OS transfer of the same original Store transaction is always rejected',async()=>{
 const f=await setup();try{
  assert.equal((await f.inspect(await f.signPayload(f.payload()))).status,'review_only');
  const android=f.payload({source:'google_sandbox_fixture',platform:'android',
   store_sku:sku.android_sku,event_id:'event-cross',webhook_id:'hook-cross',
   transaction_id:'txn-cross'});
  const r=await f.inspect(await f.signPayload(android));safe(r);
  assert.equal(r.status,'blocked');
  assert.equal(r.reason,'CROSS_OS_OR_MEMBER_TRANSACTION_TRANSFER');
 }finally{f.close();}
});
test('monthly yearly expiry/grace/refund/revoke states observed but never authorize live rights',async()=>{
 const cases=[
  [month,'renewal','unverified_active'],[year,'grace','expired'],
  [month,'refund','revoked'],[year,'expire','expired'],[sku,'revoke','revoked']
 ];
 for(let i=0;i<cases.length;i++){
  const f=await setup();try{
   const [product,event_type,expected]=cases[i];
   const p=f.payload({product_key:product.product_key,store_sku:product.ios_sku,
    kind:product.kind,period:product.period,event_type});
   const r=await f.inspect(await f.signPayload(p));safe(r);
   assert.equal(r.status,'review_only');
   assert.equal(r.state_candidate,expected);
  }finally{f.close();}
 }
});
test('current signed Auth session revoked late during Store validation blocks whole event',async()=>{
 const f=await setup();try{
  const invalid=await f.sign('session-other','user-two','sub-two');
  const r=await f.inspect(await f.signPayload(f.payload()),invalid,f.requests.android);
  safe(r);assert.equal(r.status,'blocked');assert.equal(r.can_grant,false);
 }finally{f.close();}
 const g=await setup();try{
  g.db.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-ios'");
  const r=await g.inspect(await g.signPayload(g.payload()));safe(r);
  assert.equal(r.status,'blocked');
 }finally{g.close();}
});
test('provider outage or clock errors never consume replay slot',async()=>{
 const f=await setup();try{
  const w=await f.signPayload(f.payload());
  f.state.storeOnline=false;
  let r=await f.inspect(w);safe(r);assert.equal(r.status,'blocked');
  f.state.storeOnline=true;
  r=await f.inspect(w);safe(r);assert.equal(r.status,'review_only');
 }finally{f.close();}
 const g=await setup();try{
  g.state.clock=NaN;
  const r=await g.inspect(await g.signPayload(g.payload()));
  safe(r);assert.equal(r.status,'blocked');
 }finally{g.close();}
});
test('default disabled and wrong Auth contract/production scope reject',async()=>{
 const f=await setup();try{
  const off=createOfflineR006SignedStoreBoundary({enabled:false,scope,identity:f.auth,
   crossOs:{contract:R005_CROSS_OS_CONTRACT,inspect:async()=>{throw Error('not called');}},
   skuCatalog:catalog,nowSeconds:()=>NOW,
   readSyntheticFixtureVerificationKey:async()=>{throw Error('not called');}});
  const r=await off.inspect(null,null,null,null,null);safe(r);
  assert.equal(r.reason,'DEFAULT_DISABLED');
  assert.throws(()=>createOfflineR006SignedStoreBoundary({enabled:true,
   scope:{...scope,environment:'production'},identity:f.auth,crossOs:off,
   skuCatalog:catalog,nowSeconds:()=>NOW,readSyntheticFixtureVerificationKey:async()=>null}));
  assert.throws(()=>createOfflineR006SignedStoreBoundary({enabled:true,
   scope,identity:{...f.auth,contract:'offline_auth_fixture_only'},crossOs:off,
   skuCatalog:catalog,nowSeconds:()=>NOW,readSyntheticFixtureVerificationKey:async()=>null}));
 }finally{f.close();}
});
