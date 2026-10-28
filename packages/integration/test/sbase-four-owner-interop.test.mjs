import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createOfflineStarryAuthClient, STARRY_AUTH_CLIENT_VERSION,
 STARRY_AUTH_CLIENT_LIVE_ENABLED, STARRY_AUTH_CLIENT_SERVER_AUTHORIZED
} from '../../../modules/starry-id-v1/src/sbase-auth-client.ts';
import {
 createSbaseOfflineBillingClient, SBASE_BILLING_CONTRACT,
 SBASE_BILLING_LIVE,SBASE_STORE_PAYMENTS_ENABLED,SBASE_BATTERY_PURCHASABLE
} from '../../rebuild-billing/src/sbase-billing-client-candidate.ts';
import {
 createCandidateBatteryClient, SBASE_BATTERY_CONTRACT_VERSION,
 SBASE_BATTERY_LIVE_ENABLED
} from '../../rebuild-ai3/src/sbase-battery-client-contract.ts';
import {
 SBASE_CONTRACT_VERSION,SBASE_PRODUCTION_ENABLED,SBASE_BILLING_ENABLED,
 SBASE_AD_REQUESTS_ENABLED,SBASE_NATIVE_BUILD_ENABLED,
 validateSbaseManifest,planSbaseAppFactory,inspectSbaseClientPorts,
 inspectExistingHealthContract
} from '../../../apps/api/src/sbase-20261028-app-manifest-factory.ts';

const ids={appId:'starry-integration-a',brand_id:'starry',environment:'staging'};
function setup(){
 const authScope={brand_id:'starry',app_id:ids.appId,environment:'staging',platform:'ios'};
 const auth=createOfflineStarryAuthClient({
  enabled:true,serverOwnedScope:authScope,candidateAllowedScopes:['profile:read'],
  ports:{readSessionCandidate:async()=>{throw Error('OFFLINE_NO_ISSUER')},
         readDeletionCandidate:async()=>{throw Error('OFFLINE_NO_DELETION')}}
 });
 const billing=createSbaseOfflineBillingClient({
  enabled:true,
  scope:{brand_id:'starry',environment:'staging',app_id:ids.appId,
   platform:'ios',store_app_ref:'r_'+'a'.repeat(64)},
  products:[],
  ports:{readCandidate:async()=>{throw Error('NO_STORE')},
         readFloor:async()=>{throw Error('NO_WITNESS')},
         lawfulProcessingAndRetention:async()=>false}
 });
 const battery=createCandidateBatteryClient({
  enabled:true,scope:{brand_id:'starry',app_id:ids.appId,environment:'staging'},
  verifyScopedRead:async()=> 'active',
  readPolicyStatus:async()=>({brand_id:'starry',app_id:ids.appId,environment:'staging',
   status:'candidate_free',policy_version:1})
 });
 return {auth,billing,battery,authScope};
}
const manifest=()=>({
 schemaVersion:1,brandId:'starry',appId:ids.appId,appName:'Integration test only',
 environment:'staging',platforms:['ios','android'],
 ios:{bundleId:'com.starry.integrationa'},android:{applicationId:'com.starry.integrationa'},
 urlScheme:'starry-integrationa',expoSdkCandidate:'58',reactNativeCandidate:'0.88',
 authClientContractVersion:STARRY_AUTH_CLIENT_VERSION,
 batteryClientContractVersion:SBASE_BATTERY_CONTRACT_VERSION,
 billingClientContractVersion:SBASE_BILLING_CONTRACT,
 monetization:{billingProvider:'disabled',productKeys:[],
  monthlySubscriptionKey:null,yearlySubscriptionKey:null,noAdsEntitlementKey:null},
 ads:{provider:'disabled',bannerPlacements:[],interstitialPlacements:[],rewardedEnabled:false},
 safety:{liveRequestsEnabled:false,nativeBuildEnabled:false,sdkRevenueCatEnabled:false,
  sdkAdMobEnabled:false,crossBrandEnabled:false,storeSubmissionEnabled:false,
  cloudflareDeployEnabled:false}
});

test('all four actual SBASE owners are present on one checkout; versioned contracts never grant live rights',()=>{
 assert.match(STARRY_AUTH_CLIENT_VERSION,/candidate/);
 assert.match(SBASE_BILLING_CONTRACT,/candidate/);
 assert.match(SBASE_BATTERY_CONTRACT_VERSION,/candidate/);
 assert.match(SBASE_CONTRACT_VERSION,/candidate/);
 for(const flag of [
  STARRY_AUTH_CLIENT_LIVE_ENABLED,STARRY_AUTH_CLIENT_SERVER_AUTHORIZED,
  SBASE_BILLING_LIVE,SBASE_STORE_PAYMENTS_ENABLED,SBASE_BATTERY_PURCHASABLE,
  SBASE_BATTERY_LIVE_ENABLED,SBASE_PRODUCTION_ENABLED,SBASE_BILLING_ENABLED,
  SBASE_AD_REQUESTS_ENABLED,SBASE_NATIVE_BUILD_ENABLED
 ])assert.equal(flag,false);
});

test('AI-1 Auth, AI-2 Billing, AI-3 Battery cannot give a fake session, paid Battery or Queue permission',async()=>{
 const {auth,billing,battery,authScope}=setup();
 const request={scope:authScope,requested_scopes:['profile:read']};
 const guest=auth.guest(request),offline=await auth.getSession(request);
 const pay=await billing.purchase('battery'),offer=await billing.getOfferings();
 const ent=await billing.getEntitlements('other-app-premium');
 const free=await battery.readFreePolicyStatus({brand_id:'starry',app_id:ids.appId,
  environment:'staging',operation:'battery.policy.read'});
 assert.equal(guest.status,'guest');
 assert.equal(guest.authenticated,false);
 assert.equal(offline.status,'unavailable');
 assert.equal(offline.private_access_authorized,false);
 assert.equal(offline.may_grant,false);
 assert.equal(pay.ok,false);assert.equal(pay.reason,'BATTERY_PERMANENTLY_FREE');
 assert.equal(offer.sellable,false);assert.equal(offer.products.length,0);
 assert.equal(ent.may_grant,false);assert.equal(ent.ads_suppressed,false);
 assert.equal(free.pricing,'permanently_free');assert.equal(free.status,'candidate_only');
 assert.equal(free.may_purchase,false);assert.equal(free.may_grant,false);
 assert.equal(free.may_ack_queue,false);assert.equal(free.live,false);
});

test('AI-4 real Factory/Sdk boundary may inspect all three owner clients, but never authorize native build, ads or release',async()=>{
 const {auth,billing,battery,authScope}=setup();
 const inspected=await inspectSbaseClientPorts({
  auth:{contractVersion:STARRY_AUTH_CLIENT_VERSION,
        readStatus:()=>Promise.resolve(auth.guest({scope:authScope,requested_scopes:[]}))},
  billing:{contractVersion:SBASE_BILLING_CONTRACT,
           readStatus:()=>billing.getEntitlements('foreign-sku')},
  battery:{contractVersion:SBASE_BATTERY_CONTRACT_VERSION,
           readStatus:()=>battery.readFreePolicyStatus({brand_id:'starry',
            app_id:ids.appId,environment:'staging',operation:'battery.policy.read'})}
 });
 assert.equal(inspected.status,'review_only');
 for(const k of ['authority','authenticated','wallet_verified','entitlement_verified','may_publish','may_charge'])
  assert.equal(inspected[k],false,k);
 const validation=validateSbaseManifest(manifest());
 assert.equal(validation.candidate_valid,true);assert.equal(validation.approved,false);
 const planned=planSbaseAppFactory(manifest());
 assert.equal(planned.targetRepository,'NEW_PRIVATE_REPO_PENDING');
 for(const k of ['can_write_files','can_install','can_deploy','publishable'])
  assert.equal(planned[k],false,k);
 const tampered=manifest();
 tampered.safety={...tampered.safety,sdkAdMobEnabled:true};
 assert.equal(validateSbaseManifest(tampered).candidate_valid,false);
 const existing=await inspectExistingHealthContract();
 assert.equal(existing.valid,true);
 assert.equal(existing.hono_poc_completed,false);
 assert.equal(existing.openapi_codegen_completed,false);
});
