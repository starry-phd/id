/**
 * AI-2 | Q94/95/96/102/113/125: server-owned Commerce entitlement POLICY ONLY.
 * Offline candidate: never issues a right, performs a payment, or publishes P05.
 * AI-0 release G00-G10 remain BLOCKED. No provider/merchant is approved.
 */
import {isTrustedPrincipal} from '../../../modules/starry-id-v1/src/index.ts';

export const COMMERCE_POLICY_VERSION='starry-commerce.r7-candidate' as const;
export const COMMERCE_PUBLISHABLE=false as const;
export type CommerceStore='apple'|'google';
export type CommerceKind='monthly'|'yearly'|'one_time';
export type RestoreMode='self_service_reverify'|'manual_review';
export type RuntimeEnvironment='development'|'staging';

export type CommerceOffer=Readonly<{
  offerId:string;
  ownerAppId:string;
  kind:CommerceKind;
  skuByStore:Readonly<Partial<Record<CommerceStore,string>>>;
  storeAppIdByStore:Readonly<Partial<Record<CommerceStore,string>>>;
  /** Separate from Q125 cross-APP policy: Q96 same-APP iOS/Android rule. */
  allowCrossPlatform:boolean;
  /** Q125 allowlisting; by default [] and never inferred from same-account login. */
  allowedCrossAppIds:readonly string[];
  restoration:RestoreMode;
  enabledForSandbox:boolean;
}>;

export type CommittedEntitlement=Readonly<{
  brandId:'starry';runtimeEnvironment:RuntimeEnvironment;
  storeEnvironment:'sandbox';sourceAppId:string;
  sourceStore:CommerceStore;sourceStoreAppId:string;sourceSku:string;
  offerId:string;kind:CommerceKind;ownerUserId:string;userId:string;
  /** Current trustworthy Billing DB projection, NOT a client payment claim. */
  state:'PAID'|'RENEWED'|'REFUNDED'|'CHARGEBACK'|'REVOKED'|'EXPIRED'|'ON_HOLD'|'GRACE_PERIOD';
  status:'active'|'inactive';
  expiresAtSeconds:number|null;
  lastProviderCheckSeconds:number;
  revision:number;
  accountDeleted:boolean;
}>;

export type CommerceDecision=Readonly<{
  verdict:'policy_candidate_only'|'deny'|'store_requery_required'|'manual_review_required';
  reason:string;
  offerId:string|null;
  policyVersion:typeof COMMERCE_POLICY_VERSION;
  publishable:false;
}>;

export type CommerceScope=Readonly<{
  brandId:'starry';appId:string;environment:RuntimeEnvironment;
}>;
export type CommercePorts=Readonly<{
  /** AI-1 WeakSet principal re-resolved for current request, never JSON claims. */
  resolveTrustedPrincipal:()=>Promise<unknown>;
  /** AI-2-owned D1 committed entitlement lookup; fails closed when unavailable. */
  readCommittedEntitlement:(userId:string,offerId:string)=>Promise<CommittedEntitlement|null>;
  serverNowSeconds:()=>number;
}>;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function must(v:unknown,reason:string):asserts v{if(!v)throw new Error(reason);}
const validId=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
const isStore=(v:unknown):v is CommerceStore=>v==='apple'||v==='google';
const isKind=(v:unknown):v is CommerceKind=>v==='monthly'||v==='yearly'||v==='one_time';
const isNow=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
function plain(v:unknown):v is Record<string,unknown>{
 if(v===null||typeof v!=='object'||Array.isArray(v))return false;
 try{
  if(Object.getPrototypeOf(v)!==Object.prototype)return false;
  return Reflect.ownKeys(v).every(k=>{
   const d=Object.getOwnPropertyDescriptor(v,k);
   return typeof k==='string'&&d!==undefined&&'value' in d;
  });
 }catch{return false;}
}
function copyOffer(v:CommerceOffer):CommerceOffer {
 must(plain(v)&&validId(v.offerId)&&validId(v.ownerAppId)
   &&isKind(v.kind)&&typeof v.allowCrossPlatform==='boolean'
   &&typeof v.enabledForSandbox==='boolean'
   &&(v.restoration==='self_service_reverify'||v.restoration==='manual_review'),
   'COMMERCE_CONFIG_DENIED');
 must(plain(v.skuByStore)&&plain(v.storeAppIdByStore)
   &&Object.keys(v.skuByStore).length>0
   &&Object.keys(v.skuByStore).every(isStore)
   &&Object.keys(v.storeAppIdByStore).every(isStore),
   'COMMERCE_CONFIG_DENIED');
 for(const store of ['apple','google'] as const){
  if(v.skuByStore[store]===undefined){
   must(v.storeAppIdByStore[store]===undefined,'COMMERCE_CONFIG_DENIED');
  }else{
   must(validId(v.skuByStore[store])&&validId(v.storeAppIdByStore[store]),
    'COMMERCE_CONFIG_DENIED');
  }
 }
 must(Array.isArray(v.allowedCrossAppIds)&&v.allowedCrossAppIds.length<=16
   &&v.allowedCrossAppIds.every(x=>validId(x)&&x!==v.ownerAppId)
   &&new Set(v.allowedCrossAppIds).size===v.allowedCrossAppIds.length,
   'COMMERCE_CONFIG_DENIED');
 // Config is copied and frozen before any request. HTTP never supplies catalogue.
 return Object.freeze({...v,
  skuByStore:Object.freeze({...v.skuByStore}),
  storeAppIdByStore:Object.freeze({...v.storeAppIdByStore}),
  allowedCrossAppIds:Object.freeze([...v.allowedCrossAppIds]),
 });
}
function decision(verdict:CommerceDecision['verdict'],reason:string,offerId:string|null):CommerceDecision{
 return Object.freeze({verdict,reason,offerId,
  policyVersion:COMMERCE_POLICY_VERSION,publishable:COMMERCE_PUBLISHABLE});
}
/**
 * Enforces two independent dimensions: same-App cross-store (Q96) and cross-App
 * allowlist (Q125). Inputs from client can only SELECT an offer/device store.
 * An affirmative result is STILL test-only and cannot grant access.
 */
export function createSandboxCommercePolicy(config:Readonly<{
 scope:CommerceScope;offers:readonly CommerceOffer[];
 /** 0 is forbidden; missing authoritative periodic requery fails closed (Q113). */
 maxRequeryAgeSeconds:number;
 ports:CommercePorts;
}>){
 must(config?.scope?.brandId==='starry'
   &&validId(config.scope.appId)
   &&['development','staging'].includes(config.scope.environment)
   &&Array.isArray(config.offers)&&config.offers.length>0&&config.offers.length<=256
   &&Number.isSafeInteger(config.maxRequeryAgeSeconds)
   &&config.maxRequeryAgeSeconds>0&&config.maxRequeryAgeSeconds<=86400
   &&typeof config.ports?.resolveTrustedPrincipal==='function'
   &&typeof config.ports.readCommittedEntitlement==='function'
   &&typeof config.ports.serverNowSeconds==='function','COMMERCE_CONFIG_DENIED');
 const scope=Object.freeze({...config.scope});
 const catalogue=new Map<string,CommerceOffer>();
 for(const x of config.offers){
  const offer=copyOffer(x);
  must(!catalogue.has(offer.offerId)&&!offer.offerId.toLowerCase().includes('battery'),
   'COMMERCE_CONFIG_DENIED');
  catalogue.set(offer.offerId,offer);
 }
 async function checkPrincipal():Promise<{userId:string;now:number}>{
  const now=config.ports.serverNowSeconds();
  must(isNow(now),'COMMERCE_CLOCK_DENIED');
  const p=await config.ports.resolveTrustedPrincipal();
  must(isTrustedPrincipal(p)
   &&p.brand_id==='starry'&&p.member_status==='active'
   &&p.app_id===scope.appId&&p.environment===scope.environment
   &&p.checked_at===now&&p.expires_at>now&&validId(p.s_user_id),
   'COMMERCE_AUTH_DENIED');
  return {userId:p.s_user_id,now};
 }
 return Object.freeze({
  async evaluateAccess(selection:unknown):Promise<CommerceDecision>{
   // Reject HTTP provided owner, proof/paid flags, app scope or store values.
   must(plain(selection)
    &&Object.keys(selection).length===2
    &&Object.keys(selection).every(k=>k==='offerId'||k==='deviceStore')
    &&validId(selection.offerId)&&isStore(selection.deviceStore),
    'COMMERCE_CLIENT_CLAIMS_DENIED');
   const {userId,now}=await checkPrincipal();
   const offer=catalogue.get(selection.offerId);
   if(!offer||!offer.enabledForSandbox)return decision('deny','SKU_NOT_ENABLED',null);
   // App entitlement is isolated by default. This never checks caller-supplied app claims.
   if(scope.appId!==offer.ownerAppId
      &&!offer.allowedCrossAppIds.includes(scope.appId))
    return decision('deny','CROSS_APP_NOT_APPROVED',offer.offerId);
   let current:CommittedEntitlement|null;
   try{current=await config.ports.readCommittedEntitlement(userId,offer.offerId);}
   catch{return decision('store_requery_required','BILLING_SOURCE_UNAVAILABLE',offer.offerId);}
   if(!current)return decision('store_requery_required','NO_COMMITTED_SOURCE',offer.offerId);
   if(!plain(current)
     ||current.brandId!=='starry'
     ||current.runtimeEnvironment!==scope.environment
     ||current.storeEnvironment!=='sandbox'
     ||current.offerId!==offer.offerId||current.sourceAppId!==offer.ownerAppId
     ||current.kind!==offer.kind||!isStore(current.sourceStore)
     ||current.sourceSku!==offer.skuByStore[current.sourceStore]
     ||current.sourceStoreAppId!==offer.storeAppIdByStore[current.sourceStore]
     ||!Number.isSafeInteger(current.revision)||current.revision<1)
    return decision('deny','COMMITTED_SCOPE_DENIED',offer.offerId);
   // Deletion revokes rights immediately; re-registration NEVER restores old user_id.
   if(current.accountDeleted||current.ownerUserId!==userId||current.userId!==userId)
    return decision('deny','DELETED_OR_FOREIGN_OWNER',offer.offerId);
   if(current.state!=='PAID'&&current.state!=='RENEWED'
     ||current.status!=='active')
    return decision('deny','STORE_STATE_DENIED',offer.offerId);
   if(!isNow(current.lastProviderCheckSeconds)
     ||current.lastProviderCheckSeconds>now
     ||now-current.lastProviderCheckSeconds>config.maxRequeryAgeSeconds)
    return decision('store_requery_required','STALE_PROVIDER_RECONCILIATION',offer.offerId);
   if(offer.kind==='one_time'){
    if(current.expiresAtSeconds!==null)
     return decision('deny','PERPETUAL_EXPIRY_MISMATCH',offer.offerId);
   }else if(!isNow(current.expiresAtSeconds)||current.expiresAtSeconds<=now){
    return decision('deny','SUBSCRIPTION_EXPIRED',offer.offerId);
   }
   if(current.sourceStore!==selection.deviceStore&&!offer.allowCrossPlatform)
    return decision('deny','CROSS_PLATFORM_NOT_APPROVED',offer.offerId);
   return decision('policy_candidate_only','OFFLINE_POLICY_MATCH_NOT_A_GRANT',offer.offerId);
  },
  async planRestoration(selection:unknown):Promise<CommerceDecision>{
   must(plain(selection)&&Object.keys(selection).length===1
    &&validId(selection.offerId),'COMMERCE_CLIENT_CLAIMS_DENIED');
   await checkPrincipal();
   const offer=catalogue.get(selection.offerId);
   if(!offer||!offer.enabledForSandbox
     ||scope.appId!==offer.ownerAppId&&!offer.allowedCrossAppIds.includes(scope.appId))
    return decision('deny','SKU_NOT_ENABLED_OR_APP_DENIED',null);
   // Does NOT reveal whether another identity purchased, whether an old account
   // exists, or a receipt belongs to the caller. NO rebind/restore grant here.
   return offer.restoration==='manual_review'
     ?decision('manual_review_required','NO_AUTOMATIC_ACCOUNT_TRANSFER',offer.offerId)
     :decision('store_requery_required','OFFICIAL_STORE_REVERIFICATION_REQUIRED',offer.offerId);
  },
 });
}
