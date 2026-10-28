import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AI0_R005_P05_VERSION,AI0_R005_P05_LIVE,createOfflineR005P05CanonicalVerifier} from '../src/ai0-r005-p05-canonical-offline-verifier.ts';
import {R005_ENVELOPE_AUTH_VERSION,R005_ENVELOPE_AUTH_LIVE,r005EnvelopeSigningBytes} from '../../../modules/starry-id-v1/src/wave1-round005-sealed-event-session-authority.ts';
import {R005_CROSS_OS_CONTRACT,R005_CROSS_OS_LIVE,createOfflineR005CrossOsReview} from '../../rebuild-billing/src/wave1-r005-cross-os-signed-auth-review.ts';
import {R005_VERSION,R005_OFFLINE_ONLY,reviewR005NativeAdMobConsent} from '../../../apps/api/src/wave1-r005-admob-native-consent-gate.ts';
import {R003_AUTHORITY_VERSION,createOfflineR003IdentityAuthorityPort} from '../../../modules/starry-id-v1/src/wave1-round003-identity-authority-port.ts';
const read=p=>readFileSync(new URL('../../../'+p,import.meta.url));
const m=JSON.parse(read('docs/operations/ai0-wave1-r005-owner-blobs.v1.json').toString());
const ads=JSON.parse(read('docs/operations/ai0-q4-admob-owner-approved.v1.json').toString());
test('R005 original twelve Git blobs remain byte-for-byte unchanged',()=>{
 assert.equal(m.owners.length,4);
 const paths=new Set();
 for(const o of m.owners){
  assert.equal(o.files.length,3,o.owner);
  for(const f of o.files){
   assert.equal(paths.has(f.path),false,f.path);paths.add(f.path);
   const b=read(f.path);
   const sha=createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
   assert.equal(sha,f.blob_sha,f.path);
  }
 }
 assert.equal(paths.size,12);
});
test('AI0 vs AI1 P05 canonical domains differ, no implied live cross-trust',()=>{
 assert.equal(AI0_R005_P05_LIVE,false);
 assert.equal(R005_ENVELOPE_AUTH_LIVE,false);
 assert.equal(m.contracts.ai0_p05,AI0_R005_P05_VERSION);
 assert.equal(m.contracts.ai1_p05,R005_ENVELOPE_AUTH_VERSION);
 assert.notEqual(AI0_R005_P05_VERSION,R005_ENVELOPE_AUTH_VERSION);
 const ai0=read('packages/integration/src/ai0-r005-p05-canonical-offline-verifier.ts').toString();
 const ai1=read('modules/starry-id-v1/src/wave1-round005-sealed-event-session-authority.ts').toString();
 assert.ok(ai0.includes('payload_sha256'));assert.ok(ai0.includes('signature_hex'));
 assert.ok(ai1.includes('session_version'));assert.ok(ai1.includes('expires_at'));
 assert.ok(ai1.includes('starry.auth.r005.p05:synthetic-envelope:v1'));
 assert.equal(r005EnvelopeSigningBytes({signature_verified:true}),null);
 assert.ok(m.gate1.blocks.includes('AI0_AI1_P05_CANONICAL_DIALECT_MISMATCH_INPUT_SCHEMA_DOMAIN_SEPARATION'));
});
test('real AI0 verifier rejects invented AI1 envelope and client signature_verified flag',async()=>{
 let keyReads=0;
 const v=createOfflineR005P05CanonicalVerifier({
  enabled:true,scope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},
  nowSeconds:()=>1793200000,
  readVerificationKey:async()=>{keyReads++;throw Error('must not read key');}
 });
 for(const x of [{envelope:{signature_verified:true},mac:'a'.repeat(64)},
  {event:{signature_verified:true},signature_hex:'a'.repeat(64)}]){
  const r=await v.review(x);
  assert.equal(r.status,'blocked');assert.equal(r.may_ack_queue,false);
  assert.equal(r.may_send,false);assert.equal(r.live,false);
 }
 assert.equal(keyReads,0);
});
test('real AI1 identity source with AI2 R005 rejects spoofed cross-OS Store claims',async()=>{
 const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
 let probes=0,sql=0;
 const identity=createOfflineR003IdentityAuthorityPort({
  enabled:false,serverScope:scope,expectedOrigin:'https://starry.invalid/',
  authDb:{prepare(){sql++;throw Error('no D1');}},
  getVerificationKey:async()=>null,readActiveDigestKey:async()=>null
 });
 const fake={contract:'starry.billing.r004.entitlement-continuity.v1-candidate',
  inspect:async()=>{probes++;return {status:'review_only',can_grant:true};}};
 const v=createOfflineR005CrossOsReview({enabled:true,scope,identity,ios:fake,android:fake,nowSeconds:()=>1793200000});
 const intent={...scope,flow_ref:'A'.repeat(48)};
 const r=await v.inspect({loggedIn:true},intent,{loggedIn:true},intent);
 assert.equal(r.status,'blocked');assert.equal(r.can_grant,false);
 assert.equal(r.can_restore,false);assert.equal(r.can_request_ads,false);
 assert.equal(r.official_revenuecat_verified,false);
 assert.equal(sql,0);assert.equal(probes,0);
 assert.equal(R003_AUTHORITY_VERSION,'starry.auth.identity-authority.r003.v1-candidate');
 assert.equal(R005_CROSS_OS_LIVE,false);
 assert.equal(m.contracts.ai2,R005_CROSS_OS_CONTRACT);
});
test('AI4 AdMob UMP and ATT claims still cannot authorize SDK/ads',()=>{
 const r=reviewR005NativeAdMobConsent({
  brand_id:'starry',app_id:'starry-demo',entitlement_app_id:'starry-demo',
  environment:'staging',platform:'ios',region:'eea',audience:'adult',
  ump_status:'granted',att_status:'authorized',
  adsEnabled:false,adsSdkInitialized:false,adRequestsEnabled:false,
  admobAppId:null,adUnitId:null,removeAdsClaim:false
 });
 assert.equal(r.state,'blocked');assert.equal(r.reason,'OWNER_GATE_REQUIRED');
 for(const k of ['sdk_init','request_ads','create_ad_unit','grant_purchase','deploy','publishable'])
  assert.equal(r[k],false,k);
 assert.equal(R005_OFFLINE_ONLY.provider_selection,'google-admob-mediation');
 assert.equal(ads.current.Q4,'A');assert.equal(m.contracts.ai4,R005_VERSION);
});
test('AI3 SQL receipt model simulated only, release/paid/ACK blocked',()=>{
 const python=read('packages/rebuild-ai3/src/wave1_r005_p05_sqlite_cas.py').toString();
 assert.ok(python.includes('sqlite3.connect(":memory:"'));
 assert.ok(python.includes('WITNESS_MUST_NOT_BE_PRIMARY_CONNECTION'));
 assert.ok(python.includes('may_ack: bool = False'));
 assert.ok(python.includes('may_sell_battery: bool = False'));
 assert.equal(m.gate3.g00_g10,11);
 for(const k of ['main_merge','deploy','store','paid_resources','ads_on','p05_publishable'])
  assert.equal(m.gate3[k],false,k);
 assert.equal(m.battery.purchasable,false);
});
