/**
 * AI-2 Wave1 R008: DENY-ONLY Store/RevenueCat reconciliation of two *untrusted*
 * R007 review objects. Pairing two claims never establishes official receipt,
 * same-member entitlement, RevenueCat App User ID or durable order history.
 *
 * No Store/RC APIs, keys, signatures, webhooks, D1, payments, grant or ACK.
 */
import {
 R007_ADAPTER_CONTRACT,R007_OFFICIAL_ADAPTER_LIVE
} from './wave1-r007-official-provider-adapter-deny.ts';

export const R008_RECONCILIATION_CONTRACT=
 'starry.billing.r008.cross-provider-conflict-deny.v1-offline-candidate' as const;
export const R008_RECONCILIATION_LIVE=false as const;
export const R008_REQUIRED_ADAPTER=R007_ADAPTER_CONTRACT;
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
type State='none'|'unverified_active'|'expired'|'revoked';
type Event='purchase'|'renewal'|'grace'|'expire'|'refund'|'revoke'|'restore';
type Provider='apple'|'google'|'revenuecat';
type Platform='ios'|'android';
const reviewFields=['contract','status','reason','app_id','provider_candidate',
 'event_candidate','state_candidate','source_is_officially_verified',
 'apple_jws_verified','google_developer_api_verified','google_rtdn_is_payment_proof',
 'revenuecat_webhook_verified','revenuecat_app_user_id_verified',
 'signed_current_auth_verified','durable_cas_verified',
 'independent_anti_pitr_verified','can_purchase','can_restore','can_grant',
 'can_remove_ads','can_ack_webhook','can_send_p05','can_publish','ads_enabled','live'];
const deniedFlags=reviewFields.slice(7);
const pairFields=['store','revenuecat','correlation'];
const corrFields=['brand_id','app_id','environment','platform','product_key','period',
 'store_member_digest','rc_member_digest','store_original_order_digest',
 'rc_original_order_digest','store_event_version','rc_event_version',
 'store_event_at','rc_event_at'];
const ident=/^[a-z][a-z0-9._:-]{2,95}$/;
const digest=/^m_[0-9a-f]{64}$/;
const orderDigest=/^o_[0-9a-f]{64}$/;
const forbidden=/battery|電池|hglobal|consumable|top.?up/i;
type Correlation=Readonly<{brand_id:'starry';app_id:string;
 environment:'development'|'staging';platform:Platform;product_key:string;
 period:null|'MONTH'|'YEAR';store_member_digest:string;rc_member_digest:string;
 store_original_order_digest:string;rc_original_order_digest:string;
 store_event_version:number;rc_event_version:number;
 store_event_at:number;rc_event_at:number}>;
type View=Readonly<{contract:typeof R007_ADAPTER_CONTRACT;status:'review_only';
 reason:string;app_id:string;provider_candidate:Provider;event_candidate:Event;
 state_candidate:State}>;
export type R008ConflictReview=Readonly<{
 contract:typeof R008_RECONCILIATION_CONTRACT;
 status:'blocked'|'review_only';reason:string;app_id:string;
 store_candidate:'apple'|'google'|null;revenuecat_candidate:boolean;
 correlation_is_authoritative:false;official_apple_verified:false;
 official_google_verified:false;official_revenuecat_verified:false;
 revenuecat_app_user_id_authorized:false;current_signed_auth_verified:false;
 durable_order_cas_verified:false;independent_anti_pitr_verified:false;
 can_purchase:false;can_restore:false;can_grant:false;can_regrant:false;
 can_remove_ads:false;can_ack_webhook:false;can_send_p05:false;
 can_publish:false;ads_enabled:false;live:false
}>;
/** Reject inherited/proxy/accessor/symbol/extra keys; copy own data-only values. */
function own(v:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const keys=Reflect.ownKeys(v);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))
   return null;
  const d=Object.getOwnPropertyDescriptors(v);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of fields){const prop=d[k];
   if(!prop||!prop.enumerable||!('value' in prop))return null;
   out[k]=prop.value;
  }
  return out;
 }catch{return null;}
}
const positive=(v:unknown):v is number=>
 typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
function base(s:Scope,reason:string):R008ConflictReview{
 return Object.freeze({contract:R008_RECONCILIATION_CONTRACT,
  status:'blocked',reason,app_id:s.app_id,store_candidate:null,
  revenuecat_candidate:false,correlation_is_authoritative:false,
  official_apple_verified:false,official_google_verified:false,
  official_revenuecat_verified:false,revenuecat_app_user_id_authorized:false,
  current_signed_auth_verified:false,durable_order_cas_verified:false,
  independent_anti_pitr_verified:false,can_purchase:false,can_restore:false,
  can_grant:false,can_regrant:false,can_remove_ads:false,can_ack_webhook:false,
  can_send_p05:false,can_publish:false,ads_enabled:false,live:false});
}
function checkReview(raw:unknown,s:Scope):View|null{
 const v=own(raw,reviewFields);
 if(!v||v.contract!==R007_ADAPTER_CONTRACT||v.status!=='review_only'||
  v.app_id!==s.app_id||deniedFlags.some(flag=>v[flag]!==false)||
  !['apple','google','revenuecat'].includes(v.provider_candidate as string)||
  !['purchase','renewal','grace','expire','refund','revoke','restore'].includes(v.event_candidate as string)||
  !['none','unverified_active','expired','revoked'].includes(v.state_candidate as string)||
  typeof v.reason!=='string')return null;
 const p=v.provider_candidate;
 if(v.reason!==(p==='apple'?'UNVERIFIED_APPLE_JWS_CLAIM':
  p==='google'?'UNVERIFIED_GOOGLE_DEVELOPER_API_CLAIM':
  'UNVERIFIED_REVENUECAT_WEBHOOK_CLAIM'))return null;
 return v as unknown as View;
}
function validCorr(c:Record<string,unknown>|null,s:Scope,now:number):c is Record<string,unknown>&Correlation{
 if(!c||c.brand_id!=='starry'||c.app_id!==s.app_id||
  c.environment!==s.environment||!['ios','android'].includes(c.platform as string)||
  typeof c.product_key!=='string'||!ident.test(c.product_key)||
  forbidden.test(c.product_key)||!['MONTH','YEAR',null].includes(c.period as string|null)||
  typeof c.store_member_digest!=='string'||!digest.test(c.store_member_digest)||
  typeof c.rc_member_digest!=='string'||!digest.test(c.rc_member_digest)||
  typeof c.store_original_order_digest!=='string'||!orderDigest.test(c.store_original_order_digest)||
  typeof c.rc_original_order_digest!=='string'||!orderDigest.test(c.rc_original_order_digest)||
  !positive(c.store_event_version)||!positive(c.rc_event_version)||
  !positive(c.store_event_at)||!positive(c.rc_event_at)||
  c.store_event_at>now+5||c.rc_event_at>now+5)return false;
 return true;
}
/**
 * This is a stateless *denial* inspection. Cross-provider source_version
 * numbers are NOT compared: Apple/Google and RevenueCat sequences use
 * independent version domains. Current/latest order state requires future
 * authoritative ledger and durable CAS; never infer from this pair.
 */
export function createOfflineR008CrossProviderConflictGate(config:Readonly<{
 enabled?:boolean;scope:Scope;nowSeconds:()=>number
}>){
 const s=config?.scope;
 if(!s||s.brand_id!=='starry'||typeof s.app_id!=='string'||
  !ident.test(s.app_id)||forbidden.test(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  typeof config.nowSeconds!=='function'||R007_OFFICIAL_ADAPTER_LIVE!==false)
  throw Error('R008_UNTRUSTED_SCOPE');
 const scope=Object.freeze({...s});
 return Object.freeze({contract:R008_RECONCILIATION_CONTRACT,
  reconcile(raw:unknown):R008ConflictReview{
   if(config.enabled!==true)return base(scope,'DEFAULT_DISABLED');
   try{
    const now=config.nowSeconds();
    if(!positive(now))return base(scope,'INVALID_CLOCK');
    const pair=own(raw,pairFields);
    if(!pair)return base(scope,'MALFORMED_PAIR');
    const store=checkReview(pair.store,scope),rc=checkReview(pair.revenuecat,scope);
    if(!store||!rc||!['apple','google'].includes(store.provider_candidate)||
     rc.provider_candidate!=='revenuecat')
     return base(scope,'SOURCE_NOT_AUTHENTICATED');
    const c=own(pair.correlation,corrFields);
    if(!validCorr(c,scope,now))return base(scope,'MALFORMED_CORRELATION');
    if((store.provider_candidate==='apple'&&c.platform!=='ios')||
       (store.provider_candidate==='google'&&c.platform!=='android'))
      return base(scope,'STORE_PLATFORM_CONFLICT');
    // A matching *claimed* member/order digest is not a verified App User ID.
    if(c.store_member_digest!==c.rc_member_digest)
     return base(scope,'REVENUECAT_MEMBER_MAPPING_CONFLICT');
    if(c.store_original_order_digest!==c.rc_original_order_digest)
     return base(scope,'REVENUECAT_ORDER_LINK_CONFLICT');
    const storeTerminal=['refund','revoke'].includes(store.event_candidate)||
     store.state_candidate==='revoked';
    const rcTerminal=['refund','revoke'].includes(rc.event_candidate)||
     rc.state_candidate==='revoked';
    if(storeTerminal||rcTerminal)return base(scope,'REFUND_OR_REVOCATION_DENIES_RESTORE');
    if(['expire','grace'].includes(store.event_candidate)||
       ['expire','grace'].includes(rc.event_candidate)||
       store.state_candidate==='expired'||rc.state_candidate==='expired')
     return base(scope,'EXPIRED_OR_GRACE_NO_VERIFIED_ENTITLEMENT');
    if(store.event_candidate!==rc.event_candidate)
     return base(scope,'INCONSISTENT_VENDOR_EVENT_STATE');
    if(store.event_candidate==='restore')
     return base(scope,'RESTORE_NEEDS_AUTHORITY_AND_LEDGER');
    if(store.state_candidate!=='unverified_active'||rc.state_candidate!=='unverified_active')
     return base(scope,'UNKNOWN_VENDOR_STATE');
    return Object.freeze({...base(scope,'UNVERIFIED_DOUBLE_SOURCE'),
     status:'review_only',reason:'MATCHING_UNVERIFIED_CLAIMS_NO_AUTHORITY',
     store_candidate:store.provider_candidate as 'apple'|'google',
     revenuecat_candidate:true});
   }catch{return base(scope,'SOURCE_OR_INPUT_UNAVAILABLE');}
  }
 });
}
