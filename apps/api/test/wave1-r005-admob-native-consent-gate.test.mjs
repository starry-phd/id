import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {handleRequest} from '../src/index.ts';
import {R004_ADS_DEFAULTS} from '../src/wave1-r004-admob-offline-gate.ts';
import {R004_SESSION_FENCE_VERSION} from '../../../modules/starry-id-v1/src/wave1-round004-event-session-fence.ts';
import {R004_BILLING_CONTINUITY} from '../../../packages/rebuild-billing/src/wave1-r004-entitlement-continuity-review.ts';
import {R004_P05_HANDSHAKE} from '../../../packages/rebuild-ai3/src/wave1-r004-p05-canonical-claim-handshake.ts';
import {
  R005_VERSION,R005_OWNER_PINS,R005_OFFLINE_ONLY,
  R005_CROSS_OWNER_LIVE,R005_PROTECTED_ROUTE_PINS,
  reviewR005NativeAdMobConsent,proposeR005ProtectedError
} from '../src/wave1-r005-admob-native-consent-gate.ts';
const fixture=(patch={})=>({
  brand_id:'starry',app_id:'starry-first',entitlement_app_id:'starry-first',
  environment:'development',platform:'ios',region:'eea',audience:'adult',
  ump_status:'granted',att_status:'authorized',adsEnabled:false,
  adsSdkInitialized:false,adRequestsEnabled:false,admobAppId:null,
  adUnitId:null,removeAdsClaim:false,...patch
});
function blocked(r,reason){
  assert.equal(r.contract,R005_VERSION);
  assert.equal(r.state,'blocked');assert.equal(r.reason,reason);
  assert.equal(r.evidence_level,'synthetic_untrusted_not_native');
  for(const f of ['sdk_init','request_ads','create_ad_unit','modify_entitlement',
    'grant_purchase','ack_queue','write_database','deploy','publishable'])
    assert.equal(r[f],false);
  assert.ok(Object.isFrozen(r));
}
test('R005 pins actual AI1/AI2/AI3/AI4 R004 source versions in SAME checkout',()=>{
  assert.equal(R005_OWNER_PINS.auth,R004_SESSION_FENCE_VERSION);
  assert.equal(R005_OWNER_PINS.billing,R004_BILLING_CONTINUITY);
  assert.equal(R005_OWNER_PINS.p05,R004_P05_HANDSHAKE);
  assert.equal(R005_OWNER_PINS.ads,'starry.ai4.r004.admob-ads-off.v1-candidate');
  assert.equal(R005_OFFLINE_ONLY.provider_selection,'google-admob-mediation');
  assert.equal(R004_ADS_DEFAULTS.adsEnabled,false);
  assert.ok(Object.isFrozen(R005_OWNER_PINS));
});
test('native/consent/Store/queue/runtime always OFF across owner modules',()=>{
  for(const [k,v] of Object.entries(R005_OFFLINE_ONLY))
    if(k!=='provider_selection')assert.equal(v,false,k);
  assert.deepEqual(Object.values(R005_CROSS_OWNER_LIVE),[false,false,false,false]);
});
test('perfect-looking iOS UMP and ATT status is still not authorization',()=>{
  blocked(reviewR005NativeAdMobConsent(fixture()),'OWNER_GATE_REQUIRED');
});
test('correct-looking Android, other region and app scope still blocked',()=>{
  blocked(reviewR005NativeAdMobConsent(fixture({
    platform:'android',att_status:'not_applicable',region:'other'
  })),'OWNER_GATE_REQUIRED');
});
test('turning Ads ON, initializing native SDK or requesting ads is forbidden',()=>{
  for(const k of ['adsEnabled','adsSdkInitialized','adRequestsEnabled'])
    blocked(reviewR005NativeAdMobConsent(fixture({[k]:true})),
      'SDK_OR_REQUEST_FORBIDDEN');
});
test('App IDs and AdUnit IDs are forbidden before owner activation',()=>{
  for(const p of [{admobAppId:'not-authorized'},{adUnitId:'not-authorized'}])
    blocked(reviewR005NativeAdMobConsent(fixture(p)),
      'NATIVE_APP_OR_UNIT_ID_FORBIDDEN');
});
test('App A remove-ads state may not confer App B rights',()=>{
  blocked(reviewR005NativeAdMobConsent(fixture({
    entitlement_app_id:'starry-other'
  })),'CROSS_APP_ENTITLEMENT');
  blocked(reviewR005NativeAdMobConsent(fixture({
    app_id:'starry-other'
  })),'CROSS_APP_ENTITLEMENT');
});
test('synthetic remove-ads entitlement claims are not Store authority',()=>{
  blocked(reviewR005NativeAdMobConsent(fixture({
    removeAdsClaim:true
  })),'REMOVE_ADS_CLAIM_NOT_AUTHORITY');
});
test('child, unknown age and unknown region do not pass policy gate',()=>{
  for(const p of [{audience:'child'},{audience:'unknown'},{region:'unknown'}])
    blocked(reviewR005NativeAdMobConsent(fixture(p)),
      'UNDERAGE_OR_UNKNOWN_POLICY');
});
test('UMP denied, not-requested, ATT denied or not-requested block',()=>{
  for(const p of [{ump_status:'denied'},{ump_status:'not_requested'},
    {att_status:'denied'},{att_status:'not_requested'}])
    blocked(reviewR005NativeAdMobConsent(fixture(p)),'UMP_ATT_NOT_AUTHORITY');
});
test('unsupported consent values never become positive from caller',()=>{
  for(const p of [{ump_status:'server_verified'},{att_status:'true'}])
    blocked(reviewR005NativeAdMobConsent(fixture(p)),'INVALID_CANDIDATE');
});
test('Production, foreign ecosystem and malformed platform denied',()=>{
  blocked(reviewR005NativeAdMobConsent(fixture({environment:'production'})),
    'PRODUCTION_DISABLED');
  for(const p of [{brand_id:'hglobal'},{environment:'preview'},
    {platform:'web'},{app_id:'external',entitlement_app_id:'external'}])
    blocked(reviewR005NativeAdMobConsent(fixture(p)),'SCOPE_DENIED');
});
test('untrusted privileged claims, callbacks and getters have no effect',()=>{
  let called=0;
  for(const p of [{ownerApproved:true},{signature_verified:true},
    {canRequestAds:true},{initializeSdk(){called++;}},
    {storeVerified:true},{ackQueue(){called++;}}])
    blocked(reviewR005NativeAdMobConsent(fixture(p)),'INVALID_CANDIDATE');
  const injected=fixture();
  Object.defineProperty(injected,'ump_status',{enumerable:true,get(){
    called++;throw Error('unsafe');
  }});
  blocked(reviewR005NativeAdMobConsent(injected),'INVALID_CANDIDATE');
  assert.equal(called,0);
});
test('null, inherited, wrong types and incomplete candidate fail closed',()=>{
  for(const x of [null,42,{},[],Object.assign(Object.create({admin:true}),fixture()),
    fixture({adsEnabled:'false'}),fixture({removeAdsClaim:'true'}),
    fixture({adUnitId:undefined}),fixture({platform:4})])
    blocked(reviewR005NativeAdMobConsent(x),'INVALID_CANDIDATE');
});
test('SDK protected errors never return 2xx or caller identifiers',()=>{
  for(const s of [400,401,403,404,405,409,503]){
    const x=proposeR005ProtectedError(s);
    assert.equal(x.contract,R005_VERSION);
    assert.equal(x.status,s);
    assert.equal(x.body.error.message,'Operation unavailable');
    for(const f of ['may_dispatch','may_grant','may_charge','may_send','may_ack'])
      assert.equal(x[f],false);
    assert.ok(Object.isFrozen(x));
  }
  for(const v of [200,201,204,302,-1,NaN,Infinity,'200',null,
    {authorization:'Bearer secret',member_id:'private'}]){
    const x=proposeR005ProtectedError(v);
    assert.equal(x.status,503);
    assert.doesNotMatch(JSON.stringify(x),/private|Bearer|session_binding|member_id/i);
  }
});
test('3 actual protected paths stay unregistered; real Worker health only',async()=>{
  const yaml=readFileSync(new URL('../openapi.yaml',import.meta.url),'utf8');
  assert.match(yaml,/^ {2}\/v1\/health:/m);
  const env={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
  assert.equal(handleRequest(new Request('https://starry.invalid/v1/health'),env).status,200);
  assert.equal(R005_PROTECTED_ROUTE_PINS.length,3);
  for(const route of R005_PROTECTED_ROUTE_PINS){
    assert.equal(route.method,'POST');assert.equal(route.has_worker_route,false);
    assert.equal(route.state,'PROPOSED_NOT_REGISTERED');
    assert.equal(yaml.includes(route.path),false);
    const res=handleRequest(new Request('https://starry.invalid'+route.path,
      {method:'POST'}),env);
    assert.equal(res.status,405);
    assert.doesNotMatch(await res.text(),/member_digest|session_binding|token/i);
  }
});
test('source does not import native AdMob/consent module, fetch or SDK initializer',()=>{
  const src=readFileSync(new URL('../src/wave1-r005-admob-native-consent-gate.ts',import.meta.url),'utf8');
  assert.doesNotMatch(src,/from\s+['"]react-native-google-mobile-ads/);
  assert.doesNotMatch(src,/from\s+['"]expo-tracking-transparency/);
  assert.doesNotMatch(src,/\bfetch\s*\(/);
  assert.doesNotMatch(src,/\bmobileAds\s*\(/);
  assert.doesNotMatch(src,/\bimport\s*\(/);
});
