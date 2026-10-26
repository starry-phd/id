import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerIdentityResolver} from '../../../modules/starry-id-v1/src/index.ts';
import {COMMERCE_PUBLISHABLE,COMMERCE_POLICY_VERSION,createSandboxCommercePolicy}
 from '../src/commerce-policy.ts';

const now=1793100000;
const owner='starry.alpha';
const baseOffer={
 offerId:'alpha.monthly',ownerAppId:owner,kind:'monthly',
 skuByStore:{apple:'sku.ios.monthly',google:'sku.android.monthly'},
 storeAppIdByStore:{apple:'phd.starry.alpha',google:'com.starry.alpha'},
 allowCrossPlatform:false,allowedCrossAppIds:[],
 restoration:'self_service_reverify',enabledForSandbox:true,
};
const current={
 brandId:'starry',runtimeEnvironment:'staging',storeEnvironment:'sandbox',
 sourceAppId:owner,sourceStore:'apple',sourceStoreAppId:'phd.starry.alpha',
 sourceSku:'sku.ios.monthly',offerId:baseOffer.offerId,kind:'monthly',
 ownerUserId:'s_001',userId:'s_001',state:'PAID',status:'active',
 expiresAtSeconds:now+3600,lastProviderCheckSeconds:now-10,
 revision:1,accountDeleted:false,
};
function setup(options={}){
 const selectedApp=options.appId??owner;
 const environment=options.environment??'staging';
 const registry={brandId:'starry',appId:selectedApp,environment};
 const offers=options.offers??[{...baseOffer}];
 const storeState={row:options.row===undefined?current:options.row,
  error:options.readError??false,readCalls:0,
  now:options.now??now};
 const resolver=createServerIdentityResolver({
  trusted_scope:{brand_id:'starry',app_id:options.principalApp??selectedApp,
   environment:options.principalEnv??environment},
  verify_oidc_or_session:async()=>({
   brand_id:'starry',app_id:options.principalApp??selectedApp,
   environment:options.principalEnv??environment,
   provider:'apple',provider_subject:'stable-subject',
   s_user_id:'s_001',session_id:'session-1',auth_version:1,
   expires_at:storeState.now+3600,
  }),
  read_member:async()=>({s_user_id:'s_001',
   status:options.status??'active',auth_version:1,profile_revision:1,
   display_name:null,directory_opt_in:false,display_name_public:false}),
  read_session:async()=>({session_id:'session-1',s_user_id:'s_001',
   auth_version:1,app_id:options.principalApp??selectedApp,
   environment:options.principalEnv??environment,
   expires_at:storeState.now+3600,revoked_at:options.revoked?1:null,
   step_up_method:null,step_up_verified_at:null,step_up_expires_at:null}),
  identity_matches:async()=>true,
 });
 const ports={
  resolveTrustedPrincipal:async()=>options.forged??resolver({testOnly:true},storeState.now),
  readCommittedEntitlement:async(userId,offerId)=>{
   storeState.readCalls++;assert.equal(userId,'s_001');
   assert.equal(offerId,offers[0].offerId);
   if(storeState.error)throw new Error('offline-d1-failed');
   return storeState.row;
  },
  serverNowSeconds:()=>storeState.now,
 };
 const policy=createSandboxCommercePolicy({
  scope:registry,offers,maxRequeryAgeSeconds:120,ports,
 });
 return {policy,storeState,registry};
}
const access=(x,offerId=baseOffer.offerId,deviceStore='apple')=>
 x.policy.evaluateAccess({offerId,deviceStore});
test('Q95 monthly: committed matching subscription returns CANDIDATE, never a grant',async()=>{
 const x=setup();
 const result=await access(x);
 assert.equal(result.verdict,'policy_candidate_only');
 assert.equal(result.publishable,false);
 assert.equal(COMMERCE_PUBLISHABLE,false);
 assert.equal(result.policyVersion,COMMERCE_POLICY_VERSION);
 assert.equal(x.storeState.readCalls,1);
 assert.equal('right' in result,false);
});
test('Q95 yearly subscription is separately supported via trusted catalogue',async()=>{
 const yearly={...baseOffer,offerId:'alpha.yearly',kind:'yearly'};
 const row={...current,offerId:'alpha.yearly',kind:'yearly'};
 const x=setup({offers:[yearly],row});
 assert.equal((await access(x,'alpha.yearly')).verdict,'policy_candidate_only');
});
test('Q95 one-time digital purchase has no expiry and is not a subscription',async()=>{
 const one={...baseOffer,offerId:'alpha.single',kind:'one_time'};
 const row={...current,offerId:'alpha.single',kind:'one_time',expiresAtSeconds:null};
 assert.equal((await access(setup({offers:[one],row}),'alpha.single')).verdict,
  'policy_candidate_only');
 assert.equal((await access(setup({offers:[one],row:{...row,expiresAtSeconds:now+1}}),'alpha.single')).reason,
  'PERPETUAL_EXPIRY_MISMATCH');
});
test('Q125 different Starry Apps are isolated by DEFAULT, even with same Starry ID',async()=>{
 const x=setup({appId:'starry.beta'});
 const d=await access(x);
 assert.equal(d.reason,'CROSS_APP_NOT_APPROVED');
 assert.equal(x.storeState.readCalls,0);
});
test('Q125 explicit per-SKU cross-App destination allowlist permits only a policy candidate',async()=>{
 const offer={...baseOffer,allowedCrossAppIds:['starry.beta']};
 assert.equal((await access(setup({appId:'starry.beta',offers:[offer]}))).verdict,'policy_candidate_only');
 assert.equal((await access(setup({appId:'starry.gamma',offers:[offer]}))).verdict,'deny');
});
test('Q96 same-app cross iOS/Android does NOT follow from Q125 shared-App allowlist',async()=>{
 const offer={...baseOffer,allowedCrossAppIds:['starry.beta']};
 assert.equal((await access(setup({offers:[offer]}),offer.offerId,'google')).reason,
  'CROSS_PLATFORM_NOT_APPROVED');
 assert.equal((await access(setup({appId:'starry.beta',offers:[offer]}),offer.offerId,'google')).reason,
  'CROSS_PLATFORM_NOT_APPROVED');
 const allowed={...offer,allowCrossPlatform:true};
 assert.equal((await access(setup({offers:[allowed]}),allowed.offerId,'google')).verdict,
  'policy_candidate_only');
 assert.equal((await access(setup({appId:'starry.beta',offers:[allowed]}),allowed.offerId,'google')).verdict,
  'policy_candidate_only');
});
test('Q102 identity deletion and foreign original transaction owner never auto-transfer rights',async()=>{
 for(const change of [{accountDeleted:true},{userId:'s_002'},{ownerUserId:'s_002'}]){
  const result=await access(setup({row:{...current,...change}}));
  assert.equal(result.reason,'DELETED_OR_FOREIGN_OWNER');
 }
});
test('Q113 refund/revoke/chargeback/hold/grace/expiry are fail-closed',async()=>{
 for(const state of ['REFUNDED','REVOKED','CHARGEBACK','ON_HOLD','GRACE_PERIOD','EXPIRED']){
  const d=await access(setup({row:{...current,state,status:'inactive'}}));
  assert.equal(d.reason,'STORE_STATE_DENIED',state);
 }
 const expired=await access(setup({row:{...current,expiresAtSeconds:now}}));
 assert.equal(expired.reason,'SUBSCRIPTION_EXPIRED');
});
test('Q113 old or impossible future last-provider-check requires authoritative store requery',async()=>{
 for(const time of [now-121,now+1,0,-1]){
  const result=await access(setup({row:{...current,lastProviderCheckSeconds:time}}));
  assert.equal(result.verdict,'store_requery_required');
 }
});
test('Q113 missing committed source or D1 outage never marks a purchase eligible',async()=>{
 const missing=setup({row:null});
 assert.equal((await access(missing)).reason,'NO_COMMITTED_SOURCE');
 const down=setup({readError:true});
 assert.equal((await access(down)).reason,'BILLING_SOURCE_UNAVAILABLE');
});
test('server-only committed receipt must match exact Starry scope, origin store, SKU, kind, revision',async()=>{
 const changes=[
  {brandId:'hglobal'},{runtimeEnvironment:'production'},{storeEnvironment:'production'},
  {sourceAppId:'starry.beta'},{sourceStoreAppId:'bad.bundle'},
  {sourceSku:'fake'},{kind:'one_time'},{revision:0},{offerId:'other'},
 ];
 for(const changed of changes){
  const result=await access(setup({row:{...current,...changed}}));
  assert.equal(result.reason,'COMMITTED_SCOPE_DENIED',JSON.stringify(changed));
 }
});
test('AI-1 WeakSet identity is mandatory; HTTP principal DTO and revoked Session cannot pass',async()=>{
 const forged=setup({forged:{
  brand_id:'starry',app_id:owner,environment:'staging',
  s_user_id:'s_001',checked_at:now,expires_at:now+3600,
  member_status:'active',
 }});
 await assert.rejects(access(forged),/COMMERCE_AUTH_DENIED/);
 assert.equal(forged.storeState.readCalls,0);
 for(const options of [{revoked:true},{status:'deleted'},{status:'suspended'},
  {principalApp:'starry.beta'},{principalEnv:'development'}]){
  const x=setup(options);
  await assert.rejects(access(x),/COMMERCE_AUTH_DENIED/);
  assert.equal(x.storeState.readCalls,0);
 }
});
test('no client-paid, owner, brand, app or replay flags accepted',async()=>{
 const x=setup();
 for(const extra of [
  {paid:true},{ownerUserId:'s_001'},{brandId:'starry'},
  {appId:owner},{verified:true},{provider_verified:true},
  {idempotency_key:'client'},{storeEnvironment:'sandbox'},
 ]){
  await assert.rejects(x.policy.evaluateAccess({
   offerId:baseOffer.offerId,deviceStore:'apple',...extra,
  }),/COMMERCE_CLIENT_CLAIMS_DENIED/);
 }
 assert.equal(x.storeState.readCalls,0);
});
test('cross-brand/production scope, duplicate IDs, paid Battery, invalid cross-App targets denied at construction',()=>{
 const opts=(changes={})=>({
  scope:{brandId:'starry',appId:owner,environment:'staging'},
  offers:[baseOffer],maxRequeryAgeSeconds:120,
  ports:{resolveTrustedPrincipal:async()=>null,
   readCommittedEntitlement:async()=>null,serverNowSeconds:()=>now},...changes,
 });
 assert.throws(()=>createSandboxCommercePolicy(opts({
  scope:{brandId:'hglobal',appId:owner,environment:'staging'},
 })),/COMMERCE_CONFIG_DENIED/);
 assert.throws(()=>createSandboxCommercePolicy(opts({
  scope:{brandId:'starry',appId:owner,environment:'production'},
 })),/COMMERCE_CONFIG_DENIED/);
 assert.throws(()=>createSandboxCommercePolicy(opts({
  offers:[baseOffer,baseOffer],
 })),/COMMERCE_CONFIG_DENIED/);
 assert.throws(()=>createSandboxCommercePolicy(opts({
  offers:[{...baseOffer,offerId:'starry.battery.paid'}],
 })),/COMMERCE_CONFIG_DENIED/);
 assert.throws(()=>createSandboxCommercePolicy(opts({
  offers:[{...baseOffer,allowedCrossAppIds:[owner]}],
 })),/COMMERCE_CONFIG_DENIED/);
});
test('Q102 restore is only a referral for official re-verification or human review',async()=>{
 const self=setup();
 const a=await self.policy.planRestoration({offerId:baseOffer.offerId});
 assert.equal(a.verdict,'store_requery_required');
 assert.equal(a.reason,'OFFICIAL_STORE_REVERIFICATION_REQUIRED');
 const offer={...baseOffer,restoration:'manual_review'};
 const b=await setup({offers:[offer]}).policy.planRestoration({offerId:offer.offerId});
 assert.equal(b.verdict,'manual_review_required');
 assert.equal(b.publishable,false);
 assert.equal(self.storeState.readCalls,0);
});
test('restore request cannot leak another account purchase or bind a new Starry user ID',async()=>{
 const x=setup({row:{...current,ownerUserId:'s_002'}});
 const a=await x.policy.planRestoration({offerId:baseOffer.offerId});
 const b=await setup({row:null}).policy.planRestoration({offerId:baseOffer.offerId});
 assert.deepEqual(a,b);
 assert.equal(x.storeState.readCalls,0);
 for(const forged of [{offerId:baseOffer.offerId,approved:true},
  {offerId:baseOffer.offerId,oldUserId:'s_002'},{offerId:baseOffer.offerId,storeReceipt:'forged'}])
  await assert.rejects(x.policy.planRestoration(forged),/COMMERCE_CLIENT_CLAIMS_DENIED/);
});
test('catalogue snapshot is insulated from later edits to the original registry',async()=>{
 const offer={...baseOffer,allowedCrossAppIds:['starry.beta']};
 const x=setup({appId:'starry.beta',offers:[offer]});
 offer.allowedCrossAppIds.push('starry.gamma');
 offer.skuByStore.apple='injected';
 assert.equal((await access(x)).verdict,'policy_candidate_only');
});
