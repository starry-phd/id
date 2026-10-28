import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {R004_SESSION_FENCE_VERSION,R004_SESSION_FENCE_LIVE,createOfflineR004EventBoundSessionFence}
 from '../../../modules/starry-id-v1/src/wave1-round004-event-session-fence.ts';
import {R004_BILLING_CONTINUITY,R004_BILLING_LIVE,createOfflineR004EntitlementReview}
 from '../../rebuild-billing/src/wave1-r004-entitlement-continuity-review.ts';
import {R004_P05_HANDSHAKE,R004_P05_LIVE,R004_SIBLING_CONTRACTS,reviewR004P05Handshake}
 from '../../rebuild-ai3/src/wave1-r004-p05-canonical-claim-handshake.ts';
import {R004_VERSION,R004_ADS_DEFAULTS,reviewR004AdMobActivation}
 from '../../../apps/api/src/wave1-r004-admob-offline-gate.ts';
import {R003_AUTHORITY_VERSION,createOfflineR003IdentityAuthorityPort}
 from '../../../modules/starry-id-v1/src/wave1-round003-identity-authority-port.ts';
import {AI2_R003_CONTRACT}
 from '../../rebuild-billing/src/wave1-r003-canonical-identity-store-review.ts';

const read=p=>readFileSync(new URL('../../../'+p,import.meta.url));
const m=JSON.parse(read('docs/operations/ai0-wave1-r004-owner-blobs.v1.json').toString());
const q4=JSON.parse(read('docs/operations/ai0-q4-admob-owner-approved.v1.json').toString());
test('R004 four owners import twelve immutable Git Blob byte originals',()=>{
 assert.equal(m.owners.length,4);
 const paths=new Set();
 for(const owner of m.owners){
  assert.equal(owner.files.length,3,owner.owner);
  for(const f of owner.files){
   assert.equal(paths.has(f.path),false,f.path);paths.add(f.path);
   const b=read(f.path);
   const sha=createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
   assert.equal(sha,f.blob_sha,f.path);
  }
 }
 assert.equal(paths.size,12);
});
test('R004 actual cross-owner version pins are aligned, never Live',()=>{
 assert.equal(m.contract_versions.AI1,R004_SESSION_FENCE_VERSION);
 assert.equal(m.contract_versions.AI2,R004_BILLING_CONTINUITY);
 assert.equal(m.contract_versions.AI3,R004_P05_HANDSHAKE);
 assert.equal(m.contract_versions.AI4,R004_VERSION);
 assert.equal(R004_SESSION_FENCE_LIVE,false);
 assert.equal(R004_BILLING_LIVE,false);
 assert.equal(R004_P05_LIVE,false);
 assert.equal(R004_SIBLING_CONTRACTS.auth,R003_AUTHORITY_VERSION);
 assert.equal(R004_SIBLING_CONTRACTS.transport,'starry.ai4.wave1.r003.protected-interop.v1-offline-candidate');
 assert.equal(AI2_R003_CONTRACT,'starry.billing.r003.auth-store-fence.v1-candidate');
});
test('real AI1 R004 event session fence fails closed without canonical signer before any DB read',async()=>{
 const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
 let sql=0,keys=0,actors=0,epochs=0;
 const fence=createOfflineR004EventBoundSessionFence({
  enabled:true,serverScope:scope,expectedOrigin:'https://starry.invalid/',
  authDb:{prepare(){sql++;throw Error('DB must not be read');}},
  getVerificationKey:async()=>{keys++;return null;},
  readActiveDigestKey:async()=>{keys++;return null;},
  verifyCanonicalSource:async()=>null,
  resolveEventActor:async()=>{actors++;return null;},
  readSessionEpoch:async()=>{epochs++;return null;}
 });
 const r=await fence.readEventBoundCurrentSession({signature_verified:true},null,1793000000);
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'INVALID_SOURCE');
 assert.equal(r.may_send,false);assert.equal(r.may_ack_queue,false);
 assert.equal(fence.readServerFence(r),null);
 assert.equal(sql,0);assert.equal(keys,0);assert.equal(actors,0);assert.equal(epochs,0);
});
test('actual R003 Auth paired with R004 Billing never accepts UI self-login or probes Store',async()=>{
 const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
 let authReads=0,claims=0,store=0;
 const auth=createOfflineR003IdentityAuthorityPort({
  enabled:false,serverScope:scope,expectedOrigin:'https://starry.invalid/',
  authDb:{prepare(){authReads++;throw Error('no DB');}},
  getVerificationKey:async()=>null,
  readActiveDigestKey:async()=>null
 });
 const review=createOfflineR004EntitlementReview({
  enabled:true,scope,identity:auth,
  plan:{app_id:scope.app_id,mode:'buyout',
   products:[{product_key:'pro.buyout',kind:'NON_CONSUMABLE',period:null,features:['ads_free']}],
   adsProviderSelection:'google-admob-mediation',adsEnabled:false,adsSdkInitialized:false,adRequestsEnabled:false},
  nowSeconds:()=>1793000000,
  reviewerForProduct:()=>{claims++;return {
   contract:AI2_R003_CONTRACT,inspect:async()=>{store++;throw Error('no Store');}
  }}
 });
 const r=await review.inspect({loggedIn:true},{...scope,flow_ref:'A'.repeat(48)},'ios');
 assert.equal(r.status,'blocked');
 assert.equal(r.can_grant,false);assert.equal(r.can_remove_ads,false);
 assert.equal(r.can_request_ads,false);assert.equal(r.adsEnabled,false);
 assert.equal(r.actual_identity_provider_integrated,false);
 assert.equal(store,0);assert.equal(claims,0);assert.equal(authReads,0);
});
test('AI3 P05 and AI4 AdMob never authorize Queue ACK, ads requests or paid Battery',()=>{
 const r=reviewR004P05Handshake({scope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},
  event:{signature_verified:true},before:{},after:{}});
 assert.equal(r.state,'blocked');
 assert.equal(r.may_ack,false);assert.equal(r.may_sell_battery,false);
 assert.equal(r.live,false);
 const a=reviewR004AdMobActivation({
  brand_id:'starry',app_id:'starry-demo',entitlement_app_id:'starry-demo',
  environment:'staging',adsProviderSelection:'google-admob-mediation',
  adsEnabled:false,adsSdkInitialized:false,adRequestsEnabled:false,
  admobAppId:null,adUnitId:null,paidResourcesEnabled:false
 });
 assert.equal(a.status,'blocked');assert.equal(a.reason,'OWNER_GATE_REQUIRED');
 assert.equal(a.may_request_ad,false);assert.equal(a.may_initialize_sdk,false);
 assert.equal(a.may_deploy,false);
});
test('Q4=A is provider-only and all release/expense gates remain blocked',()=>{
 assert.equal(q4.current.provider,'Google AdMob Mediation');
 assert.equal(q4.current.Q4,'A');
 assert.equal(R004_ADS_DEFAULTS.adsProviderSelection,q4.current.provider_key);
 assert.equal(R004_ADS_DEFAULTS.adsEnabled,false);
 assert.equal(R004_ADS_DEFAULTS.activationGateAuthorized,false);
 assert.equal(m.admob.Q4,'A');assert.equal(m.admob.ads_on,false);
 assert.equal(m.gate1.state,'PARTIAL_BLOCKED');
 assert.equal(m.gate3.state,'BLOCKED');
 assert.equal(m.gate3.release_g00_g10_blocked,11);
 for(const k of ['main_merge_allowed','live_deployment_allowed','actual_store_billing_authorized',
 'cloudflare_preview_authorized','ads_enabled','admob_sdk_install_authorized',
 'paid_resources_authorized','consumer_private_monorepo_creation_authorized'])
 assert.equal(m.gate3[k],false,k);
 assert.equal(m.battery.permanently_free,true);
});
