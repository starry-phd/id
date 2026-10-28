import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineR004EntitlementReview,R004_BILLING_CONTINUITY,R004_BILLING_LIVE}
 from '../src/wave1-r004-entitlement-continuity-review.ts';
import {createOfflineR003BillingStoreReview}
 from '../src/wave1-r003-canonical-identity-store-review.ts';
const NOW=1793000000;
const scope=Object.freeze({brand_id:'starry',app_id:'starry.one',environment:'staging'});
const intent=Object.freeze({...scope,flow_ref:'r4_'+'A'.repeat(45)});
const AUTH='starry.auth.identity-authority.r003.v1-candidate';
const A='m_'+'a'.repeat(64),B='m_'+'b'.repeat(64);
const S='s_'+'c'.repeat(64),T='s_'+'d'.repeat(64);
const products=[
 {product_key:'vip.buyout',kind:'NON_CONSUMABLE',period:null,
  features:['permanent_content','ads_free'],sku_ios:'vip.ios.buyout',sku_android:'vip.android.buyout'},
 {product_key:'vip.month',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH',
  features:['cloud_sync'],sku_ios:'vip.ios.month',sku_android:'vip.android.month'},
 {product_key:'vip.year',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'YEAR',
  features:['cloud_sync','premium_layout'],sku_ios:'vip.ios.year',sku_android:'vip.android.year'}
];
const cfg={app_id:scope.app_id,mode:'both',products:products.map(({sku_ios,sku_android,...rest})=>rest),
 adsProviderSelection:'google-admob-mediation',adsEnabled:false,
 adsSdkInitialized:false,adRequestsEnabled:false};
function makeFixture(){
 const state={member:A,session:S,kid:'kid-v1',epoch:1,version:3,revoked:false,
  clock:NOW,providerDown:false,storeDown:false,flipOn:null,authReads:0,storeReads:0,
  reviews:0,onReviewer:null,rows:{
   'vip.buyout':{status:'active',version:2,expiry:null},
   'vip.month':{status:'expired',version:5,expiry:NOW-1},
   'vip.year':{status:'active',version:3,expiry:NOW+1800}
  }};
 const records=new WeakMap(),consumed=new WeakSet();
 const publicView=(status)=>Object.freeze({contract:AUTH,status,reason:'OFFLINE_AUTH_ONLY',
  flow_ref:intent.flow_ref,verified_live:false,may_open_store:false,
  may_purchase:false,may_restore:false,may_grant:false,may_charge:false,
  may_ack_webhook:false});
 const identity={contract:AUTH,
  async reviewFresh(req,i,now,previous){
   state.authReads++;
   if(state.providerDown)throw Error('Auth D1 offline');
   if(req!=='signed-placeholder'||i?.brand_id!==scope.brand_id||
    i?.app_id!==scope.app_id||i?.environment!==scope.environment||
    i?.flow_ref!==intent.flow_ref||state.revoked)return publicView('blocked');
   if(previous){const old=records.get(previous);
    if(!old||old.member_digest!==state.member||old.session_binding!==state.session||
     old.digest_kid!==state.kid||old.digest_epoch!==state.epoch||
     old.auth_version!==state.version)return publicView('blocked');
   }
   const view=publicView('review_only');
   records.set(view,Object.freeze({kind:'signed_auth_d1_review_only',contract:AUTH,
    brand_id:'starry',app_id:scope.app_id,environment:scope.environment,
    purpose:'billing_identity_review',digest_format:'ai1.r002.json-hmac.v1',
    member_digest:state.member,session_binding:state.session,
    digest_kid:state.kid,digest_epoch:state.epoch,
    auth_version:state.version,checked_at:now,expires_at:NOW+200,
    session_state:'active',verified_live:false,billing_authorized:false}));
   return view;
  },
  readServerReview(view){
   if(consumed.has(view))return null;
   consumed.add(view);return records.get(view)||null;
  }
 };
 const create=(options={})=>createOfflineR004EntitlementReview({enabled:true,scope,
  identity,plan:cfg,nowSeconds:()=>state.clock,
  reviewerForProduct(key){
   state.reviews++;
   if(state.onReviewer)state.onReviewer(key);
   const item=products.find(x=>x.product_key===key);
   return createOfflineR003BillingStoreReview({enabled:true,scope,identity,
    nowSeconds:()=>state.clock,products:[((({features,...sku})=>sku)(item))],
    readUnverifiedStoreProbe:async()=>{
     state.storeReads++;
     if(state.storeDown)throw Error('Store fixture unavailable');
     if(state.flipOn===key){state.member=B;state.session=T;}
     const r=state.rows[key];
     return {source:'revenuecat_unverified_fixture',brand_id:'starry',
      app_id:scope.app_id,environment:scope.environment,
      member_digest:state.member,platform:state.platform||'ios',
      product_key:key,store_sku:state.platform==='android'?item.sku_android:item.sku_ios,
      source_version:r.version,status:r.status,expires_at_sec:r.expiry};
    }
   });
  },...options});
 const review=async(os='ios',options={})=>{
  state.platform=os;return create(options).inspect('signed-placeholder',intent,os);
 };
 return {state,identity,create,review};
}
function safe(r){
 assert.equal(r.contract,R004_BILLING_CONTINUITY);
 for(const key of ['actual_identity_provider_integrated','official_store_verified',
 'official_revenuecat_verified','can_start_purchase','can_restore','can_grant',
 'can_regrant','can_remove_ads','can_request_ads','can_ack_webhook','can_publish',
 'live','adsEnabled','adsSdkInitialized','adRequestsEnabled'])
  assert.equal(r[key],false,key);
 assert.equal(r.adsProviderSelection,'google-admob-mediation');
 const json=JSON.stringify(r);
 for(const val of [A,B,S,T,'member_digest','session_binding','refresh_hash',
  'authorization','Bearer','receipt','session_id'])assert.equal(json.includes(val),false,val);
}
test('R004 default disabled never reads Auth, Store or AdMob',async()=>{
 const f=makeFixture();assert.equal(R004_BILLING_LIVE,false);
 const r=await f.review('ios',{enabled:false});safe(r);
 assert.equal(r.status,'blocked');assert.equal(f.state.authReads,0);
 assert.equal(f.state.storeReads,0);
});
test('real AI-2 R003 inspectors for buyout/month/year never grant',async()=>{
 const f=makeFixture();const r=await f.review();safe(r);
 assert.equal(r.status,'review_only');assert.equal(r.candidates.length,3);
 assert.equal(r.permanent_candidate,'unverified_active');
 assert.equal(r.subscription_candidate,'unverified_active');
 assert.equal(r.ads_removal_candidate_review_only,true);
 assert.equal(f.state.reviews,3);assert.equal(f.state.storeReads,3);
 assert.equal(f.state.authReads,13);
});
test('iOS and Android distinct SKU sources, never transferable Store orders',async()=>{
 const f=makeFixture();for(const os of ['ios','android']){
  const r=await f.review(os);safe(r);
  assert.equal(r.platform,os);assert.equal(r.status,'review_only');
 }
});
test('guest/client login, H-Global, wrong app/env/flow denied pre-Store',async()=>{
 const f=makeFixture();const gate=f.create();
 for(const [req,i] of [[{},intent],[null,intent],['signed-placeholder',{
  ...intent,brand_id:'hglobal'}],['signed-placeholder',{...intent,app_id:'starry.two'}],
  ['signed-placeholder',{...intent,environment:'production'}],
  ['signed-placeholder',{...intent,flow_ref:'wrong'}]]){
  const r=await gate.inspect(req,i,'ios');safe(r);assert.equal(r.status,'blocked');
 }
 assert.equal(f.state.storeReads,0);
});
test('revoke/member switch/session/KID/epoch/version changes between products deny entire matrix',async()=>{
 for(const flip of [s=>s.revoked=true,s=>s.member=B,s=>s.session=T,
  s=>s.kid='kid-v2',s=>s.epoch=2,s=>s.version=4]){
  const f=makeFixture();f.state.onReviewer=k=>{if(k==='vip.month')flip(f.state);};
  const r=await f.review();safe(r);assert.equal(r.status,'blocked');
  assert.equal(r.candidates.length,0);
 }
});
test('member switch DURING Store candidate fetch is denied',async()=>{
 const f=makeFixture();f.state.flipOn='vip.year';
 const r=await f.review();safe(r);assert.equal(r.status,'blocked');
 assert.equal(r.candidates.length,0);
});
test('Auth key and Store probe outages deny full review',async()=>{
 const a=makeFixture();a.state.providerDown=true;
 let r=await a.review();safe(r);assert.equal(r.status,'blocked');
 const b=makeFixture();b.state.storeDown=true;
 r=await b.review();safe(r);assert.equal(r.status,'blocked');
});
test('month expiry and year refund cannot cancel separate buyout observation',async()=>{
 const f=makeFixture();f.state.rows['vip.year'].status='refunded';
 let r=await f.review();safe(r);assert.equal(r.status,'review_only');
 assert.equal(r.permanent_candidate,'unverified_active');
 assert.equal(r.subscription_candidate,'revoked');
 f.state.rows['vip.year'].status='expired';
 r=await f.review();safe(r);assert.equal(r.subscription_candidate,'expired');
 assert.equal(r.permanent_candidate,'unverified_active');
});
test('Q4=A AdMob provider chosen, Ads OFF even if ads_free feature candidate',async()=>{
 const f=makeFixture();const r=await f.review();safe(r);
 assert.equal(r.ads_removal_candidate_review_only,true);
 assert.equal(r.can_remove_ads,false);assert.equal(r.can_request_ads,false);
});
test('App without ads_free feature cannot infer any ads-removal candidate',async()=>{
 const f=makeFixture();const p={...cfg,products:cfg.products.map(x=>({...x,
  features:x.features.filter(v=>v!=='ads_free')}))};
 const r=await f.review('ios',{plan:p});safe(r);
 assert.equal(r.ads_removal_candidate_review_only,false);
});
test('forged foreign R003 review cannot be promoted',async()=>{
 const f=makeFixture();const malformed={contract:'starry.billing.r003.auth-store-fence.v1-candidate',
  status:'review_only',app_id:'starry.two',product_key:'vip.buyout',platform:'ios',
  candidate_state:'unverified_active',auth_reread_count:3,
  official_store_verified:false,official_revenuecat_verified:false,
  approved_identity_mapping:false,cross_store_transaction_transfer:false,
  can_start_purchase:false,can_restore:false,can_grant:false,
  can_remove_ads:false,can_ack_webhook:false,can_publish:false,live:false};
 const r=await f.review('ios',{reviewerForProduct:key=>({
  contract:'starry.billing.r003.auth-store-fence.v1-candidate',
  inspect:async()=>malformed})});safe(r);
 assert.equal(r.status,'blocked');assert.equal(r.candidates.length,0);
});
test('wrong Auth contract, production, unsupported model and Ads on refused',()=>{
 const f=makeFixture();
 assert.throws(()=>f.create({identity:{...f.identity,contract:'offline_auth_fixture_only'}}));
 assert.throws(()=>f.create({scope:{...scope,environment:'production'}}));
 assert.throws(()=>f.create({scope:{...scope,brand_id:'hglobal'}}));
 assert.throws(()=>f.create({plan:{...cfg,mode:'buyout'}}));
 assert.throws(()=>f.create({plan:{...cfg,products:[...cfg.products,cfg.products[0]]}}));
 assert.throws(()=>f.create({plan:{...cfg,products:[{
  product_key:'battery.topup',kind:'NON_CONSUMABLE',period:null,features:['money']} ]}}));
 assert.throws(()=>f.create({plan:{...cfg,adsEnabled:true}}));
 assert.throws(()=>f.create({plan:{...cfg,adsProviderSelection:'unapproved-mediation'}}));
});
test('buyout-only and subscription-only App modes remain independent',async()=>{
 const b=makeFixture();const buy={...cfg,mode:'buyout',products:[cfg.products[0]]};
 let r=await b.review('ios',{plan:buy});safe(r);
 assert.equal(r.status,'review_only');assert.equal(r.candidates.length,1);
 const s=makeFixture();const sub={...cfg,mode:'subscription',products:[cfg.products[1],cfg.products[2]]};
 r=await s.review('ios',{plan:sub});safe(r);
 assert.equal(r.status,'review_only');assert.equal(r.candidates.length,2);
});
test('invalid platform and clock deny without Store',async()=>{
 const f=makeFixture();let r=await f.review('web');safe(r);
 assert.equal(r.status,'blocked');assert.equal(f.state.storeReads,0);
 f.state.clock=NaN;r=await f.review('ios');safe(r);assert.equal(r.status,'blocked');
});
// AI-0 must first import exact AI-1 #198 original blob. Until then skipped,
// not PASSED. No copying/merging a sibling Owner file into AI-2 PR.
const realAI1=new URL('../../../modules/starry-id-v1/src/wave1-round003-identity-authority-port.ts',import.meta.url);
test('REAL AI-1 #198 signed Session+CURRENT SQLite -> AI-2 R003/R004 interop',
 {skip:!existsSync(realAI1)&&'BLOCKED: AI-0 R003 cross-owner original-blob integration not done'},
 async()=>{
  const [{createOfflineR003IdentityAuthorityPort},{signServerSession}]=await Promise.all([
   import(realAI1.href),import(new URL('../../../modules/starry-id-v1/src/session-crypto.ts',import.meta.url).href)]);
  const db=new DatabaseSync(':memory:');
  try{
   db.exec('PRAGMA foreign_keys=ON');
   db.exec(readFileSync(new URL('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
   db.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('u1','active',3,1,null,0,0,NOW,NOW);
   db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
    .run('apple','sub-one','u1');
   db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('session-one','u1',scope.app_id,scope.environment,3,'a'.repeat(64),NOW+300,null,null,null);
   const authDb={prepare(sql){assert.match(sql,/^SELECT /);return {bind(...args){
    return {first:async()=>db.prepare(sql).get(...args)??null};
   }};}};
   const sessionKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
   const digestKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
   const origin='https://id.starry.example';
   const auth=createOfflineR003IdentityAuthorityPort({enabled:true,serverScope:scope,
    expectedOrigin:origin,authDb,
    getVerificationKey:async kid=>kid==='session-kid'?sessionKey:null,
    readActiveDigestKey:async()=>({kid:'digest-v1',epoch:1,key:digestKey})});
   const token=await signServerSession({brand_id:'starry',app_id:scope.app_id,
    environment:scope.environment,provider:'apple',provider_subject:'sub-one',
    s_user_id:'u1',session_id:'session-one',auth_version:3,expires_at:NOW+300,
    issued_at:NOW,key_id:'session-kid'},scope,NOW,{kid:'session-kid',key:sessionKey});
   const request=new Request(origin+'/private',{method:'POST',
    headers:{authorization:'Bearer '+token}});
   const authView=await auth.reviewFresh(request,intent,NOW);
   assert.equal(authView.status,'review_only');
   const proof=auth.readServerReview(authView,intent,NOW);
   assert.equal(proof.kind,'signed_auth_d1_review_only');
   assert.equal(proof.billing_authorized,false);
   const item=products[0];
   const reviewer=createOfflineR003BillingStoreReview({enabled:true,scope,identity:auth,
    nowSeconds:()=>NOW,products:[((({features,...sku})=>sku)(item))],
    readUnverifiedStoreProbe:async()=>({source:'revenuecat_unverified_fixture',
     brand_id:'starry',app_id:scope.app_id,environment:'staging',member_digest:proof.member_digest,
     platform:'ios',product_key:item.product_key,store_sku:item.sku_ios,
     source_version:1,status:'active',expires_at_sec:null})});
   const plan={...cfg,mode:'buyout',products:[cfg.products[0]]};
   const port=createOfflineR004EntitlementReview({enabled:true,scope,identity:auth,
    plan,nowSeconds:()=>NOW,reviewerForProduct:()=>reviewer});
   const observed=await port.inspect(request,intent,'ios');safe(observed);
   assert.equal(observed.status,'review_only'); // authentic Auth, UNVERIFIED Store, NO grant
   db.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-one'");
   const revoked=await port.inspect(request,intent,'ios');safe(revoked);
   assert.equal(revoked.status,'blocked');
  }finally{db.close();}
 });
