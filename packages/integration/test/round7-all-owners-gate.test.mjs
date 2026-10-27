import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStarryAdminAuthority} from '../../../modules/starry-id-v1/src/round7-admin.ts';
import {COMMERCE_PUBLISHABLE,createSandboxCommercePolicy} from '../../rebuild-billing/src/commerce-policy.ts';
import {LIVE_BATTERY_WRITES_ENABLED,BATTERY_PRICE,RESERVATION_TTL_MS,OVERDRAFT_MAX_USES,newWallet,registrationGrant} from '../../rebuild-ai3/src/free-battery.ts';
import {RELEASE_AUTHORIZED,STARRY_SERVICE_SCOPE,inspectStarryAccess,planStageOrder} from '../../../apps/api/src/staged-policy.ts';

// AI-0 R7: same-checkout cross-owner denial smoke. This is NOT a live integration
// test of Store, OAuth, D1, Queue, Worker, App Store or H-Global.
test('R7 every owner stays nonpublishable even after all offline stage passes',()=>{
  assert.equal(COMMERCE_PUBLISHABLE,false);
  assert.equal(LIVE_BATTERY_WRITES_ENABLED,false);
  assert.equal(RELEASE_AUTHORIZED,false);
  assert.equal(STARRY_SERVICE_SCOPE.cross_brand_sync_enabled,false);
  assert.equal(STARRY_SERVICE_SCOPE.standalone_store_app,false);
  assert.equal(STARRY_SERVICE_SCOPE.advertisements_enabled,false);
  const plan=planStageOrder({identity:'offline_pass',battery:'offline_pass',billing:'offline_pass'});
  assert.deepEqual(plan.ready_for_review,['identity','battery','billing']);
  assert.equal(plan.release_authorized,false);
  for(const operation of ['identity','battery','billing','admin','cross_brand']){
    const decision=inspectStarryAccess({brand_id:'starry',app_id:'starry-id',environment:'development',operation,auth_service_available:true});
    assert.equal(decision.allowed,false,operation);
    assert.equal(decision.live_deployment,false,operation);
  }
  assert.equal(inspectStarryAccess({brand_id:'starry',app_id:'starry-id',environment:'development',operation:'public_health',auth_service_available:false}).allowed,true);
});

test('R7 client forged admin principal is rejected before sensitive Battery adjustment',async()=>{
  const admin=createOfflineStarryAdminAuthority({enabled:true,
    scope:{brand_id:'starry',app_id:'starry-id',environment:'development'},
    db:{prepare(){throw new Error('DB must not be consulted for forged principal');}},
    readCurrentSession:async()=>null});
  const result=await admin.permit({brand_id:'starry',member_status:'active',
    app_id:'starry-id',environment:'development',s_user_id:'fake-user',
    role:'supreme',step_up_method:'totp'},'battery:adjust',1793000000);
  assert.equal(result,false);
});

test('R7 paid Battery SKU can never be minted through Commerce offer registry',()=>{
  assert.equal(BATTERY_PRICE,'permanently_free');
  assert.equal(RESERVATION_TTL_MS,180000);
  assert.equal(OVERDRAFT_MAX_USES,2);
  assert.throws(()=>createSandboxCommercePolicy({
    scope:{brandId:'starry',appId:'starry-id',environment:'development'},
    maxRequeryAgeSeconds:60,
    offers:[{offerId:'StarryBattery',ownerAppId:'starry-id',kind:'one_time',
      skuByStore:{apple:'batterySku'},storeAppIdByStore:{apple:'starry.store'},
      allowCrossPlatform:false,allowedCrossAppIds:[],restoration:'manual_review',enabledForSandbox:true}],
    ports:{resolveTrustedPrincipal:async()=>null,readCommittedEntitlement:async()=>null,
      serverNowSeconds:()=>1793000000},
  }),/COMMERCE_CONFIG_DENIED/);
});

test('R7 Battery cannot grant registration balance without server-verifying authority',async()=>{
  const wallet=newWallet({brand_id:'starry',member_ref:'example_member'});
  const policy={brand_id:'starry',version:1,registration_grant:10,first_task_grant:20,max_debt:10,
    max_task_cost:2,rates:[{app_id:'starry-id',task_type:'sample_task',price:2,version:1}]};
  const badAuthority={authorizePolicy:async()=>true,verifyMemberActive:async()=>true,
    verifyRegistrationGrant:async()=>false};
  await assert.rejects(registrationGrant(wallet,policy,badAuthority,1793000000000),/AI3_BATTERY_REGISTRATION_GATE/);
  assert.equal(wallet.balance,0);
});
