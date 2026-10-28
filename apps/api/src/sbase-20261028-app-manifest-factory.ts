/**
 * AI-4 SBASE-20261028 — candidate ONLY, PUBLIC repository safe.
 * No deployed App Factory, native SDK, IAP, advertising, EAS or Worker route.
 * Existing Starry ID Auth/Battery/Billing retain exclusive domain ownership.
 */
import {handleRequest} from './index.ts';

export const SBASE_CONTRACT_VERSION='starry.shared-app-platform.sbase-20261028.v0-candidate' as const;
export const SBASE_PRODUCTION_ENABLED=false as const;
export const SBASE_BILLING_ENABLED=false as const;
export const SBASE_AD_REQUESTS_ENABLED=false as const;
export const SBASE_NATIVE_BUILD_ENABLED=false as const;
export const SBASE_CANDIDATE_STACK=Object.freeze({
 current:'Expo 54 / React Native 0.81.5 / npm workspaces / Workers TypeScript',
 proposed:'Expo 58 / React Native 0.88 / pnpm + Turbo / Hono + Zod + OpenAPI 3.1',
 nativePluginProof:'PENDING_DEVICE_BUILD_AND_SANDBOX',
 honoZodProof:'PENDING_REAL_DEPENDENCY_POC',
 repositoryDecision:'PENDING_ADR_PRIVATE_REPO_APPROVAL'
} as const);
type Stage='development'|'staging';
export type SbaseManifest=Readonly<{
 schemaVersion:1;brandId:'starry';appId:string;appName:string;environment:Stage;
 platforms:readonly ('ios'|'android')[];ios:Readonly<{bundleId:string}>;
 android:Readonly<{applicationId:string}>;urlScheme:string;
 expoSdkCandidate:'58';reactNativeCandidate:'0.88';
 authClientContractVersion:string;batteryClientContractVersion:string;
 billingClientContractVersion:string;
 monetization:Readonly<{billingProvider:'disabled';productKeys:readonly string[];
  monthlySubscriptionKey:null;yearlySubscriptionKey:null;noAdsEntitlementKey:null}>;
 ads:Readonly<{provider:'disabled';bannerPlacements:readonly string[];
  interstitialPlacements:readonly string[];rewardedEnabled:false}>;
 safety:Readonly<{liveRequestsEnabled:false;nativeBuildEnabled:false;
  sdkRevenueCatEnabled:false;sdkAdMobEnabled:false;crossBrandEnabled:false;
  storeSubmissionEnabled:false;cloudflareDeployEnabled:false}>;
}>;
export type SbaseGateResult=Readonly<{
 approved:false;candidate_valid:boolean;reasons:readonly string[];
 may_deploy:false;may_build_native:false;may_sell:false;may_show_ads:false;
 may_read_central_d1:false;may_approve_entitlement:false;
}>;
const FIELDS=['schemaVersion','brandId','appId','appName','environment','platforms',
 'ios','android','urlScheme','expoSdkCandidate','reactNativeCandidate',
 'authClientContractVersion','batteryClientContractVersion','billingClientContractVersion',
 'monetization','ads','safety'] as const;
const SAFE=['liveRequestsEnabled','nativeBuildEnabled','sdkRevenueCatEnabled',
 'sdkAdMobEnabled','crossBrandEnabled','storeSubmissionEnabled','cloudflareDeployEnabled'];
const RE_APP=/^starry-[a-z][a-z0-9-]{2,32}$/;
const RE_REVERSE=/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,6}$/;
const RE_SCHEME=/^[a-z][a-z0-9-]{2,50}$/;
const RE_VERSION=/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,64}$/;
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v),own=Reflect.ownKeys(v);
  if((p!==Object.prototype&&p!==null)||own.length!==keys.length||
   own.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||!d.enumerable||!('value'in d))return null;
   o[k]=d.value;
  }
  return o;
 }catch{return null;}
}
function uniqueStrings(raw:unknown,pattern:RegExp,max=50):raw is string[]{
 return Array.isArray(raw)&&raw.length<=max&&
 raw.every(x=>typeof x==='string'&&pattern.test(x))&&
 new Set(raw).size===raw.length;
}
const reason=(ok:boolean,key:string,list:string[])=>{if(!ok)list.push(key)};
const BLOCKED=Object.freeze({
 approved:false,may_deploy:false,may_build_native:false,may_sell:false,
 may_show_ads:false,may_read_central_d1:false,may_approve_entitlement:false
} as const);
/** Reject unknown keys, accessors, credentials, prod scope and fake live SDKs. */
export function validateSbaseManifest(raw:unknown):SbaseGateResult{
 const failures:string[]=[];
 const m=exact(raw,FIELDS);
 if(!m)return Object.freeze({...BLOCKED,candidate_valid:false,reasons:Object.freeze(['MANIFEST_SHAPE_OR_SECRET_DENIED'])});
 reason(m.schemaVersion===1&&m.brandId==='starry','VERSION_OR_BRAND_DENIED',failures);
 reason(m.environment==='development'||m.environment==='staging','PRODUCTION_DENIED',failures);
 reason(typeof m.appId==='string'&&RE_APP.test(m.appId),'APP_ID_INVALID',failures);
 reason(typeof m.appName==='string'&&m.appName.length>=2&&m.appName.length<=80,'APP_NAME_INVALID',failures);
 reason(Array.isArray(m.platforms)&&m.platforms.length===2&&
  new Set(m.platforms).size===2&&m.platforms.includes('ios')&&
  m.platforms.includes('android'),'PLATFORMS_NOT_ISOLATED',failures);
 const ios=exact(m.ios,['bundleId']),android=exact(m.android,['applicationId']);
 reason(!!ios&&typeof ios.bundleId==='string'&&RE_REVERSE.test(ios.bundleId),
  'IOS_BUNDLE_ID_INVALID',failures);
 reason(!!android&&typeof android.applicationId==='string'&&RE_REVERSE.test(android.applicationId),
  'ANDROID_PACKAGE_INVALID',failures);
 reason(typeof m.urlScheme==='string'&&RE_SCHEME.test(m.urlScheme),
  'URL_SCHEME_INVALID',failures);
 reason(m.expoSdkCandidate==='58'&&m.reactNativeCandidate==='0.88',
  'CANDIDATE_VERSIONS_NOT_FIXED',failures);
 for(const k of ['authClientContractVersion','batteryClientContractVersion','billingClientContractVersion']){
  const v=m[k];reason(typeof v==='string'&&RE_VERSION.test(v),'CONTRACT_VERSION_INVALID',failures);
 }
 const b=exact(m.monetization,['billingProvider','productKeys',
  'monthlySubscriptionKey','yearlySubscriptionKey','noAdsEntitlementKey']);
 reason(!!b&&b.billingProvider==='disabled'&&Array.isArray(b.productKeys)&&
  b.productKeys.length===0&&b.monthlySubscriptionKey===null&&
  b.yearlySubscriptionKey===null&&b.noAdsEntitlementKey===null,
 'BILLING_NOT_APPROVED',failures);
 const ads=exact(m.ads,['provider','bannerPlacements','interstitialPlacements','rewardedEnabled']);
 reason(!!ads&&ads.provider==='disabled'&&Array.isArray(ads.bannerPlacements)&&
  ads.bannerPlacements.length===0&&Array.isArray(ads.interstitialPlacements)&&
  ads.interstitialPlacements.length===0&&ads.rewardedEnabled===false,
 'AD_NETWORK_NOT_APPROVED',failures);
 const safe=exact(m.safety,SAFE);
 reason(!!safe&&SAFE.every(x=>safe[x]===false),'LIVE_OR_PROVIDER_FLAG_DENIED',failures);
 return Object.freeze({...BLOCKED,candidate_valid:failures.length===0,
  reasons:Object.freeze(failures)});
}
export type SbaseFactoryPlan=Readonly<{
 kind:'OFFLINE_ONLY_NO_FILES_WRITTEN';appId:string;manifestPath:string;
 proposedAppPath:string;targetRepository:'NEW_PRIVATE_REPO_PENDING';
 candidateSdkVersions:Readonly<{expo:'58';reactNative:'0.88'}>;
 testCommands:readonly string[];can_write_files:false;can_install:false;
 can_deploy:false;publishable:false;
}>;
/** Plans paths only; NO fs, shell, network, dependency install or repository creation. */
export function planSbaseAppFactory(input:unknown):SbaseFactoryPlan|null{
 const result=validateSbaseManifest(input);
 if(!result.candidate_valid)return null;
 const m=input as SbaseManifest,slug=m.appId.slice(7);
 return Object.freeze({
  kind:'OFFLINE_ONLY_NO_FILES_WRITTEN',appId:m.appId,
  manifestPath:'apps/'+slug+'/starry.app.json',
  proposedAppPath:'apps/'+slug+'/app/',
  targetRepository:'NEW_PRIVATE_REPO_PENDING',
  candidateSdkVersions:Object.freeze({expo:'58',reactNative:'0.88'}),
  testCommands:Object.freeze(['typecheck','lint','contract-tests','native-build-PENDING']),
  can_write_files:false,can_install:false,can_deploy:false,publishable:false
 });
}
export function checkSbaseFleet(raw:unknown):Readonly<{valid:boolean;reasons:readonly string[]}>{
 if(!Array.isArray(raw)||raw.length===0||raw.length>50)return Object.freeze({
  valid:false,reasons:Object.freeze(['FLEET_COUNT_INVALID'])});
 const errors:string[]=[],appIds=new Set<string>(),iosIds=new Set<string>(),
  androidIds=new Set<string>(),schemes=new Set<string>();
 for(const item of raw){
  const v=validateSbaseManifest(item);
  if(!v.candidate_valid){errors.push(...v.reasons);continue}
  const m=item as SbaseManifest;
  for(const [value,seen,label] of [
   [m.appId,appIds,'APP_ID_COLLISION'],
   [m.ios.bundleId,iosIds,'IOS_BUNDLE_COLLISION'],
   [m.android.applicationId,androidIds,'ANDROID_PACKAGE_COLLISION'],
   [m.urlScheme,schemes,'URL_SCHEME_COLLISION']
  ] as const){
   if(seen.has(value))errors.push(label);
   seen.add(value);
  }
 }
 return Object.freeze({valid:errors.length===0,reasons:Object.freeze([...new Set(errors)])});
}
export type SbaseClientPort=Readonly<{
 contractVersion:string;
 /** Client port only; implementation owned by AI-1, AI-2 or AI-3. */
 readStatus:()=>Promise<unknown>;
}>;
/** No new publisher, no member lookup, no central D1 or Store calls. */
export async function inspectSbaseClientPorts(ports:Readonly<{
 auth?:SbaseClientPort;battery?:SbaseClientPort;billing?:SbaseClientPort;
}>):Promise<Readonly<{status:'blocked'|'review_only';authority:false;
 missing:readonly string[];authenticated:false;wallet_verified:false;
 entitlement_verified:false;may_publish:false;may_charge:false}>>{
 const missing:string[]=[];
 for(const key of ['auth','battery','billing'] as const){
  const port=ports[key];
  if(!port||!RE_VERSION.test(port.contractVersion)||typeof port.readStatus!=='function'){
   missing.push(key.toUpperCase()+'_PORT_MISSING');continue;
  }
  try{await port.readStatus();}catch{missing.push(key.toUpperCase()+'_UNAVAILABLE')}
 }
 return Object.freeze({status:missing.length?'blocked':'review_only',authority:false,
  missing:Object.freeze(missing),authenticated:false,wallet_verified:false,
  entitlement_verified:false,may_publish:false,may_charge:false});
}
/** No-ads logic is DESIGN ONLY. Even synthetic "verified" data cannot load Ads. */
export function decideSbaseAdPlaceholder(raw:unknown):Readonly<{
 status:'blocked'|'review_only';reason:string;can_request_ad:false;
 purchases_enabled:false;battery_sellable:false;ads_sdk_loaded:false;
}>{
 const r=exact(raw,['appId','consent','purchaseEntitlement','subscriptionEntitlement',
  'providerApproved']);
 let reasonCode='UNKNOWN_OR_FOREIGN_INPUT';
 if(r&&typeof r.appId==='string'&&RE_APP.test(r.appId)){
  if(r.purchaseEntitlement==='permanent_no_ads_mock')reasonCode='PERMANENT_NO_ADS_MOCK';
  else if(r.subscriptionEntitlement==='active_no_ads_mock')reasonCode='SUBSCRIPTION_NO_ADS_MOCK';
  else if(r.consent!=='approved_mock')reasonCode='CONSENT_NOT_VERIFIED';
  else reasonCode='PROVIDER_AND_STORE_NOT_APPROVED';
 }
 return Object.freeze({status:reasonCode==='UNKNOWN_OR_FOREIGN_INPUT'?'blocked':'review_only',
  reason:reasonCode,can_request_ad:false,purchases_enabled:false,
  battery_sellable:false,ads_sdk_loaded:false});
}
/** Real deployed GET /v1/health currently belongs to existing AI-4 Worker.
 * Probe via existing handler (not a Hono implementation or new endpoint).
 */
export async function inspectExistingHealthContract():Promise<Readonly<{
 path:'/v1/health';implementation:'EXISTING_WORKER_NO_HONO';
 valid:boolean;hono_poc_completed:false;openapi_codegen_completed:false;
}>>{
 const r=handleRequest(new Request('https://offline.invalid/v1/health'),
  {STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'});
 const body=await r.json() as Record<string,unknown>;
 return Object.freeze({path:'/v1/health',implementation:'EXISTING_WORKER_NO_HONO',
  valid:r.status===200&&body.status==='ok'&&body.brand_id==='starry'&&
   body.app_id==='starry-id'&&body.kind==='liveness-only',
  hono_poc_completed:false,openapi_codegen_completed:false});
}
