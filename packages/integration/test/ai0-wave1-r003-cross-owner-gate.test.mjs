import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {R003_AUTHORITY_VERSION,R003_AUTHORITY_LIVE,
 createOfflineR003IdentityAuthorityPort} from '../../../modules/starry-id-v1/src/wave1-round003-identity-authority-port.ts';
import {AI1_R003_CONTRACT,AI2_R003_CONTRACT,AI2_R003_LIVE,
 createOfflineR003BillingStoreReview} from '../../rebuild-billing/src/wave1-r003-canonical-identity-store-review.ts';
import {R003_P05_ACK_CONTRACT,R003_LIVE_ENABLED,reviewR003CommitBeforeAck}
 from '../../rebuild-ai3/src/wave1-r003-p05-ack-interop.ts';
import {R003_UPSTREAM_CANDIDATES,R003_REVIEW_ONLY,
 R003_P05_ORDER,reviewR003QueueSequence,proposeR003PublicError}
 from '../../../apps/api/src/wave1-r003-protected-interop.ts';

const read=path=>readFileSync(new URL('../../../'+path,import.meta.url));
const manifest=JSON.parse(read('docs/operations/ai0-wave1-r003-owner-blobs.v1.json').toString());
const q4=JSON.parse(read('docs/operations/ai0-q4-admob-owner-approved.v1.json').toString());

test('AI-0 R003 4 owner x 3 files are immutable original Git blob bytes',()=>{
 assert.equal(manifest.owners.length,4);
 const seen=new Set();
 for(const o of manifest.owners){
  assert.equal(o.files.length,3,o.owner);
  for(const f of o.files){
   assert.equal(seen.has(f.path),false,f.path);seen.add(f.path);
   const b=read(f.path);
   const sha=createHash('sha1').update(Buffer.from('blob '+b.length+'\\0')).update(b).digest('hex');
   assert.equal(sha,f.blob_sha,f.path);
  }
 }
 assert.equal(seen.size,12);
});

test('real AI-1 R003 authority source has exact AI-2 R003 provider contract',()=>{
 assert.equal(R003_AUTHORITY_VERSION,AI1_R003_CONTRACT);
 assert.equal(manifest.contracts.AI1,R003_AUTHORITY_VERSION);
 assert.equal(manifest.contracts.AI2,AI2_R003_CONTRACT);
 assert.equal(R003_AUTHORITY_LIVE,false);
 assert.equal(AI2_R003_LIVE,false);
});

test('actual AI1 source composed with AI2 reviewer rejects absent signed Session BEFORE Store read',async()=>{
 const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
 let authSqlReads=0,storeReads=0,keys=0;
 const auth=createOfflineR003IdentityAuthorityPort({
  enabled:true,serverScope:scope,expectedOrigin:'https://starry.invalid/',
  authDb:{prepare(){authSqlReads++;throw Error('No real Auth D1 in this test');}},
  getVerificationKey:async()=>{keys++;return null;},
  readActiveDigestKey:async()=>{keys++;return null;}
 });
 const inspect=createOfflineR003BillingStoreReview({
  enabled:true,scope,identity:auth,nowSeconds:()=>1793000000,
  products:[{product_key:'pro.month',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH',
   sku_ios:'one.ios.month',sku_android:'one.android.month'}],
  readUnverifiedStoreProbe:async()=>{storeReads++;throw Error('must not read Store');}
 });
 const intent={...scope,flow_ref:'A'.repeat(48)};
 for(const request of [null,{},new Request('https://starry.invalid/',{method:'GET'})]){
  const r=await inspect.inspect(request,intent,'pro.month','ios');
  assert.equal(r.status,'blocked');assert.equal(r.can_grant,false);
  assert.equal(r.official_store_verified,false);
  assert.equal(r.live,false);assert.equal(r.can_start_purchase,false);
 }
 assert.equal(storeReads,0);
 assert.equal(authSqlReads,0);
 assert.equal(keys,0);
});

test('AI-2 rejects spoofed structural UI claims rather than calling Store',async()=>{
 const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
 const identity=createOfflineR003IdentityAuthorityPort({
  enabled:false,serverScope:scope,expectedOrigin:'https://starry.invalid/',
  authDb:{prepare(){throw Error('must not query Auth');}},
  getVerificationKey:async()=>null,readActiveDigestKey:async()=>null
 });
 let reads=0;
 const billing=createOfflineR003BillingStoreReview({
  enabled:true,scope,identity,
  products:[{product_key:'pro.buyout',kind:'NON_CONSUMABLE',period:null,
   sku_ios:'one.ios.buyout',sku_android:'one.android.buyout'}],
  nowSeconds:()=>1793000000,
  readUnverifiedStoreProbe:async()=>{reads++;return {status:'active',verified:true};}
 });
 const r=await billing.inspect({isLoggedIn:true},
  {...scope,flow_ref:'A'.repeat(48)},'pro.buyout','ios');
 assert.equal(r.status,'blocked');assert.equal(reads,0);
 assert.equal(r.can_grant,false);assert.equal(r.can_remove_ads,false);
});

test('AI3 P05 and AI4 Queue contract alignment does not authorize ACK',()=>{
 assert.equal(R003_UPSTREAM_CANDIDATES.auth,R003_AUTHORITY_VERSION);
 assert.equal(R003_UPSTREAM_CANDIDATES.p05,R003_P05_ACK_CONTRACT);
 assert.equal(R003_LIVE_ENABLED,false);
 assert.equal(R003_REVIEW_ONLY.queue_ack_authorized,false);
 assert.equal(R003_REVIEW_ONLY.protected_routes_registered,false);
 const sequence=reviewR003QueueSequence({
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  event_ref:'event_ref_12345',actor_ref:'actor_ref_12345',
  stages:[...R003_P05_ORDER]
 });
 assert.equal(sequence.reason,'GATE_NOT_AUTHORIZED');
 assert.equal(sequence.authorized,false);
 assert.equal(sequence.may_ack_queue,false);
 const p05=reviewR003CommitBeforeAck({
  scope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},
  event:{signature_verified:true},before:{},after:{}
 });
 assert.equal(p05.status,'blocked');assert.equal(p05.may_ack_queue,false);
 const err=proposeR003PublicError(503);
 assert.equal(err.may_dispatch,false);
 assert.equal(JSON.stringify(err).includes('token'),false);
});

test('latest Q4=A AdMob approval stays OFF and formal Gates are BLOCKED',()=>{
 assert.equal(q4.current.Q4,'A');
 assert.equal(q4.current.provider_key,'google-admob-mediation');
 for(const k of ['ads_enabled','sdk_install_authorized','sdk_initialized',
  'ad_requests_authorized','ad_unit_creation_authorized','production_change_authorized'])
  assert.equal(q4.current[k],false,k);
 assert.equal(manifest.gate1.status,'PARTIAL_BLOCKED');
 assert.equal(manifest.gate3.status,'BLOCKED');
 assert.equal(manifest.gate3.release_gates_blocked,11);
 assert.equal(manifest.gate3.main_merge_authorized,false);
 assert.equal(manifest.gate3.live_deploy_authorized,false);
});
