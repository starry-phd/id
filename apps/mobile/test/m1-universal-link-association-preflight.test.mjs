import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 checkM1UniversalLinkAssociationPreflight,
 M1_LINK_ASSOCIATION_PREFLIGHT_LIVE,
} from '../src/m1-universal-link-association-preflight.ts';
const path='/oauth/complete';
const host='stage.starry.invalid';
const uri='https://'+host+path;
const fingerprint=Array.from({length:32},()=> 'AB').join(':');
const fixture=()=>({
 appReturnUri:uri,
 iosTeamId:'A1B2C3D4E5',
 iosBundleId:'phd.starry.id.dev',
 androidPackageName:'phd.starry.id.dev',
 androidSigningCertSha256:fingerprint,
 expoConfig:{expo:{
  ios:{bundleIdentifier:'phd.starry.id.dev',associatedDomains:['applinks:'+host]},
  android:{package:'phd.starry.id.dev',intentFilters:[{
   action:'VIEW',autoVerify:true,category:['BROWSABLE','DEFAULT'],
   data:[{scheme:'https',host,path}],
  }]},
 }},
 appleAppSiteAssociation:{applinks:{details:[{
  appID:'A1B2C3D4E5.phd.starry.id.dev',paths:[path],
 }]}},
 androidAssetLinks:[{relation:['delegate_permission/common.handle_all_urls'],
  target:{namespace:'android_app',package_name:'phd.starry.id.dev',
   sha256_cert_fingerprints:[fingerprint]}}],
});
const run=(changes={})=>checkM1UniversalLinkAssociationPreflight({...fixture(),...changes});
test('static association match is NOT device, HTTPS or release proof, and always OFF',()=>{
 const result=run();
 assert.equal(M1_LINK_ASSOCIATION_PREFLIGHT_LIVE,false);
 assert.equal(result.source_config_consistent,true);
 assert.deepEqual(result.reasons,[]);
 for(const field of ['live_enabled','remote_https_verified','ios_device_verified',
  'android_device_verified','release_gate_satisfied'])assert.equal(result[field],false);
});
test('current Expo54 checked-in app has no iOS/Android association and must fail closed',()=>{
 const current=JSON.parse(readFileSync(new globalThis.URL('../app.json',import.meta.url),'utf8'));
 const result=run({expoConfig:current});
 assert.equal(result.source_config_consistent,false);
 assert.ok(result.reasons.includes('EXPO_IOS_ASSOCIATED_DOMAIN_MISSING'));
 assert.ok(result.reasons.includes('EXPO_ANDROID_INTENT_FILTER_MISSING'));
 assert.equal(result.release_gate_satisfied,false);
});
test('invalid app links, missing identity and untrusted configs deny without throwing',()=>{
 for(const bad of [
  'http://stage.starry.invalid/oauth/complete',
  'https://user:password@stage.starry.invalid/oauth/complete',
  'https://stage.starry.invalid/oauth/complete?handoff=token',
  'https://stage.starry.invalid/oauth/complete#handoff=token',
  'https://stage.starry.invalid:8443/oauth/complete',
  'https://stage.starry.invalid/',
 ])assert.ok(run({appReturnUri:bad}).reasons.includes('RETURN_URI_INVALID'));
 assert.ok(run({iosTeamId:'*'}).reasons.includes('APP_IDENTITY_INVALID'));
 assert.ok(run({androidPackageName:'other.app'}).reasons.includes('EXPO_APP_IDENTITY_MISMATCH'));
 assert.ok(run({androidSigningCertSha256:'not-a-certificate'}).reasons.includes('APP_IDENTITY_INVALID'));
 const result=run({expoConfig:null,appleAppSiteAssociation:null,androidAssetLinks:null});
 assert.equal(result.source_config_consistent,false);
 assert.ok(result.reasons.length>=4);
});
test('iOS rejects a broad wildcard, wrong app, other domain and excluded component',()=>{
 const f=fixture();
 for(const association of [
  {applinks:{details:[{appID:'A1B2C3D4E5.phd.starry.id.dev',paths:['*']}]}},
  {applinks:{details:[{appID:'WRONG.phd.starry.id.dev',paths:[path]}]}},
  {applinks:{details:[{appIDs:['A1B2C3D4E5.phd.starry.id.dev'],components:[{'/':path,exclude:true}]}]}},
 ])assert.ok(run({appleAppSiteAssociation:association}).reasons.includes('AASA_EXACT_PATH_MISSING'));
 assert.equal(run({appleAppSiteAssociation:{applinks:{details:[{
  appIDs:['A1B2C3D4E5.phd.starry.id.dev'],components:[{'/':path}],
 }]}}}).reasons.includes('AASA_EXACT_PATH_MISSING'),false);
 assert.ok(run({expoConfig:{expo:{...f.expoConfig.expo,ios:{
  associatedDomains:['applinks:evil.invalid'],
 }}}}).reasons.includes('EXPO_IOS_ASSOCIATED_DOMAIN_MISSING'));
});
test('Android rejects unrelated package, certificate, wildcard intent filter and disabled autoVerify',()=>{
 const f=fixture();
 assert.ok(run({androidAssetLinks:[{...f.androidAssetLinks[0],target:{
  ...f.androidAssetLinks[0].target,package_name:'other.app',
 }}]}).reasons.includes('ASSETLINKS_EXACT_APP_MISSING'));
 assert.ok(run({androidAssetLinks:[{...f.androidAssetLinks[0],target:{
  ...f.androidAssetLinks[0].target,sha256_cert_fingerprints:[],
 }}]}).reasons.includes('ASSETLINKS_EXACT_APP_MISSING'));
 const original=f.expoConfig.expo.android.intentFilters[0];
 for(const invalid of [
  {...original,autoVerify:false},
  {...original,data:[{scheme:'https',host,pathPrefix:'/oauth'}]},
  {...original,data:[{scheme:'https',host:'evil.invalid',path}]},
  {...original,category:['BROWSABLE']},
 ])assert.ok(run({expoConfig:{expo:{...f.expoConfig.expo,android:{
  package:'phd.starry.id.dev',intentFilters:[invalid],
 }}}}).reasons.includes('EXPO_ANDROID_INTENT_FILTER_MISSING'));
});

test('AASA first-match precedence denies earlier exact, wildcard or competing-app rules',()=>{
 const id='A1B2C3D4E5.phd.starry.id.dev';
 const denied=[
  [{appID:id,paths:['NOT '+path,path]}],
  [{appID:id,paths:['NOT /oauth/*',path]}],
  [{appID:id,paths:['/oauth/*',path]}],
  [{appIDs:[id],components:[{'/':path,exclude:true},{'/':path}]}],
  [{appIDs:[id],components:[{'/':'/oauth/*',exclude:true},{'/':path}]}],
  [{appIDs:[id],components:[{'/':'/oauth/*'},{'/':path}]}],
  [{appIDs:[id],components:[{'/':path,'#':'*',exclude:true},{'/':path}]}],
  [{appID:'OTHER.app',paths:[path]},{appID:id,paths:[path]}],
  [{appID:id,paths:[path],components:[{'/':path}]}],
 ];
 for(const details of denied){
  const result=run({appleAppSiteAssociation:{applinks:{details}}});
  assert.equal(result.source_config_consistent,false,
   'ordered/ambiguous AASA must never be reported as an exact source match');
  assert.ok(result.reasons.includes('AASA_EXACT_PATH_MISSING'));
  assert.equal(result.release_gate_satisfied,false);
 }
});
test('AASA preserves ordered explicit allows before exclusions and unrelated earlier rules',()=>{
 const id='A1B2C3D4E5.phd.starry.id.dev';
 const allowed=[
  [{appID:id,paths:[path,'NOT '+path]}],
  [{appID:id,paths:['NOT /unrelated',path]}],
  [{appIDs:[id],components:[{'/':path},{'/':path,exclude:true}]}],
  [{appIDs:[id],components:[{'/':'/not-our-route',exclude:true},{'/':path}]}],
 ];
 for(const details of allowed){
  const result=run({appleAppSiteAssociation:{applinks:{details}}});
  assert.equal(result.source_config_consistent,true);
  assert.deepEqual(result.reasons,[]);
  assert.equal(result.remote_https_verified,false);
  assert.equal(result.ios_device_verified,false);
  assert.equal(result.release_gate_satisfied,false);
 }
});

test('Android 15 dynamic assetlinks cannot exclude or ambiguously constrain handoff',()=>{
 const f=fixture();
 const relation='delegate_permission/common.handle_all_urls';
 const withDynamic=rules=>({
  ...f.androidAssetLinks[0],
  relation_extensions:{[relation]:{dynamic_app_link_components:rules}},
 });
 const denied=[
  [{'/':'*',exclude:true},{'/':path}],
  [{'/':'/oauth/*',exclude:true},{'/':path}],
  [{'/':'/not-our-callback'}],
  [{'/':path,'#':'handoff=*'}],
  [{'#':'handoff=*',exclude:true},{'/':path}],
  [],
 ];
 for(const rules of denied){
  const result=run({androidAssetLinks:[withDynamic(rules)]});
  assert.equal(result.source_config_consistent,false);
  assert.ok(result.reasons.includes('ASSETLINKS_EXACT_APP_MISSING'));
  assert.equal(result.release_gate_satisfied,false);
 }
 for(const relation_extensions of [null,{[relation]:{}},[]]){
  const result=run({androidAssetLinks:[{
   ...f.androidAssetLinks[0],relation_extensions,
  }]});
  assert.ok(result.reasons.includes('ASSETLINKS_EXACT_APP_MISSING'));
 }
});
test('Android 15 allows ordered positive rules within a statically exact callback and rejects duplicate dynamic declarations',()=>{
 const f=fixture();
 const relation='delegate_permission/common.handle_all_urls';
 const withDynamic=rules=>({
  ...f.androidAssetLinks[0],
  relation_extensions:{[relation]:{dynamic_app_link_components:rules}},
 });
 const valid=[
  [{'/':path},{'/':'*',exclude:true}],
  [{'/':'/unrelated',exclude:true},{'/':path}],
  [{'/':'*'}],
 ];
 for(const rules of valid){
  const result=run({androidAssetLinks:[withDynamic(rules)]});
  assert.equal(result.source_config_consistent,true);
  assert.deepEqual(result.reasons,[]);
  assert.equal(result.android_device_verified,false);
  assert.equal(result.remote_https_verified,false);
 }
 const duplicate=run({androidAssetLinks:[
  withDynamic([{'/':path}]),f.androidAssetLinks[0],
 ]});
 assert.ok(duplicate.reasons.includes('ASSETLINKS_EXACT_APP_MISSING'));
 assert.equal(duplicate.release_gate_satisfied,false);
});
