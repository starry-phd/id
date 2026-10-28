/**
 * AI-4 Wave1 R005. Synthetic future Expo/AdMob consent & protected SDK gate.
 * NOT imported by Worker/Expo, NO SDK/native fetch, ALWAYS blocked.
 * Q4=A vendor selection is NOT advertising activation authority.
 */
import {R004_VERSION, R004_ADS_DEFAULTS, reviewR004AdMobActivation} from
  './wave1-r004-admob-offline-gate.ts';
import {R004_SESSION_FENCE_VERSION, R004_SESSION_FENCE_LIVE} from
  '../../../modules/starry-id-v1/src/wave1-round004-event-session-fence.ts';
import {R004_BILLING_CONTINUITY, R004_BILLING_LIVE} from
  '../../../packages/rebuild-billing/src/wave1-r004-entitlement-continuity-review.ts';
import {R004_P05_HANDSHAKE, R004_P05_LIVE} from
  '../../../packages/rebuild-ai3/src/wave1-r004-p05-canonical-claim-handshake.ts';
import {R003_INTEROP_VERSION, R003_PROPOSED_HTTP, R003_REVIEW_ONLY,
  proposeR003PublicError} from './wave1-r003-protected-interop.ts';

export const R005_VERSION='starry.ai4.r005.admob-native-consent-protected.v1-offline' as const;
export const R005_OWNER_PINS=Object.freeze({
  auth: R004_SESSION_FENCE_VERSION,
  billing: R004_BILLING_CONTINUITY,
  p05: R004_P05_HANDSHAKE,
  ads: R004_VERSION,
  protected_api: R003_INTEROP_VERSION
} as const);
export const R005_OFFLINE_ONLY=Object.freeze({
  provider_selection: R004_ADS_DEFAULTS.adsProviderSelection,
  consent_ump_trusted: false,
  consent_att_trusted: false,
  family_policy_approved: false,
  native_config_plugin_installed: false,
  sdk_initialized: false,
  ad_requests_allowed: false,
  per_app_entitlement_verified: false,
  protected_worker_registered: false,
  canonical_p05_issuer_live: false,
  queue_ack_allowed: false,
  release_allowed: false
} as const);
/** Compile-time future provider boundaries only; no concrete implementation. */
export type R005FutureNativeConsentPorts=Readonly<{
  ai4ReadNativeUmpAttStatus:(opaqueApp:unknown)=>Promise<unknown>;
  ai2ReadStoreVerifiedRemoveAds:(opaqueApp:unknown)=>Promise<unknown>;
  ai0ReadOwnerActivationGate:(opaqueApp:unknown)=>Promise<never>;
  ai4InitializeSdkAfterApprovedGate:(approved:never)=>Promise<never>;
  ai4RequestAdsAfterApprovedGate:(approved:never)=>Promise<never>;
}>;

export type R005Reason=
  'INVALID_CANDIDATE'|'PRODUCTION_DISABLED'|'SCOPE_DENIED'|
  'CROSS_APP_ENTITLEMENT'|'SDK_OR_REQUEST_FORBIDDEN'|
  'NATIVE_APP_OR_UNIT_ID_FORBIDDEN'|'UNDERAGE_OR_UNKNOWN_POLICY'|
  'UMP_ATT_NOT_AUTHORITY'|'REMOVE_ADS_CLAIM_NOT_AUTHORITY'|
  'OWNER_GATE_REQUIRED';
export type R005Review=Readonly<{
  contract:typeof R005_VERSION;state:'blocked';reason:R005Reason;
  evidence_level:'synthetic_untrusted_not_native';
  sdk_init:false;request_ads:false;create_ad_unit:false;
  modify_entitlement:false;grant_purchase:false;ack_queue:false;
  write_database:false;deploy:false;publishable:false;
}>;
const DENY=Object.freeze({
  evidence_level:'synthetic_untrusted_not_native',sdk_init:false,
  request_ads:false,create_ad_unit:false,modify_entitlement:false,
  grant_purchase:false,ack_queue:false,write_database:false,
  deploy:false,publishable:false
} as const);
function deny(reason:R005Reason):R005Review{
  return Object.freeze({contract:R005_VERSION,state:'blocked',reason,...DENY});
}
function exactData(raw:unknown):Record<string,unknown>|null{
  const fields=[
    'brand_id','app_id','entitlement_app_id','environment','platform',
    'region','audience','ump_status','att_status','adsEnabled',
    'adsSdkInitialized','adRequestsEnabled','admobAppId','adUnitId',
    'removeAdsClaim'
  ];
  try{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const proto=Object.getPrototypeOf(raw);
    if(proto!==Object.prototype&&proto!==null)return null;
    const own=Reflect.ownKeys(raw);
    if(own.length!==fields.length||
      own.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
    const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
    for(const key of fields){
      const d=Object.getOwnPropertyDescriptor(raw,key);
      if(!d||!d.enumerable||!('value' in d))return null;
      result[key]=d.value;
    }
    return result;
  }catch{return null;}
}
/** Never interprets an incoming consent / ATT string or paid entitlement as
 * SDK initialization authority. Even optimal-looking values deny.
 */
export function reviewR005NativeAdMobConsent(raw:unknown):R005Review{
  const x=exactData(raw);
  if(!x||typeof x.brand_id!=='string'||typeof x.app_id!=='string'||
    typeof x.entitlement_app_id!=='string'||typeof x.environment!=='string'||
    typeof x.platform!=='string'||typeof x.region!=='string'||
    typeof x.audience!=='string'||typeof x.ump_status!=='string'||
    typeof x.att_status!=='string'||typeof x.adsEnabled!=='boolean'||
    typeof x.adsSdkInitialized!=='boolean'||typeof x.adRequestsEnabled!=='boolean'||
    typeof x.removeAdsClaim!=='boolean'||
    !(x.admobAppId===null||typeof x.admobAppId==='string')||
    !(x.adUnitId===null||typeof x.adUnitId==='string'))
    return deny('INVALID_CANDIDATE');
  if(x.environment==='production')return deny('PRODUCTION_DISABLED');
  if(x.brand_id!=='starry'||!/^starry-[a-z0-9-]{2,60}$/.test(x.app_id)||
    !['development','staging'].includes(x.environment)||
    !['ios','android'].includes(x.platform)||
    !['eea','uk','us','other','unknown'].includes(x.region))
    return deny('SCOPE_DENIED');
  if(x.app_id!==x.entitlement_app_id)return deny('CROSS_APP_ENTITLEMENT');
  if(x.adsEnabled||x.adsSdkInitialized||x.adRequestsEnabled)
    return deny('SDK_OR_REQUEST_FORBIDDEN');
  if(x.admobAppId!==null||x.adUnitId!==null)
    return deny('NATIVE_APP_OR_UNIT_ID_FORBIDDEN');
  if(x.audience!=='adult'||x.region==='unknown')
    return deny('UNDERAGE_OR_UNKNOWN_POLICY');
  if(!['not_requested','denied','granted'].includes(x.ump_status)||
    !['not_requested','denied','authorized','not_applicable'].includes(x.att_status))
    return deny('INVALID_CANDIDATE');
  if(x.ump_status!=='granted'||
    (x.platform==='ios'&&x.att_status!=='authorized'))
    return deny('UMP_ATT_NOT_AUTHORITY');
  if(x.removeAdsClaim)return deny('REMOVE_ADS_CLAIM_NOT_AUTHORITY');
  const inherited=reviewR004AdMobActivation({
    brand_id:x.brand_id,app_id:x.app_id,
    entitlement_app_id:x.entitlement_app_id,environment:x.environment,
    adsProviderSelection:R004_ADS_DEFAULTS.adsProviderSelection,
    adsEnabled:false,adsSdkInitialized:false,adRequestsEnabled:false,
    admobAppId:null,adUnitId:null,paidResourcesEnabled:false
  });
  if(inherited.status!=='blocked'||inherited.may_request_ad!==false)
    return deny('INVALID_CANDIDATE');
  return deny('OWNER_GATE_REQUIRED');
}
export const R005_PROTECTED_ROUTE_PINS=Object.freeze(
  R003_PROPOSED_HTTP.map(route=>Object.freeze({
    path:route.path,method:route.method,owner:route.domain_owner,
    state:'PROPOSED_NOT_REGISTERED' as const,has_worker_route:false as const
  }))
);
export const R005_CROSS_OWNER_LIVE=Object.freeze({
  auth:R004_SESSION_FENCE_LIVE,
  billing:R004_BILLING_LIVE,
  p05:R004_P05_LIVE,
  transport:R003_REVIEW_ONLY.queue_ack_authorized
} as const);
export type R005PublicError=Readonly<{
  contract:typeof R005_VERSION;status:400|401|403|404|405|409|503;
  body:Readonly<{error:Readonly<{code:string;message:'Operation unavailable'}>}>;
  source:'sdk_only_not_http';may_dispatch:false;may_grant:false;
  may_charge:false;may_send:false;may_ack:false;
}>;
/** Error-only mapping. Never serializes caller data or creates a Worker route. */
export function proposeR005ProtectedError(status:unknown):R005PublicError{
  const safe=proposeR003PublicError(status);
  return Object.freeze({
    contract:R005_VERSION,status:safe.http_status,body:safe.body,
    source:'sdk_only_not_http' as const,
    may_dispatch:false as const,may_grant:false as const,
    may_charge:false as const,may_send:false as const,may_ack:false as const
  });
}
