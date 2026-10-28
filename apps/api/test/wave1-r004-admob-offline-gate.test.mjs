import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {handleRequest} from '../src/index.ts';
import {R003_PROPOSED_HTTP, R003_REVIEW_ONLY} from '../src/wave1-r003-protected-interop.ts';
import {R004_VERSION, R004_ADS_DEFAULTS, reviewR004AdMobActivation} from '../src/wave1-r004-admob-offline-gate.ts';

const fixture = (p = {}) => ({
  brand_id: 'starry', app_id: 'starry-first', entitlement_app_id: 'starry-first',
  environment: 'development', adsProviderSelection: 'google-admob-mediation',
  adsEnabled: false, adsSdkInitialized: false, adRequestsEnabled: false,
  admobAppId: null, adUnitId: null, paidResourcesEnabled: false, ...p
});
function blocked(out, reason) {
  assert.equal(out.version, R004_VERSION);
  assert.equal(out.reason, reason);
  assert.equal(out.status, 'blocked');
  assert.equal(out.evidence, 'untrusted_offline_only');
  for (const f of ['may_initialize_sdk', 'may_request_ad', 'may_create_ad_unit',
    'may_create_account', 'may_pay', 'may_remove_ads', 'may_deploy',
    'may_store_submit', 'publishable']) assert.equal(out[f], false);
  assert.ok(Object.isFrozen(out));
}
test('Q4=A selects only AdMob, not its SDK or activation', () => {
  assert.equal(R004_ADS_DEFAULTS.adsProviderSelection, 'google-admob-mediation');
  assert.equal(R004_ADS_DEFAULTS.providerSelectionApproved, true);
  for (const [k, v] of Object.entries(R004_ADS_DEFAULTS))
    if (k !== 'adsProviderSelection' && k !== 'providerSelectionApproved')
      assert.equal(v, false);
  assert.ok(Object.isFrozen(R004_ADS_DEFAULTS));
});
test('even fully benign future configuration is gate-blocked', () =>
  blocked(reviewR004AdMobActivation(fixture()), 'OWNER_GATE_REQUIRED'));
test('other App remove-ads entitlement never crosses App boundary', () => {
  blocked(reviewR004AdMobActivation(fixture({entitlement_app_id:'starry-second'})),
    'CROSS_APP_ENTITLEMENT_DENIED');
  blocked(reviewR004AdMobActivation(fixture({app_id:'starry-second'})),
    'CROSS_APP_ENTITLEMENT_DENIED');
  blocked(reviewR004AdMobActivation(fixture({
    app_id:'starry-second', entitlement_app_id:'starry-second'
  })), 'OWNER_GATE_REQUIRED');
});
test('old vendor-undecided and alternative providers are rejected', () => {
  for (const provider of ['Q4=D','undecided','applovin-max','unity-levelplay'])
    blocked(reviewR004AdMobActivation(fixture({adsProviderSelection:provider})),
      'PROVIDER_MISMATCH');
});
test('any SDK initialization, actual request or Ads ON is rejected', () => {
  for (const k of ['adsEnabled','adsSdkInitialized','adRequestsEnabled'])
    blocked(reviewR004AdMobActivation(fixture({[k]:true})), 'ACTIVATION_NOT_AUTHORIZED');
});
test('real App/Unit IDs and paid capabilities are rejected', () => {
  for (const p of [{admobAppId:'id'},{adUnitId:'unit'},{paidResourcesEnabled:true}])
    blocked(reviewR004AdMobActivation(fixture(p)), 'ACTIVATION_NOT_AUTHORIZED');
});
test('Production cannot be activated via offline review', () =>
  blocked(reviewR004AdMobActivation(fixture({environment:'production'})),
    'PRODUCTION_BLOCKED'));
test('foreign brand and unsupported environments stay rejected', () => {
  for (const p of [{brand_id:'hglobal'}, {environment:'live-preview'},
    {app_id:'other',entitlement_app_id:'other'}])
    blocked(reviewR004AdMobActivation(fixture(p)), 'SCOPE_DENIED');
});
test('untrusted owner, consent, ad callback and proof claims do not execute', () => {
  let called=0;
  for (const p of [{signature_verified:true},{ownerApproved:true},
    {consentVerified:true},{initializeSdk(){called++;}},
    {requestAd(){called++;}},{removeAdsGranted:true}])
    blocked(reviewR004AdMobActivation(fixture(p)), 'INVALID_CANDIDATE');
  assert.equal(called,0);
});
test('accessors do not execute and invalid input fails closed', () => {
  let called=0;
  const p=fixture();
  Object.defineProperty(p,'adsEnabled',{enumerable:true,get(){called++;throw Error('bad');}});
  blocked(reviewR004AdMobActivation(p),'INVALID_CANDIDATE');
  assert.equal(called,0);
  for (const input of [null,{},[],false, Object.assign(Object.create({admin:true}), fixture()),
    fixture({adsEnabled:'false'}),fixture({admobAppId:undefined}),
    fixture({paidResourcesEnabled:'false'})])
    blocked(reviewR004AdMobActivation(input),'INVALID_CANDIDATE');
});
test('contract does not import an AdMob SDK or use networking', () => {
  const src=readFileSync(new URL('../src/wave1-r004-admob-offline-gate.ts',import.meta.url),'utf8');
  assert.doesNotMatch(src,/from\s+['"]react-native-google-mobile-ads/);
  assert.doesNotMatch(src,/from\s+['"]@react-native-firebase\/admob/);
  assert.doesNotMatch(src,/\bfetch\s*\(/);
  assert.doesNotMatch(src,/\bimport\s*\(/);
});
test('real OpenAPI is health-only; protected POSTs and P05 ACK remain blocked', async () => {
  const yaml=readFileSync(new URL('../openapi.yaml',import.meta.url),'utf8');
  assert.match(yaml,/^openapi: 3\.1\.0/m);
  assert.match(yaml,/^ {2}\/v1\/health:/m);
  assert.equal(R003_REVIEW_ONLY.queue_ack_authorized,false);
  const env={STARRY_ENVIRONMENT:'staging', STARRY_APP_ID:'starry-id'};
  assert.equal(handleRequest(new Request('https://starry.invalid/v1/health'),env).status,200);
  for (const route of R003_PROPOSED_HTTP) {
    assert.equal(yaml.includes(route.path),false);
    const r=handleRequest(new Request('https://starry.invalid'+route.path,
      {method:'POST'}),env);
    assert.equal(r.status,405);
    assert.doesNotMatch(await r.text(),/member_digest|secret|session_binding/i);
  }
});
