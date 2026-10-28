import test from 'node:test';
import assert from 'node:assert/strict';
import {AI2_R003_CONTRACT,AI2_R003_LIVE,AI1_R003_CONTRACT,
 createOfflineR003BillingStoreReview} from '../src/wave1-r003-canonical-identity-store-review.ts';

const NOW=1793000000;
const scope=Object.freeze({brand_id:'starry',app_id:'starry.one',environment:'staging'});
const intent=Object.freeze({...scope,flow_ref:'r3_'+'A'.repeat(48)});
const products=[
 {product_key:'pro.buyout',kind:'NON_CONSUMABLE',period:null,
  sku_ios:'one.ios.buyout',sku_android:'one.android.buyout'},
 {product_key:'pro.month',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH',
  sku_ios:'one.ios.month',sku_android:'one.android.month'},
 {product_key:'pro.year',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'YEAR',
  sku_ios:'one.ios.year',sku_android:'one.android.year'}
];
const DIGEST1='m_'+'a'.repeat(64),DIGEST2='m_'+'b'.repeat(64);
const SESSION1='s_'+'c'.repeat(64),SESSION2='s_'+'d'.repeat(64);
function fixture(){
 const state={member:DIGEST1,session:SESSION1,kid:'digest-v1',epoch:1,
  authVersion:3,revoked:false,sourceVersion:2,platform:'ios',key:'pro.month',
  status:'active',expiry:NOW+3600,readCount:0,authReads:0,clock:NOW,
  failStore:false,onStore:null,forceInvalidProof:false,forceUiGrant:false};
 const proofs=new WeakMap(),consumed=new WeakSet();
 const publicView=(reason,status='blocked')=>Object.freeze({contract:AI1_R003_CONTRACT,
  status,reason,flow_ref:intent.flow_ref,verified_live:false,may_open_store:false,
  may_purchase:false,may_restore:false,may_grant:false,may_charge:false,
  may_ack_webhook:false});
 const identity={contract:AI1_R003_CONTRACT,
  async reviewFresh(request,rawIntent,now,previous){
   state.authReads++;
   if(request!=='signed-request'||state.revoked||rawIntent?.brand_id!==scope.brand_id
    ||rawIntent?.app_id!==scope.app_id||rawIntent?.environment!==scope.environment
    ||rawIntent?.flow_ref!==intent.flow_ref)
    return publicView('SIGNED_AUTH_REQUIRED');
   if(previous){
    const prior=proofs.get(previous);
    if(!prior||prior.member_digest!==state.member||prior.session_binding!==state.session
     ||prior.digest_kid!==state.kid||prior.digest_epoch!==state.epoch)
     return publicView('AUTH_CHANGED');
   }
   const view=publicView('AUTH_REVIEW_NOT_STORE_PERMISSION','review_only');
   proofs.set(view,Object.freeze({kind:'signed_auth_d1_review_only',
    contract:AI1_R003_CONTRACT,brand_id:scope.brand_id,app_id:scope.app_id,
    environment:scope.environment,purpose:'billing_identity_review',
    digest_format:'ai1.r002.json-hmac.v1',member_digest:state.member,
    session_binding:state.session,digest_kid:state.kid,digest_epoch:state.epoch,
    auth_version:state.authVersion,checked_at:now,expires_at:NOW+300,
    session_state:'active',verified_live:false,billing_authorized:false}));
   return view;
  },
  readServerReview(view){
   if(consumed.has(view))return null;
   consumed.add(view);
   const p=proofs.get(view)||null;
   return p&&state.forceInvalidProof?{...p,verified_live:true}:p;
  }
 };
 const make=(override={})=>createOfflineR003BillingStoreReview({
  enabled:true,scope,identity,products,
  nowSeconds:()=>state.clock,
  readUnverifiedStoreProbe:async()=>{
   state.readCount++;
   if(state.failStore)throw Error('Store fixture outage');
   if(state.onStore)state.onStore();
   const p=products.find(p=>p.product_key===state.key);
   return {source:'revenuecat_unverified_fixture',brand_id:'starry',
    app_id:scope.app_id,environment:scope.environment,
    member_digest:state.member,platform:state.platform,
    product_key:state.key,
    store_sku:state.platform==='ios'?p.sku_ios:p.sku_android,
    source_version:state.sourceVersion,status:state.status,
    expires_at_sec:state.key==='pro.buyout'?null:state.expiry};
  },...override
 });
 const review=async(key=state.key,platform=state.platform,request='signed-request',i=intent,
  client=make())=>client.inspect(request,i,key,platform);
 return {state,identity,make,review};
}
function denyFlags(r){
 assert.equal(r.contract,AI2_R003_CONTRACT);
 for(const f of ['official_store_verified','official_revenuecat_verified',
 'approved_identity_mapping','cross_store_transaction_transfer','can_start_purchase',
 'can_restore','can_grant','can_remove_ads','can_ack_webhook','can_publish','live'])
  assert.equal(r[f],false,f);
 const json=JSON.stringify(r);
 for(const secret of [DIGEST1,DIGEST2,SESSION1,SESSION2,'member_digest',
  'session_binding','digest_kid','Bearer','user_id','receipt'])
  assert.equal(json.includes(secret),false,secret);
}
test('R003 is NEVER live; default off makes no Auth/Store calls',async()=>{
 const x=fixture();assert.equal(AI2_R003_LIVE,false);
 const r=await x.review('pro.month','ios','signed-request',intent,x.make({enabled:false}));
 denyFlags(r);assert.equal(r.status,'blocked');
 assert.equal(x.state.authReads,0);assert.equal(x.state.readCount,0);
});
test('signed Auth candidate is reread three times; unverified event never grants',async()=>{
 const x=fixture(),r=await x.review();denyFlags(r);
 assert.equal(r.status,'review_only');assert.equal(r.candidate_state,'unverified_active');
 assert.equal(r.auth_reread_count,3);
 assert.equal(x.state.authReads,3);assert.equal(x.state.readCount,1);
});
test('wrong Auth port identity namespace and fake UI login are denied',async()=>{
 const x=fixture();assert.throws(()=>x.make({identity:{contract:'offline_auth_fixture_only'}}));
 for(const req of [null,{loggedIn:true},'guest','other-session']){
  const r=await x.review('pro.month','ios',req);denyFlags(r);
  assert.equal(r.status,'blocked');
 }
 assert.equal(x.state.readCount,0);
});
test('tampered private proof is denied; Auth source is never converted to R002 fixture',async()=>{
 const x=fixture();x.state.forceInvalidProof=true;
 const r=await x.review();denyFlags(r);assert.equal(r.status,'blocked');
 assert.equal(x.state.readCount,0);
});
test('wrong brand/app/environment/flow and unknown Store SKU cannot reach probe',async()=>{
 const x=fixture();
 for(const i of [{...intent,brand_id:'hglobal'}, {...intent,app_id:'starry.two'},
  {...intent,environment:'production'}, {...intent,flow_ref:'attacker'}]){
  const r=await x.review('pro.month','ios','signed-request',i);
  denyFlags(r);assert.equal(r.status,'blocked');
 }
 for(const key of ['battery.topup','unlisted','pro.monthX']){
  const r=await x.review(key);denyFlags(r);assert.equal(r.status,'blocked');
 }
 assert.equal(x.state.readCount,0);
});
test('revocation and account switch DURING Store probe deny after fresh Auth read',async()=>{
 for(const change of [s=>s.revoked=true,s=>s.member=DIGEST2,
  s=>s.session=SESSION2,s=>s.epoch=2,s=>s.kid='digest-v2']){
  const x=fixture();x.state.onStore=()=>change(x.state);
  const r=await x.review();denyFlags(r);
  assert.equal(r.status,'blocked');
  assert.equal(r.reason,'IDENTITY_CHANGED_AFTER_STORE');
 }
});
test('KID rotation between first/second proof denies before Store',async()=>{
 const x=fixture();const original=x.identity.reviewFresh.bind(x.identity);
 x.identity.reviewFresh=async (...a)=>{
  const v=await original(...a);
  if(x.state.authReads===1)x.state.epoch=2;
  return v;
 };
 const r=await x.review();denyFlags(r);assert.equal(r.status,'blocked');
 assert.equal(x.state.readCount,0);
});
test('wrong App, platform, SKU, member, Store source and production probe are rejected',async()=>{
 const overrides=[
  {app_id:'starry.two'}, {platform:'android'}, {store_sku:'another.sku'},
  {member_digest:DIGEST2}, {source:'self_declared_paid'}, {environment:'production'},
  {brand_id:'hglobal'}, {product_key:'pro.year'}
 ];
 for(const patch of overrides){
  const x=fixture();const client=x.make({readUnverifiedStoreProbe:async()=>({
   source:'revenuecat_unverified_fixture',brand_id:'starry',app_id:scope.app_id,
   environment:scope.environment,member_digest:DIGEST1,platform:'ios',
   product_key:'pro.month',store_sku:'one.ios.month',source_version:1,
   status:'active',expires_at_sec:NOW+100,...patch})});
  const r=await x.review('pro.month','ios','signed-request',intent,client);
  denyFlags(r);assert.equal(r.status,'blocked');
 }
});
test('same-App iOS and Android only review distinct SKU, no receipt transfer',async()=>{
 const x=fixture(),client=x.make();
 const a=await x.review('pro.month','ios','signed-request',intent,client);
 x.state.platform='android';
 const b=await x.review('pro.month','android','signed-request',intent,client);
 for(const r of [a,b]){denyFlags(r);assert.equal(r.status,'review_only');}
 assert.equal(a.platform,'ios');assert.equal(b.platform,'android');
});
test('rollback and same-version conflicting refund are refused locally',async()=>{
 const x=fixture(),client=x.make();
 denyFlags(await x.review('pro.month','ios','signed-request',intent,client));
 x.state.sourceVersion=1;
 let r=await x.review('pro.month','ios','signed-request',intent,client);
 denyFlags(r);assert.equal(r.reason,'ROLLBACK_OR_CONFLICTING_EVENT');
 x.state.sourceVersion=2;x.state.status='refunded';
 r=await x.review('pro.month','ios','signed-request',intent,client);
 denyFlags(r);assert.equal(r.reason,'ROLLBACK_OR_CONFLICTING_EVENT');
});
test('refund/revoke/expiry fail closed while buyout is separate from subscription',async()=>{
 const x=fixture(),client=x.make();
 x.state.key='pro.buyout';
 const permanent=await x.review('pro.buyout','ios','signed-request',intent,client);
 denyFlags(permanent);assert.equal(permanent.candidate_state,'unverified_active');
 x.state.key='pro.month';x.state.status='expired';x.state.expiry=NOW-1;
 const expired=await x.review('pro.month','ios','signed-request',intent,client);
 denyFlags(expired);assert.equal(expired.candidate_state,'expired');
 x.state.status='refunded';x.state.sourceVersion=3;
 const refunded=await x.review('pro.month','ios','signed-request',intent,client);
 denyFlags(refunded);assert.equal(refunded.candidate_state,'revoked');
 x.state.key='pro.buyout';x.state.status='revoked';x.state.sourceVersion=4;
 const rev=await x.review('pro.buyout','ios','signed-request',intent,client);
 denyFlags(rev);assert.equal(rev.candidate_state,'revoked');
});
test('Store outage, Auth outage, expired proof and bad local clock deny',async()=>{
 const a=fixture();a.state.failStore=true;
 let r=await a.review();denyFlags(r);assert.equal(r.status,'blocked');
 const b=fixture();b.state.revoked=true;r=await b.review();denyFlags(r);assert.equal(r.status,'blocked');
 const c=fixture();c.state.clock=NOW+500;
 r=await c.review();denyFlags(r);assert.equal(r.status,'blocked');
 const d=fixture();d.state.clock=NaN;
 r=await d.review();denyFlags(r);assert.equal(r.status,'blocked');
});
test('malicious getters or unexpected receipt claims are rejected without executing getters',async()=>{
 const x=fixture();let touched=0;
 const raw={source:'revenuecat_unverified_fixture',brand_id:'starry',app_id:scope.app_id,
 environment:scope.environment,member_digest:DIGEST1,platform:'ios',
 product_key:'pro.month',store_sku:'one.ios.month',source_version:1,
 status:'active',expires_at_sec:NOW+200};
 Object.defineProperty(raw,'source',{enumerable:true,get(){touched++;return 'revenuecat_unverified_fixture'}});
 const client=x.make({readUnverifiedStoreProbe:async()=>raw});
 const r=await x.review('pro.month','ios','signed-request',intent,client);
 denyFlags(r);assert.equal(r.status,'blocked');assert.equal(touched,0);
 const rogue=x.make({readUnverifiedStoreProbe:async()=>({...raw,source:'revenuecat_unverified_fixture',receipt:'secret'})});
 denyFlags(await x.review('pro.month','ios','signed-request',intent,rogue));
});
test('unsupported purchases, duplicate SKU, wrong brand/prod settings rejected in config',()=>{
 const x=fixture();
 const forbidden={product_key:'battery.topup',kind:'NON_CONSUMABLE',period:null,
  sku_ios:'starry.battery.ios',sku_android:'starry.battery.android'};
 assert.throws(()=>x.make({products:[...products,forbidden]}));
 assert.throws(()=>x.make({products:[products[0],{...products[1],sku_ios:products[0].sku_ios}]}));
 assert.throws(()=>x.make({products:[{...products[0],kind:'CONSUMABLE'}]}));
 assert.throws(()=>x.make({scope:{...scope,brand_id:'hglobal'}}));
 assert.throws(()=>x.make({scope:{...scope,environment:'production'}}));
});
