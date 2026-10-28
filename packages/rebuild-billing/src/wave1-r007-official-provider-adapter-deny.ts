/**
 * AI-2 Wave1 R007: official Store / RevenueCat adapter *denial contract*.
 * No official verifier, Store APIs, RevenueCat webhook, credentials, receipt,
 * entitlement writer, live D1, durable replay, HTTP route or network access.
 * A syntactically plausible observation is NEVER payment evidence.
 */
import {R006_STORE_BOUNDARY,R006_STORE_LIVE} from './wave1-r006-synthetic-store-provenance.ts';

export const R007_ADAPTER_CONTRACT =
 'starry.billing.r007.official-provider-adapter-deny.v1-offline-candidate' as const;
export const R007_OFFICIAL_ADAPTER_LIVE=false as const;
export const R007_INHERITED_SYNTHETIC_BOUNDARY=R006_STORE_BOUNDARY;
type Provider='apple'|'google'|'revenuecat';
type Platform='ios'|'android';
type EvidenceKind='apple_jws_claim'|'apple_notification_claim'|
 'google_developer_api_claim'|'google_rtdn_claim'|'revenuecat_webhook_claim';
type EventType='purchase'|'renewal'|'grace'|'expire'|'refund'|'revoke'|'restore';
type Kind='NON_CONSUMABLE'|'AUTO_RENEWABLE_SUBSCRIPTION';
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
type Product=Readonly<{product_key:string;kind:Kind;period:null|'MONTH'|'YEAR';
 ios_sku:string;android_sku:string}>;
type Observation=Readonly<{provider:Provider;evidence_kind:EvidenceKind;
 brand_id:'starry';app_id:string;environment:'development'|'staging';
 platform:Platform;event_id:string;transaction_id:string;
 original_transaction_id:string;member_digest:string;product_key:string;
 store_sku:string;kind:Kind;period:null|'MONTH'|'YEAR';event_type:EventType;
 source_version:number;occurred_at:number}>;
const observationKeys=['provider','evidence_kind','brand_id','app_id','environment',
 'platform','event_id','transaction_id','original_transaction_id','member_digest',
 'product_key','store_sku','kind','period','event_type','source_version','occurred_at'];
const catalogKeys=['product_key','kind','period','ios_sku','android_sku'];
const identifier=/^[a-z][a-z0-9._:-]{2,95}$/;
const digest=/^m_[0-9a-f]{64}$/;
const forbidden=/hglobal|battery|電池|consumable|top.?up/i;
type CandidateState='none'|'unverified_active'|'expired'|'revoked';
export type R007AdapterReview=Readonly<{
 contract:typeof R007_ADAPTER_CONTRACT;status:'blocked'|'review_only';
 reason:string;app_id:string;provider_candidate:Provider|null;
 event_candidate:EventType|null;state_candidate:CandidateState;
 source_is_officially_verified:false;apple_jws_verified:false;
 google_developer_api_verified:false;google_rtdn_is_payment_proof:false;
 revenuecat_webhook_verified:false;revenuecat_app_user_id_verified:false;
 signed_current_auth_verified:false;durable_cas_verified:false;
 independent_anti_pitr_verified:false;can_purchase:false;can_restore:false;
 can_grant:false;can_remove_ads:false;can_ack_webhook:false;
 can_send_p05:false;can_publish:false;ads_enabled:false;live:false
}>;
/** Own data properties only, exact key set, no getters or inherited fields.
 * Input insertion order has no semantic authority. */
function record(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const names=Reflect.ownKeys(v);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const desc=Object.getOwnPropertyDescriptors(v);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of keys){
   const d=desc[key];
   if(!d||!d.enumerable||!('value' in d))return null;
   out[key]=d.value;
  }
  return out;
 }catch{return null;}
}
function positive(v:unknown):v is number{
 return typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
}
function identifierOk(v:unknown):v is string{
 return typeof v==='string'&&identifier.test(v)&&!forbidden.test(v);
}
function deny(scope:Scope,reason:string):R007AdapterReview{
 return Object.freeze({contract:R007_ADAPTER_CONTRACT,status:'blocked',reason,
  app_id:scope.app_id,provider_candidate:null,event_candidate:null,
  state_candidate:'none',source_is_officially_verified:false,
  apple_jws_verified:false,google_developer_api_verified:false,
  google_rtdn_is_payment_proof:false,revenuecat_webhook_verified:false,
  revenuecat_app_user_id_verified:false,signed_current_auth_verified:false,
  durable_cas_verified:false,independent_anti_pitr_verified:false,
  can_purchase:false,can_restore:false,can_grant:false,
  can_remove_ads:false,can_ack_webhook:false,can_send_p05:false,
  can_publish:false,ads_enabled:false,live:false});
}
function claim(o:Record<string,unknown>|null,s:Scope,now:number):o is Record<string,unknown> & Observation{
 if(!o||o.brand_id!=='starry'||o.app_id!==s.app_id||
   o.environment!==s.environment||
   !['ios','android'].includes(o.platform as string)||
   !['apple','google','revenuecat'].includes(o.provider as string)||
   !['apple_jws_claim','apple_notification_claim','google_developer_api_claim',
     'google_rtdn_claim','revenuecat_webhook_claim'].includes(o.evidence_kind as string)||
   !['purchase','renewal','grace','expire','refund','revoke','restore'].includes(o.event_type as string)||
   !['NON_CONSUMABLE','AUTO_RENEWABLE_SUBSCRIPTION'].includes(o.kind as string)||
   (o.kind==='NON_CONSUMABLE'?o.period!==null:!['MONTH','YEAR'].includes(o.period as string))||
   !positive(o.source_version)||!positive(o.occurred_at)||o.occurred_at>now+5||
   typeof o.member_digest!=='string'||!digest.test(o.member_digest))return false;
 for(const k of ['event_id','transaction_id','original_transaction_id','product_key','store_sku'])
  if(!identifierOk(o[k]))return false;
 return true;
}
export function createOfflineR007OfficialProviderAdapterGate(config:Readonly<{
 enabled?:boolean;scope:Scope;skuCatalog:readonly Product[];nowSeconds:()=>number
}>){
 const s=config?.scope;
 if(!s||s.brand_id!=='starry'||!identifierOk(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  typeof config.nowSeconds!=='function'||!Array.isArray(config.skuCatalog)||
  config.skuCatalog.length<1||config.skuCatalog.length>30||R006_STORE_LIVE!==false)
  throw Error('R007_UNTRUSTED_CONFIGURATION');
 const catalog=new Map<string,Product>(),skus=new Set<string>();
 for(const v of config.skuCatalog){
  const p=record(v,catalogKeys);
  if(!p||!identifierOk(p.product_key)||!identifierOk(p.ios_sku)||
   !identifierOk(p.android_sku)||p.ios_sku===p.android_sku||
   !['NON_CONSUMABLE','AUTO_RENEWABLE_SUBSCRIPTION'].includes(p.kind as string)||
   (p.kind==='NON_CONSUMABLE'?p.period!==null:!['MONTH','YEAR'].includes(p.period as string))||
   catalog.has(p.product_key)||skus.has(p.ios_sku)||skus.has(p.android_sku))
   throw Error('R007_INVALID_OR_DUPLICATE_PRODUCT_CATALOG');
  catalog.set(p.product_key,p as unknown as Product);
  skus.add(p.ios_sku);skus.add(p.android_sku);
 }
 const scope=Object.freeze({...s});
 // Diagnostic in-process memory ONLY; NOT a durable D1 CAS or PITR witness.
 const events=new Set<string>(),owners=new Map<string,string>();
 const states=new Map<string,{version:number;terminal:boolean}>();
 return Object.freeze({contract:R007_ADAPTER_CONTRACT,
  inspect(raw:unknown):R007AdapterReview{
   if(config.enabled!==true)return deny(scope,'DEFAULT_DISABLED');
   try{
    const now=config.nowSeconds();
    if(!positive(now))return deny(scope,'CLOCK_NOT_TRUSTED');
    const o=record(raw,observationKeys);
    if(!claim(o,scope,now))return deny(scope,'INVALID_OR_CROSS_SCOPE_CLAIM');
    if((o.provider==='apple'&&o.platform!=='ios')||
       (o.provider==='google'&&o.platform!=='android'))
      return deny(scope,'PROVIDER_PLATFORM_MISMATCH');
    if((o.provider==='apple'&&o.evidence_kind==='apple_notification_claim')||
       (o.provider==='google'&&o.evidence_kind==='google_rtdn_claim'))
      return deny(scope,'NOTIFICATION_ALONE_NOT_PURCHASE_PROOF');
    if((o.provider==='apple'&&o.evidence_kind!=='apple_jws_claim')||
       (o.provider==='google'&&o.evidence_kind!=='google_developer_api_claim')||
       (o.provider==='revenuecat'&&o.evidence_kind!=='revenuecat_webhook_claim'))
      return deny(scope,'PROVIDER_EVIDENCE_MISMATCH');
    const product=catalog.get(o.product_key);
    if(!product||product.kind!==o.kind||product.period!==o.period||
       o.store_sku!==(o.platform==='ios'?product.ios_sku:product.android_sku))
      return deny(scope,'UNLISTED_OR_CROSS_APP_SKU');
    const evt=[o.provider,o.event_id].join('|');
    if(events.has(evt))return deny(scope,'EVENT_REPLAY');
    const authority=[scope.app_id,scope.environment,o.platform,o.member_digest].join('|');
    const original=owners.get(o.original_transaction_id);
    const transaction=owners.get(o.transaction_id);
    if((original&&original!==authority)||(transaction&&transaction!==authority))
      return deny(scope,'CROSS_OS_OR_MEMBER_TRANSACTION_TRANSFER');
    const key=[authority,o.original_transaction_id,o.product_key].join('|');
    const prev=states.get(key);
    if(prev&&o.source_version<=prev.version)return deny(scope,'DUPLICATE_OR_ROLLBACK_VERSION');
    if(prev?.terminal&&['purchase','renewal','restore'].includes(o.event_type))
      return deny(scope,'REVOKED_ORDER_CANNOT_RESTORE_OR_RENEW');
    events.add(evt);owners.set(o.original_transaction_id,authority);
    owners.set(o.transaction_id,authority);
    const terminal=o.event_type==='refund'||o.event_type==='revoke';
    states.set(key,{version:o.source_version,terminal:terminal||!!prev?.terminal});
    const state:CandidateState=terminal||prev?.terminal?'revoked':
     ['expire','grace'].includes(o.event_type)?'expired':'unverified_active';
    // Even a plausible "Apple JWS", "Google API" or RevenueCat claim is
    // an unverified fixture until separate real official adapters are approved.
    return Object.freeze({...deny(scope,'OFFICIAL_PROVIDER_VERIFICATION_NOT_CONNECTED'),
     status:'review_only',
     reason:o.provider==='apple'?'UNVERIFIED_APPLE_JWS_CLAIM':
      o.provider==='google'?'UNVERIFIED_GOOGLE_DEVELOPER_API_CLAIM':
       'UNVERIFIED_REVENUECAT_WEBHOOK_CLAIM',
     provider_candidate:o.provider,event_candidate:o.event_type,state_candidate:state});
   }catch{return deny(scope,'PROVIDER_OR_INPUT_ERROR');}
  }
 });
}
