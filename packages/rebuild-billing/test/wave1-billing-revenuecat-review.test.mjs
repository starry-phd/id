import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineWave1BillingPolicy,WAVE1_BILLING_CONTRACT,WAVE1_BILLING_LIVE}
 from '../src/wave1-billing-revenuecat-review.ts';

const m='m_'+'a'.repeat(64);
const ref=c=>'r_'+c.repeat(64);
const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
const perpetual={product_key:'premium.buyout',kind:'NON_CONSUMABLE',period:null,
 sku_ios:'starry.one.ios.buyout',sku_android:'starry.one.android.buyout',
 features:['permanent_access','remove_ads']};
const monthly={product_key:'premium.monthly',kind:'AUTO_RENEWABLE_SUBSCRIPTION',
 period:'MONTH',sku_ios:'starry.one.ios.month',
 sku_android:'starry.one.android.month',features:['cloud_sync','premium_access']};
const yearly={product_key:'premium.yearly',kind:'AUTO_RENEWABLE_SUBSCRIPTION',
 period:'YEAR',sku_ios:'starry.one.ios.year',
 sku_android:'starry.one.android.year',features:['cloud_sync']};
const NOW=1800000000;
const identity={kind:'offline_auth_fixture_only',brand_id:'starry',
 app_id:scope.app_id,member_digest:m,auth_version:4,session_state:'active'};
function e(product_key='premium.monthly',changes={}){
 return {event_ref:ref('a'),brand_id:'starry',app_id:scope.app_id,
 environment:'staging',member_digest:m,product_key,platform:'ios',
 source:'revenuecat_unverified_fixture',version:1,status:'active',
 expires_at_sec:product_key==='premium.buyout'?null:NOW+3600,
 ...changes};
}
function create({products=[perpetual,monthly,yearly],events=[],
 who=identity,enabled=true,env=scope,now=NOW}={}){
 const calls={identity:0,events:0};
 const ports={
  async readIdentity(){calls.identity++;return who;},
  async readCandidateEvents(){calls.events++;return events;}
 };
 return {calls,client:createOfflineWave1BillingPolicy({scope:env,products,
  ports,enabled,nowSeconds:now})};
}
function safe(x){
 assert.equal(x.contract,WAVE1_BILLING_CONTRACT);
 assert.equal(x.official_revenuecat_verified,false);
 assert.equal(x.official_store_verified,false);
 assert.equal(x.authenticated_live_session,false);
 for(const k of ['may_start_purchase','may_restore_purchase','may_grant',
  'may_regrant','may_remove_ads','may_ack_webhook','may_publish','live'])
  assert.equal(x[k],false,k);
 for(const secret of [m,ref('a'),'starry.one.ios.month'])
  assert.ok(!JSON.stringify(x).includes(secret));
}
test('Wave1 explicit D03 A RevenueCat candidate is always offline',async()=>{
 const f=create({enabled:false,events:[e()]});
 assert.equal(WAVE1_BILLING_LIVE,false);
 const p=await f.client.purchasePreflight('premium.monthly');safe(p);
 assert.equal(p.status,'blocked');
 const i=await f.client.inspect('premium.monthly');safe(i);
 assert.equal(i.status,'blocked');
 assert.deepEqual(f.calls,{identity:0,events:0});
});
test('Q2 guest, expired, revoked Session never starts purchase or reads Store',async()=>{
 for(const state of ['guest','expired','revoked']){
  const f=create({who:{...identity,session_state:state},events:[e()]});
  const p=await f.client.purchasePreflight('premium.monthly');safe(p);
  assert.equal(p.reason,'SIGNED_STARRY_SESSION_REQUIRED');
  const x=await f.client.inspect('premium.monthly');safe(x);
  assert.equal(x.status,'blocked');assert.equal(f.calls.events,0);
 }
});
test('Q2 even locally active Auth fixture cannot authorize payment',async()=>{
 const f=create({events:[e()]});
 const p=await f.client.purchasePreflight('premium.monthly');safe(p);
 assert.equal(p.status,'blocked');assert.equal(p.reason,'LIVE_AUTH_AND_STORE_NOT_APPROVED');
 assert.equal(f.calls.events,0);
});
test('only two legal IAP kinds: buyout or auto-renew monthly/yearly',()=>{
 const bad=[
  {...perpetual,kind:'CONSUMABLE'},
  {...perpetual,kind:'NON_RENEWING_SUBSCRIPTION'},
  {...monthly,period:'WEEK'},
  {...monthly,period:null},
  {...perpetual,period:'MONTH'},
  {...monthly,product_key:'starry.battery.credit'},
  {...monthly,features:['sticker_unlock']},
  {...perpetual,features:[]}
 ];
 for(const item of bad)assert.throws(()=>create({products:[item]}));
 assert.equal(create({products:[perpetual]}).client.contract,WAVE1_BILLING_CONTRACT);
 assert.equal(create({products:[monthly,yearly]}).client.contract,WAVE1_BILLING_CONTRACT);
 assert.equal(create().client.contract,WAVE1_BILLING_CONTRACT);
});
test('per-App Store SKU / Product key collision rejected before reads',()=>{
 assert.throws(()=>create({products:[perpetual,{...perpetual}]}));
 assert.throws(()=>create({products:[monthly,{...yearly,sku_ios:monthly.sku_ios}]}));
 assert.throws(()=>create({products:[monthly,{...yearly,sku_android:monthly.sku_android}]}));
});
test('Q3 monthly and yearly independent; expiry leaves perpetual buyout intact',async()=>{
 const f=create({events:[
  e('premium.buyout',{event_ref:ref('b'),expires_at_sec:null}),
  e('premium.monthly',{event_ref:ref('c'),status:'expired',expires_at_sec:NOW-1}),
  e('premium.yearly',{event_ref:ref('d'),status:'expired',expires_at_sec:NOW-1})
 ]});
 const buy=await f.client.inspect('premium.buyout');safe(buy);
 assert.equal(buy.permanent_candidate,'active_local');
 assert.equal(buy.status,'review_only');
 const month=await f.client.inspect('premium.monthly');safe(month);
 assert.equal(month.subscription_candidate,'expired_local');
 assert.equal(month.permanent_candidate,'none');
 const year=await f.client.inspect('premium.yearly');safe(year);
 assert.equal(year.subscription_candidate,'expired_local');
});
test('newer refund outweighs older active event even out of order',async()=>{
 const f=create({events:[
  e('premium.buyout',{event_ref:ref('d'),version:4,status:'refunded'}),
  e('premium.buyout',{event_ref:ref('e'),version:3,status:'active'}),
  e('premium.monthly',{event_ref:ref('f'),version:10,status:'revoked'}),
  e('premium.monthly',{event_ref:ref('1'),version:1,status:'active'})
 ]});
 const buy=await f.client.inspect('premium.buyout');safe(buy);
 assert.equal(buy.permanent_candidate,'revoked_local');
 const sub=await f.client.inspect('premium.monthly');safe(sub);
 assert.equal(sub.subscription_candidate,'revoked_local');
});
test('duplicate webhook exact replay idempotent, conflict with same event ref blocks',async()=>{
 const a=e(),f=create({events:[a,{...a}]});
 const out=await f.client.inspect('premium.monthly');safe(out);
 assert.equal(out.status,'review_only');
 const bad=create({events:[a,{...a,status:'refunded'}]});
 const x=await bad.client.inspect('premium.monthly');safe(x);
 assert.equal(x.reason,'CONFLICTING_WEBHOOK_REPLAY');
});
test('same source version different events is never safe to pick arbitrarily',async()=>{
 const f=create({events:[e('premium.monthly',{event_ref:ref('a'),version:9}),
  e('premium.monthly',{event_ref:ref('b'),version:9,status:'refunded'})]});
 const o=await f.client.inspect('premium.monthly');safe(o);
 assert.equal(o.reason,'NONMONOTONIC_SOURCE_VERSION');
});
test('Q1 iOS-only candidate can be reviewed for same-App multi-OS, not granted',async()=>{
 const f=create({events:[e()]});
 const o=await f.client.inspect('premium.monthly');safe(o);
 assert.equal(o.cross_platform_review_only,true);
 assert.equal(o.subscription_candidate,'active_local');
 assert.equal(o.reason,'UNVERIFIED_REVENUECAT_AND_STORE_AUTHORITY');
});
test('Q1 Android candidate same App + member independently reviewable',async()=>{
 const f=create({events:[e('premium.buyout',{
  platform:'android',expires_at_sec:null})]});
 const o=await f.client.inspect('premium.buyout');safe(o);
 assert.equal(o.permanent_candidate,'active_local');
 assert.equal(o.cross_platform_review_only,true);
});
test('foreign App, brand, environment or member event rejected globally',async()=>{
 for(const change of [{app_id:'starry.other'},{brand_id:'hglobal'},
  {environment:'production'},{member_digest:'m_'+'b'.repeat(64)}]){
  const f=create({events:[e('premium.monthly',change)]});
  const o=await f.client.inspect('premium.monthly');safe(o);
  assert.equal(o.reason,'FOREIGN_OR_INVALID_EVENT');
 }
});
test('member switch invalidates prior candidate; no automatic restore',async()=>{
 const f=create({who:{...identity,member_digest:'m_'+'b'.repeat(64)},
  events:[e()]});
 const o=await f.client.inspect('premium.monthly');safe(o);
 assert.equal(o.status,'blocked');assert.equal(o.may_restore_purchase,false);
});
test('unknown product cannot inspect or restore any other App rights',async()=>{
 const f=create({events:[e()]});
 const out=await f.client.inspect('premium.other_app');safe(out);
 assert.equal(out.status,'blocked');assert.equal(f.calls.events,0);
});
test('no event / expired server time / hold or grace never authorizes',async()=>{
 const nil=create(),x=await nil.client.inspect('premium.monthly');safe(x);
 assert.equal(x.subscription_candidate,'none');
 const expired=create({events:[e()],now:NOW+8000});
 const out=await expired.client.inspect('premium.monthly');safe(out);
 assert.equal(out.subscription_candidate,'expired_local');
 for(const status of ['hold','grace']){
  const f=create({events:[e('premium.monthly',{status})]});
  const z=await f.client.inspect('premium.monthly');safe(z);
  assert.equal(z.subscription_candidate,'expired_local');
 }
});
test('unsafe source accessor and service outage fail closed',async()=>{
 const f=create({who:null,events:[e()]});
 const a=await f.client.inspect('premium.monthly');safe(a);
 assert.equal(a.status,'blocked');
 const poisoned=Object.defineProperty({},'product_key',{get(){throw Error('evil')}});
 assert.throws(()=>create({products:[poisoned]}));
});
test('no Store callback or Battery purchase occurs even if local candidate active',async()=>{
 const f=create({events:[e()]});
 const o=await f.client.inspect('premium.monthly');safe(o);
 assert.equal(o.may_ack_webhook,false);
 assert.equal(o.may_remove_ads,false);
 assert.equal(o.may_publish,false);
});
