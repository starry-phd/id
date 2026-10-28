/** AI-2 R006 Store/RevenueCat SYNTHETIC provenance boundary.
 * This HMAC fixture is NOT an Apple JWS, Google Developer API verification,
 * RevenueCat webhook signature, real Store receipt or verified entitlement.
 * AI-0 P05 vNext uses a DIFFERENT contract and signature domain and is NOT imported.
 * No account identifiers, keys, receipts, network, persistence, purchase, ACK or grants.
 */
import type {R003IdentityAuthorityPort} from './wave1-r003-canonical-identity-store-review.ts';
import type {R005CrossOsReview} from './wave1-r005-cross-os-signed-auth-review.ts';
import {R005_CROSS_OS_CONTRACT} from './wave1-r005-cross-os-signed-auth-review.ts';
export const R006_STORE_BOUNDARY='starry.billing.r006.synthetic-store-provenance.v1-offline-candidate' as const;
export const R006_STORE_LIVE=false as const;
export const R006_P05_DEPENDENCY='starry.p05.canonical.vnext.offline-candidate' as const;
export const R006_P05_PURPOSE='p05_delivery_review_only' as const;
export const R006_P05_SIGNATURE_DOMAIN='starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1' as const;
const DOMAIN='starry.ai2.billing.r006.synthetic-store-only:hmac-sha256:v1';
const AUTH='starry.auth.identity-authority.r003.v1-candidate';
const MODEL='starry.billing.r006.synthetic-event.v1';
const id=/^[a-z][a-z0-9._:-]{2,95}$/;
const digest=/^m_[0-9a-f]{64}$/,binding=/^s_[0-9a-f]{64}$/;
const kid=/^[a-z0-9][a-z0-9._-]{2,63}$/;
const hex=/^[0-9a-f]{64}$/;
const ban=/battery|電池|consumable|top.?up|hglobal|sticker/i;
const order=['version','source','brand_id','app_id','environment','platform',
 'event_id','webhook_id','product_key','store_sku','kind','period',
 'transaction_id','original_transaction_id','member_digest','event_type',
 'source_version','issued_at','expires_at','kid'] as const;
const publicKeys=['contract','status','reason','flow_ref','verified_live','may_open_store',
 'may_purchase','may_restore','may_grant','may_charge','may_ack_webhook'];
const privateKeys=['kind','contract','brand_id','app_id','environment','purpose','digest_format',
 'member_digest','session_binding','digest_kid','digest_epoch','auth_version','checked_at',
 'expires_at','session_state','verified_live','billing_authorized'];
type Platform='ios'|'android';
type Source='apple_sandbox_fixture'|'google_sandbox_fixture'|'revenuecat_webhook_fixture';
type EventType='purchase'|'renewal'|'refund'|'revoke'|'expire'|'grace'|'restore';
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
type Sku=Readonly<{product_key:string;kind:'NON_CONSUMABLE'|'AUTO_RENEWABLE_SUBSCRIPTION';
 period:null|'MONTH'|'YEAR';ios_sku:string;android_sku:string}>;
type Payload=Readonly<{version:typeof MODEL;source:Source;brand_id:'starry';app_id:string;
 environment:'development'|'staging';platform:Platform;event_id:string;webhook_id:string;
 product_key:string;store_sku:string;kind:Sku['kind'];period:Sku['period'];
 transaction_id:string;original_transaction_id:string;member_digest:string;
 event_type:EventType;source_version:number;issued_at:number;expires_at:number;kid:string}>;
type Lease=Readonly<{kid:string;epoch:number;key:CryptoKey}>;
export type R006StoreReview=Readonly<{contract:typeof R006_STORE_BOUNDARY;
 status:'blocked'|'review_only';reason:string;app_id:string;
 source_candidate:Source|null;product_candidate:string|null;
 state_candidate:'none'|'unverified_active'|'expired'|'revoked';
 cross_os_content_candidate_review_only:boolean;ads_removal_candidate_review_only:boolean;
 p05_dependency:typeof R006_P05_DEPENDENCY;adsProviderSelection:'google-admob-mediation';
 adsEnabled:false;adsSdkInitialized:false;adRequestsEnabled:false;
 synthetic_signature_review_only:boolean;official_apple_verified:false;
 official_google_verified:false;official_revenuecat_verified:false;
 revenuecat_app_user_id_approved:false;durable_cas_verified:false;
 independent_anti_pitr_verified:false;can_purchase:false;can_restore:false;
 can_grant:false;can_regrant:false;can_remove_ads:false;can_request_ads:false;
 can_ack_webhook:false;can_send_p05:false;can_publish:false;live:false}>;
function extract(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const names=Reflect.ownKeys(x);
  if(names.length!==keys.length||names.some((k,i)=>k!==keys[i]))return null;
  const desc=Object.getOwnPropertyDescriptors(x);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){const d=desc[k];if(!d||!d.enumerable||!('value' in d))return null;out[k]=d.value;}
  return out;
 }catch{return null;}
}
function positive(n:unknown):n is number{return typeof n==='number'&&Number.isSafeInteger(n)&&n>0;}
function validKey(k:Lease|null,need:CryptoKey['usages'][number]):k is Lease{
 return !!k&&typeof k.kid==='string'&&kid.test(k.kid)&&positive(k.epoch)&&!!k.key&&
 k.key.type==='secret'&&!k.key.extractable&&k.key.algorithm.name==='HMAC'&&
 (k.key.algorithm as HmacKeyAlgorithm).hash.name==='SHA-256'&&k.key.usages.includes(need);
}
function same(a:Record<string,unknown>,b:Record<string,unknown>){
 return a.member_digest===b.member_digest&&a.session_binding===b.session_binding&&
 a.digest_kid===b.digest_kid&&a.digest_epoch===b.digest_epoch&&
 a.auth_version===b.auth_version&&a.expires_at===b.expires_at;
}
function blocked(scope:Scope,reason:string):R006StoreReview{
 return Object.freeze({contract:R006_STORE_BOUNDARY,status:'blocked',reason,app_id:scope.app_id,
 source_candidate:null,product_candidate:null,state_candidate:'none',
 cross_os_content_candidate_review_only:false,ads_removal_candidate_review_only:false,
 p05_dependency:R006_P05_DEPENDENCY,adsProviderSelection:'google-admob-mediation',
 adsEnabled:false,adsSdkInitialized:false,adRequestsEnabled:false,
 synthetic_signature_review_only:false,official_apple_verified:false,
 official_google_verified:false,official_revenuecat_verified:false,
 revenuecat_app_user_id_approved:false,durable_cas_verified:false,
 independent_anti_pitr_verified:false,can_purchase:false,can_restore:false,
 can_grant:false,can_regrant:false,can_remove_ads:false,can_request_ads:false,
 can_ack_webhook:false,can_send_p05:false,can_publish:false,live:false});
}
function validPayload(p:Record<string,unknown>|null,scope:Scope,now:number):p is Record<string,unknown> & Payload{
 if(!p||p.version!==MODEL||p.brand_id!=='starry'||p.app_id!==scope.app_id||
 p.environment!==scope.environment||!['ios','android'].includes(p.platform as string)||
 !['apple_sandbox_fixture','google_sandbox_fixture','revenuecat_webhook_fixture'].includes(p.source as string)||
 (p.source==='apple_sandbox_fixture'&&p.platform!=='ios')||
 (p.source==='google_sandbox_fixture'&&p.platform!=='android')||
 !['purchase','renewal','refund','revoke','expire','grace','restore'].includes(p.event_type as string)||
 !['NON_CONSUMABLE','AUTO_RENEWABLE_SUBSCRIPTION'].includes(p.kind as string)||
 (p.kind==='NON_CONSUMABLE'?p.period!==null:!['MONTH','YEAR'].includes(p.period as string))||
 !positive(p.source_version)||!positive(p.issued_at)||!positive(p.expires_at)||
 (p.issued_at as number)>now+5||(p.expires_at as number)<=now||
 (p.expires_at as number)<=(p.issued_at as number)||
 (p.expires_at as number)-(p.issued_at as number)>120||
 typeof p.member_digest!=='string'||!digest.test(p.member_digest)||
 typeof p.kid!=='string'||!kid.test(p.kid))return false;
 for(const k of ['event_id','webhook_id','product_key','store_sku',
 'transaction_id','original_transaction_id'] as const)
 if(typeof p[k]!=='string'||!id.test(p[k])||ban.test(p[k]))return false;
 return true;
}
export function createOfflineR006SignedStoreBoundary(d:Readonly<{
 enabled?:boolean;scope:Scope;identity:R003IdentityAuthorityPort;
 crossOs:Readonly<{contract:typeof R005_CROSS_OS_CONTRACT;
 inspect:(iosRequest:unknown,iosIntent:unknown,androidRequest:unknown,androidIntent:unknown)=>Promise<R005CrossOsReview>}>;
 skuCatalog:readonly Sku[];nowSeconds:()=>number;
 /** Ephemeral test key lease ONLY; never official Store or RevenueCat key custody. */
 readSyntheticFixtureVerificationKey:(source:Source,kid:string)=>Promise<Lease|null>;
}>){
 const s=d?.scope;
 if(!s||s.brand_id!=='starry'||typeof s.app_id!=='string'||!id.test(s.app_id)||
 ban.test(s.app_id)||(s.environment!=='development'&&s.environment!=='staging')||
 d.identity?.contract!==AUTH||typeof d.identity.reviewFresh!=='function'||
 typeof d.identity.readServerReview!=='function'||
 d.crossOs?.contract!==R005_CROSS_OS_CONTRACT||typeof d.crossOs.inspect!=='function'||
 typeof d.nowSeconds!=='function'||typeof d.readSyntheticFixtureVerificationKey!=='function'||
 !Array.isArray(d.skuCatalog)||d.skuCatalog.length<1||d.skuCatalog.length>30)
 throw Error('R006_SCOPE_OR_AUTH_NOT_TRUSTED');
 const products=new Map<string,Sku>(),allSku=new Set<string>();
 for(const raw of d.skuCatalog){
  const p=extract(raw,['product_key','kind','period','ios_sku','android_sku']);
  if(!p||typeof p.product_key!=='string'||!id.test(p.product_key)||ban.test(p.product_key)||
  !['NON_CONSUMABLE','AUTO_RENEWABLE_SUBSCRIPTION'].includes(p.kind as string)||
  (p.kind==='NON_CONSUMABLE'?p.period!==null:!['MONTH','YEAR'].includes(p.period as string))||
  typeof p.ios_sku!=='string'||!id.test(p.ios_sku)||ban.test(p.ios_sku)||
  typeof p.android_sku!=='string'||!id.test(p.android_sku)||ban.test(p.android_sku)||
  p.ios_sku===p.android_sku||products.has(p.product_key as string)||
  allSku.has(p.ios_sku)||allSku.has(p.android_sku))
   throw Error('R006_UNKNOWN_PRODUCT_OR_DUPLICATE_SKU');
  products.set(p.product_key as string,Object.freeze(p as unknown as Sku));
  allSku.add(p.ios_sku as string);allSku.add(p.android_sku as string);
 }
 const scope=Object.freeze({...s});
 // In-memory denial instrumentation only. NOT persistent replay protection, CAS, PITR or entitlement writer.
 const replay=new Set<string>(),last=new Map<string,{version:number;terminal:boolean}>(),
 transactionOwners=new Map<string,string>();
 async function current(request:unknown,intent:unknown,previous?:unknown){
  const now=d.nowSeconds();if(!positive(now))return null;
  const view=await d.identity.reviewFresh(request,intent,now,previous);
  const pub=extract(view,publicKeys);
  if(!pub||pub.contract!==AUTH||pub.status!=='review_only'||
  pub.verified_live!==false||pub.may_open_store!==false||pub.may_purchase!==false||
  pub.may_restore!==false||pub.may_grant!==false||pub.may_charge!==false||
  pub.may_ack_webhook!==false)return null;
  const proof=extract(d.identity.readServerReview(view,intent,now),privateKeys);
  if(!proof||proof.contract!==AUTH||proof.kind!=='signed_auth_d1_review_only'||
  proof.purpose!=='billing_identity_review'||proof.digest_format!=='ai1.r002.json-hmac.v1'||
  proof.brand_id!=='starry'||proof.app_id!==scope.app_id||
  proof.environment!==scope.environment||proof.session_state!=='active'||
  proof.verified_live!==false||proof.billing_authorized!==false||
  typeof proof.member_digest!=='string'||!digest.test(proof.member_digest)||
  typeof proof.session_binding!=='string'||!binding.test(proof.session_binding)||
  typeof proof.digest_kid!=='string'||!kid.test(proof.digest_kid)||
  !positive(proof.digest_epoch)||!positive(proof.auth_version)||
  !positive(proof.checked_at)||(proof.checked_at as number)>now||
  now-(proof.checked_at as number)>5||!positive(proof.expires_at)||
  (proof.expires_at as number)<=now)return null;
  return {view,proof};
 }
 return Object.freeze({contract:R006_STORE_BOUNDARY,
 async inspect(
  iosRequest:unknown,iosIntent:unknown,androidRequest:unknown,androidIntent:unknown,
  rawObservation:unknown):Promise<R006StoreReview>{
  if(d.enabled!==true)return blocked(scope,'DEFAULT_DISABLED');
  try{
   const now=d.nowSeconds();if(!positive(now))return blocked(scope,'CLOCK_BLOCKED');
   const wrapper=extract(rawObservation,['payload','mac_hex']);
   if(!wrapper||typeof wrapper.mac_hex!=='string'||!hex.test(wrapper.mac_hex))
    return blocked(scope,'MALFORMED_SIGNATURE_WRAPPER');
   const p=extract(wrapper.payload,order);
   if(!validPayload(p,scope,now))return blocked(scope,'UNTRUSTED_OR_CROSS_APP_PAYLOAD');
   const product=products.get(p.product_key);
   if(!product||product.kind!==p.kind||product.period!==p.period||
    p.store_sku!==(p.platform==='ios'?product.ios_sku:product.android_sku))
    return blocked(scope,'UNLISTED_OR_CROSS_APP_SKU');
   // No client-supplied 'verified' or historic P05 event may become Store authority.
   const source=p.source as Source;
   const k1=await d.readSyntheticFixtureVerificationKey(source,p.kid);
   if(!validKey(k1,'verify')||k1.kid!==p.kid)
    return blocked(scope,'TEST_KEY_UNAVAILABLE');
   const bytes=new TextEncoder().encode(JSON.stringify([DOMAIN,...order.map(k=>p[k])]));
   const sig=new Uint8Array(32);
   for(let i=0;i<32;i++)sig[i]=Number.parseInt((wrapper.mac_hex as string).slice(i*2,i*2+2),16);
   if(!await crypto.subtle.verify('HMAC',k1.key,sig,bytes))
    return blocked(scope,'SYNTHETIC_SIGNATURE_REJECTED');
   const k2=await d.readSyntheticFixtureVerificationKey(source,p.kid);
   if(!validKey(k2,'verify')||k1.kid!==k2.kid||
    k1.epoch!==k2.epoch||k1.key!==k2.key)
    return blocked(scope,'SYNTHETIC_KID_OR_EPOCH_CHANGED');
   const os=p.platform as Platform;
   const request=os==='ios'?iosRequest:androidRequest;
   const intent=os==='ios'?iosIntent:androidIntent;
   let auth=await current(request,intent);
   if(!auth||auth.proof.member_digest!==p.member_digest)
    return blocked(scope,'CURRENT_AUTH_MEMBER_REQUIRED');
   const cross=await d.crossOs.inspect(iosRequest,iosIntent,androidRequest,androidIntent);
   if(!cross||cross.contract!==R005_CROSS_OS_CONTRACT||
    cross.status!=='review_only'||cross.app_id!==scope.app_id||
    cross.same_app_member_review_only!==true||
    cross.can_purchase!==false||cross.can_restore!==false||cross.can_grant!==false||
    cross.can_remove_ads!==false||cross.can_request_ads!==false||
    cross.official_apple_verified!==false||cross.official_google_verified!==false||
    cross.official_revenuecat_verified!==false||cross.live!==false)
    return blocked(scope,'R005_CROSS_OS_CURRENT_AUTH_BLOCKED');
   const again=await current(request,intent,auth.view);
   if(!again||!same(auth.proof,again.proof))
    return blocked(scope,'AUTH_REVOKED_DURING_VERIFICATION');
   auth=again;
   const k3=await d.readSyntheticFixtureVerificationKey(source,p.kid);
   if(!validKey(k3,'verify')||k3.key!==k1.key||k3.epoch!==k1.epoch)
    return blocked(scope,'KEY_ROTATED_AFTER_AUTH');
   // No rollback/replay ID reservation BEFORE MAC/current Session validation.
   const ev=[scope.app_id,scope.environment,source,p.event_id,p.webhook_id].join('|');
   if(replay.has(ev))return blocked(scope,'WEBHOOK_REPLAY_BLOCKED');
   const transaction=[scope.app_id,scope.environment,os,p.member_digest].join('|');
   const own=transactionOwners.get(p.original_transaction_id);
   if(own&&own!==transaction)return blocked(scope,'CROSS_OS_OR_MEMBER_TRANSACTION_TRANSFER');
   const own2=transactionOwners.get(p.transaction_id);
   if(own2&&own2!==transaction)return blocked(scope,'CROSS_OS_TRANSACTION_REUSE');
   const key=[transaction,p.product_key,p.original_transaction_id].join('|');
   const previous=last.get(key);
   if(previous&&((p.source_version as number)<=previous.version||
    (previous.terminal&&p.event_type==='restore')))
    return blocked(scope,'ROLLBACK_DUPLICATE_OR_RESTORE_REVOKED');
   // Local synthetic observation ONLY. No official verification or durable grant.
   const terminal=p.event_type==='refund'||p.event_type==='revoke';
   const state:R006StoreReview['state_candidate']=terminal?'revoked':
    p.event_type==='expire'||p.event_type==='grace'?'expired':
    'unverified_active';
   replay.add(ev);
   transactionOwners.set(p.original_transaction_id as string,transaction);
   transactionOwners.set(p.transaction_id as string,transaction);
   last.set(key,{version:p.source_version as number,terminal});
   return Object.freeze({...blocked(scope,'NO_OFFICIAL_STORE_OR_REVENUECAT_AUTHORITY'),
    status:'review_only',reason:'SYNTHETIC_SIGNATURE_ONLY_NO_STORE_VERIFICATION',
    source_candidate:source,product_candidate:p.product_key as string,
    state_candidate:state,
    cross_os_content_candidate_review_only:cross.cross_os_restore_candidate_review_only,
    ads_removal_candidate_review_only:cross.remove_ads_candidate_review_only,
    synthetic_signature_review_only:true});
  }catch{return blocked(scope,'AUTH_OR_SYNTHETIC_PROVIDER_UNAVAILABLE');}
 }});
}
/** Test-only encoding utility. Never a Store or P05 signer; real receipts MUST
 * use respective official Store authority under future human approvals. */
export function r006SyntheticFixtureBytes(payload:unknown):Uint8Array|null{
 const p=extract(payload,order);
 if(!p)return null;
 return new TextEncoder().encode(JSON.stringify([DOMAIN,...order.map(k=>p[k])]));
}
