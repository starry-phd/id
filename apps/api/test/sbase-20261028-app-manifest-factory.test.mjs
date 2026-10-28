import test from 'node:test';
import assert from 'node:assert/strict';
import {
 SBASE_CONTRACT_VERSION,SBASE_PRODUCTION_ENABLED,SBASE_BILLING_ENABLED,
 SBASE_AD_REQUESTS_ENABLED,SBASE_NATIVE_BUILD_ENABLED,SBASE_CANDIDATE_STACK,
 validateSbaseManifest,planSbaseAppFactory,checkSbaseFleet,
 inspectSbaseClientPorts,decideSbaseAdPlaceholder,inspectExistingHealthContract
} from '../src/sbase-20261028-app-manifest-factory.ts';
const manifest=(app='starry-demo-one')=>({
 schemaVersion:1,brandId:'starry',appId:app,appName:'Candidate demo',
 environment:'development',platforms:['ios','android'],
 ios:{bundleId:'com.starry.demoone'},android:{applicationId:'com.starry.demoone'},
 urlScheme:'starry-demoone',expoSdkCandidate:'58',reactNativeCandidate:'0.88',
 authClientContractVersion:'starry.auth.v1',
 batteryClientContractVersion:'starry.battery.v1',
 billingClientContractVersion:'starry.billing.v1',
 monetization:{billingProvider:'disabled',productKeys:[],
  monthlySubscriptionKey:null,yearlySubscriptionKey:null,noAdsEntitlementKey:null},
 ads:{provider:'disabled',bannerPlacements:[],interstitialPlacements:[],rewardedEnabled:false},
 safety:{liveRequestsEnabled:false,nativeBuildEnabled:false,
  sdkRevenueCatEnabled:false,sdkAdMobEnabled:false,crossBrandEnabled:false,
  storeSubmissionEnabled:false,cloudflareDeployEnabled:false}
});
const safe=(result)=>{
 assert.equal(result.approved,false);
 for(const k of ['may_deploy','may_build_native','may_sell','may_show_ads',
  'may_read_central_d1','may_approve_entitlement'])assert.equal(result[k],false,k);
 assert.equal(Object.isFrozen(result),true);
};
test('SBASE candidate flags, exact baseline distinction, no approved native PoC',()=>{
 assert.equal(SBASE_CONTRACT_VERSION.includes('sbase-20261028'),true);
 for(const item of [SBASE_PRODUCTION_ENABLED,SBASE_BILLING_ENABLED,
  SBASE_AD_REQUESTS_ENABLED,SBASE_NATIVE_BUILD_ENABLED])assert.equal(item,false);
 assert.match(SBASE_CANDIDATE_STACK.current,/Expo 54/);
 assert.match(SBASE_CANDIDATE_STACK.proposed,/Expo 58/);
 assert.match(SBASE_CANDIDATE_STACK.nativePluginProof,/PENDING/);
});
test('valid candidate manifest is still never a live product or Store permission',()=>{
 const r=validateSbaseManifest(manifest());assert.equal(r.candidate_valid,true);safe(r);
});
test('app factory creates ONLY a proposed plan; no files, native build or paid SDK',()=>{
 const r=planSbaseAppFactory(manifest());assert.ok(r);
 assert.equal(r.kind,'OFFLINE_ONLY_NO_FILES_WRITTEN');
 assert.equal(r.targetRepository,'NEW_PRIVATE_REPO_PENDING');
 assert.equal(r.manifestPath,'apps/demo-one/starry.app.json');
 assert.equal(r.can_write_files,false);assert.equal(r.can_install,false);
 assert.equal(r.can_deploy,false);assert.equal(r.publishable,false);
 assert.equal(Object.isFrozen(r),true);
});
test('reject every production or foreign brand scope',()=>{
 for(const change of [{brandId:'hglobal'},{environment:'production'},
  {environment:'unknown'},{brandId:'starry-id'},{schemaVersion:2}]){
  const r=validateSbaseManifest({...manifest(),...change});safe(r);
  assert.equal(r.candidate_valid,false);
 }
});
test('reject manifest with any unrecognized field such as clientSecret or token',()=>{
 for(const key of ['clientSecret','cloudflareD1','revenuecatApiKey','member_id','adMobSecret']){
  const r=validateSbaseManifest({...manifest(),[key]:'dont-store-this'});
  assert.equal(r.candidate_valid,false);safe(r);
  assert.equal(r.reasons[0],'MANIFEST_SHAPE_OR_SECRET_DENIED');
 }
});
test('reject accessor injection and nonplain prototype, never evaluate a secret getter',()=>{
 let touched=false;
 const x=manifest();
 Object.defineProperty(x,'appName',{get(){touched=true;throw Error('getter')}});
 assert.equal(validateSbaseManifest(x).candidate_valid,false);
 assert.equal(touched,false);
 const y=Object.create({brandId:'starry'});
 Object.assign(y,manifest());
 assert.equal(validateSbaseManifest(y).candidate_valid,false);
});
test('unapproved RevenueCat/IAP, SKU, subscription or no-ads entitlement cannot be enabled',()=>{
 for(const monetization of [
  {...manifest().monetization,billingProvider:'revenuecat'},
  {...manifest().monetization,productKeys:['shared_premium']},
  {...manifest().monetization,monthlySubscriptionKey:'monthly'},
  {...manifest().monetization,yearlySubscriptionKey:'annual'},
  {...manifest().monetization,noAdsEntitlementKey:'no_ads'}]){
  const r=validateSbaseManifest({...manifest(),monetization});
  assert.equal(r.candidate_valid,false);assert.ok(r.reasons.includes('BILLING_NOT_APPROVED'));safe(r);
 }
});
test('ad provider and placements cannot go live, UMP/ATT still missing',()=>{
 for(const ads of [
  {...manifest().ads,provider:'admob'},
  {...manifest().ads,bannerPlacements:['pub-demo']},
  {...manifest().ads,interstitialPlacements:['pub-demo']},
  {...manifest().ads,rewardedEnabled:true}]){
  const r=validateSbaseManifest({...manifest(),ads});
  assert.equal(r.candidate_valid,false);assert.ok(r.reasons.includes('AD_NETWORK_NOT_APPROVED'));safe(r);
 }
});
test('any supposedly safe SDK, real Cloudflare or native deploy flag is blocked',()=>{
 for(const key of Object.keys(manifest().safety)){
  const r=validateSbaseManifest({...manifest(),
   safety:{...manifest().safety,[key]:true}});
  assert.equal(r.candidate_valid,false);safe(r);
 }
});
test('unapproved SDK or RN version is not silently adopted',()=>{
 for(const change of [{expoSdkCandidate:'54'},
  {reactNativeCandidate:'0.81.5'},
  {authClientContractVersion:''},{batteryClientContractVersion:''},
  {billingClientContractVersion:''}]){
  assert.equal(validateSbaseManifest({...manifest(),...change}).candidate_valid,false);
 }
});
test('duplicate app id, bundle, package and urlScheme across fleet blocked',()=>{
 const a=manifest(),b=manifest('starry-demo-two');
 b.ios.bundleId='com.starry.demotwo';
 b.android.applicationId='com.starry.demotwo';
 b.urlScheme='starry-demotwo';
 assert.equal(checkSbaseFleet([a,b]).valid,true);
 for(const key of ['appId','ios','android','urlScheme']){
  const copy={...b,[key]:a[key]};
  const r=checkSbaseFleet([a,copy]);assert.equal(r.valid,false);
  assert.ok(r.reasons.some(x=>x.includes('COLLISION')));
 }
});
test('large fleet or unknown app cannot be silently registered',()=>{
 const a=manifest();
 assert.equal(checkSbaseFleet([]).valid,false);
 assert.equal(checkSbaseFleet(Array.from({length:51},()=>a)).valid,false);
 assert.equal(checkSbaseFleet([a,{...a,appId:'hglobal-id'}]).valid,false);
});
test('no-ads mock precedence always prevents AdMob network requests',()=>{
 const base={appId:'starry-demo-one',consent:'approved_mock',
  purchaseEntitlement:'none',subscriptionEntitlement:'none',providerApproved:false};
 for(const changes of [
  {purchaseEntitlement:'permanent_no_ads_mock',subscriptionEntitlement:'expired'},
  {purchaseEntitlement:'none',subscriptionEntitlement:'active_no_ads_mock'},
  {purchaseEntitlement:'none',subscriptionEntitlement:'none'},
  {consent:'denied'}, {providerApproved:true}
 ]){
  const r=decideSbaseAdPlaceholder({...base,...changes});
  assert.equal(r.can_request_ad,false);assert.equal(r.purchases_enabled,false);
  assert.equal(r.battery_sellable,false);assert.equal(r.ads_sdk_loaded,false);
 }
});
test('malicious ad responses and cross-brand requests fail safe',()=>{
 for(const x of [null,{},{
  appId:'hglobal-id',consent:'approved_mock',
  purchaseEntitlement:'none',subscriptionEntitlement:'none',providerApproved:true
 },{appId:'starry-demo-one',consent:'approved_mock',
  purchaseEntitlement:'none',subscriptionEntitlement:'none',providerApproved:true,
  apiKey:'unexpected'}]){
  const r=decideSbaseAdPlaceholder(x);
  assert.equal(r.status,'blocked');assert.equal(r.can_request_ad,false);
 }
});
test('owner client ports remain nonauthoritative even if all local mocks return success',async()=>{
 const ports=Object.fromEntries(['auth','battery','billing'].map(x=>[x,{
  contractVersion:x+'.v1',readStatus:async()=>({status:'ok',rights:'all'})
 }]));
 const r=await inspectSbaseClientPorts(ports);
 assert.equal(r.status,'review_only');assert.equal(r.authority,false);
 assert.equal(r.authenticated,false);assert.equal(r.wallet_verified,false);
 assert.equal(r.entitlement_verified,false);
 assert.equal(r.may_publish,false);assert.equal(r.may_charge,false);
});
test('Auth/Battery/Billing outage is isolated and cannot blank unrelated app screens',async()=>{
 const r=await inspectSbaseClientPorts({
  auth:{contractVersion:'auth.v1',readStatus:async()=>{throw Error('unavailable')}},
  billing:{contractVersion:'billing.v1',readStatus:async()=>({})}
 });
 assert.equal(r.status,'blocked');
 assert.ok(r.missing.includes('AUTH_UNAVAILABLE'));
 assert.ok(r.missing.includes('BATTERY_PORT_MISSING'));
 assert.equal(r.may_publish,false);
});
test('existing /v1/health is checked against real handler, NOT a fictional Hono server',async()=>{
 const r=await inspectExistingHealthContract();
 assert.equal(r.path,'/v1/health');assert.equal(r.valid,true);
 assert.equal(r.implementation,'EXISTING_WORKER_NO_HONO');
 assert.equal(r.hono_poc_completed,false);
 assert.equal(r.openapi_codegen_completed,false);
});
