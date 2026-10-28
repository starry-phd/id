/**
 * AI-2 Wave1 / Round-001: approved Q1-Q3 / D03+D07 offline Billing review.
 * These are candidate policies, NEVER actual Store/RevenueCat authorization.
 * The sole live Billing writer, Store verifier and Auth remain independent.
 */
export const WAVE1_BILLING_CONTRACT='starry.billing.wave1.review.v1-offline' as const;
export const WAVE1_BILLING_LIVE=false as const;
export type IapKind='NON_CONSUMABLE'|'AUTO_RENEWABLE_SUBSCRIPTION';
export type IapPeriod='MONTH'|'YEAR';
export type Platform='ios'|'android';
export type CandidateProduct=Readonly<{
 product_key:string;kind:IapKind;period:IapPeriod|null;
 sku_ios:string;sku_android:string;features:readonly string[];
}>;
export type CandidateEvent=Readonly<{
 event_ref:string;brand_id:'starry';app_id:string;environment:'development'|'staging';
 member_digest:string;product_key:string;platform:Platform;
 source:'revenuecat_unverified_fixture';version:number;
 status:'active'|'expired'|'refunded'|'revoked'|'grace'|'hold';
 expires_at_sec:number|null;
}>;
export type OfflineIdentity=Readonly<{
 kind:'offline_auth_fixture_only';brand_id:'starry';
 app_id:string;member_digest:string;auth_version:number;
 session_state:'active'|'expired'|'revoked'|'guest';
}>;
export type BillingReview=Readonly<{
 contract:typeof WAVE1_BILLING_CONTRACT;
 status:'blocked'|'review_only';reason:string;
 app_id:string;product_key:string;
 permanent_candidate:'none'|'active_local'|'revoked_local';
 subscription_candidate:'none'|'active_local'|'expired_local'|'revoked_local';
 cross_platform_review_only:boolean;
 official_revenuecat_verified:false;official_store_verified:false;
 authenticated_live_session:false;may_start_purchase:false;
 may_restore_purchase:false;may_grant:false;may_regrant:false;
 may_remove_ads:false;may_ack_webhook:false;may_publish:false;live:false;
}>;
type Scope=Readonly<{brand_id:'starry';app_id:string;
 environment:'development'|'staging'}>;
type Ports=Readonly<{
 /** DEV-D's actual signed Auth session authority must replace this in an
  * independently reviewed adapter. This port is NEVER live authorization. */
 readIdentity:()=>Promise<unknown>;
 /** Untrusted synthetic local events, NOT verified webhook/Store history. */
 readCandidateEvents:()=>Promise<unknown>;
}>;
const ID=/^[a-z][a-z0-9._-]{2,70}$/;
const REF=/^r_[a-f0-9]{64}$/;
const MEMBER=/^m_[a-f0-9]{64}$/;
const FORBIDDEN=/battery|電池|sticker|貼紙|consumable|top.?up/i;
const isObj=(x:unknown):x is Record<string,unknown>=>{
 try{return !!x&&typeof x==='object'&&!Array.isArray(x)
  &&(Object.getPrototypeOf(x)===Object.prototype||
    Object.getPrototypeOf(x)===null);}catch{return false;}
};
function exact(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 if(!isObj(x))return null;
 try{
  const d=Object.getOwnPropertyDescriptors(x);
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const v=d[k];if(!v||!v.enumerable||!('value' in v))return null;
   o[k]=v.value;
  }
  return o;
 }catch{return null;}
}
const PRODUCT=['product_key','kind','period','sku_ios','sku_android','features'];
const EVENT=['event_ref','brand_id','app_id','environment','member_digest',
 'product_key','platform','source','version','status','expires_at_sec'];
const IDENTITY=['kind','brand_id','app_id','member_digest','auth_version',
 'session_state'];
const SCOPES=['brand_id','app_id','environment'];
const POS=(x:unknown):x is number=>typeof x==='number'
 &&Number.isSafeInteger(x)&&x>0;
const CLEAN=(x:unknown):x is string=>typeof x==='string'
 &&ID.test(x)&&!FORBIDDEN.test(x);
function product(x:unknown):x is CandidateProduct{
 const p=exact(x,PRODUCT);
 if(!p||!CLEAN(p.product_key)||!CLEAN(p.sku_ios)
  ||!CLEAN(p.sku_android)||p.sku_ios===p.sku_android
  ||(p.kind!=='NON_CONSUMABLE'&&p.kind!=='AUTO_RENEWABLE_SUBSCRIPTION')
  ||(p.kind==='NON_CONSUMABLE'&&p.period!==null)
  ||(p.kind==='AUTO_RENEWABLE_SUBSCRIPTION'
     &&p.period!=='MONTH'&&p.period!=='YEAR')
  ||!Array.isArray(p.features)||p.features.length<1
  ||p.features.length>20||!p.features.every(CLEAN)
  ||new Set(p.features).size!==p.features.length)return false;
 return true;
}
const response=(s:Scope,key:string,status:BillingReview['status'],
 reason:string,permanent:BillingReview['permanent_candidate']='none',
 subscription:BillingReview['subscription_candidate']='none',
 cross=false):BillingReview=>Object.freeze({
 contract:WAVE1_BILLING_CONTRACT,status,reason,app_id:s.app_id,
 product_key:key,permanent_candidate:permanent,
 subscription_candidate:subscription,cross_platform_review_only:cross,
 official_revenuecat_verified:false,official_store_verified:false,
 authenticated_live_session:false,may_start_purchase:false,
 may_restore_purchase:false,may_grant:false,may_regrant:false,
 may_remove_ads:false,may_ack_webhook:false,may_publish:false,live:false
});
function event(x:unknown,s:Scope,member:string,products:Map<string,CandidateProduct>){
 const e=exact(x,EVENT);
 if(!e||!CLEAN(e.product_key)||!products.has(e.product_key as string)
  ||typeof e.event_ref!=='string'||!REF.test(e.event_ref)
  ||e.brand_id!=='starry'||e.app_id!==s.app_id
  ||e.environment!==s.environment||e.member_digest!==member
  ||(e.platform!=='ios'&&e.platform!=='android')
  ||e.source!=='revenuecat_unverified_fixture'||!POS(e.version)
  ||!['active','expired','refunded','revoked','grace','hold'].includes(e.status as string)
  ||(e.expires_at_sec!==null&&!POS(e.expires_at_sec)))return null;
 const p=products.get(e.product_key as string)!;
 if(p.kind==='NON_CONSUMABLE'&&e.expires_at_sec!==null)return null;
 if(p.kind==='AUTO_RENEWABLE_SUBSCRIPTION'
  &&(typeof e.expires_at_sec!=='number'||!POS(e.expires_at_sec)))return null;
 return e;
}
export function createOfflineWave1BillingPolicy(deps:Readonly<{
 scope:Scope;products:readonly CandidateProduct[];ports:Ports;
 enabled?:boolean;nowSeconds:number;
}>){
 const s=exact(deps?.scope,SCOPES);
 if(!s||s.brand_id!=='starry'||!CLEAN(s.app_id)
  ||!['development','staging'].includes(s.environment as string)
  ||!Array.isArray(deps.products)||deps.products.length>80
  ||!deps.products.every(product)||!POS(deps.nowSeconds)
  ||typeof deps.ports?.readIdentity!=='function'
  ||typeof deps.ports?.readCandidateEvents!=='function')
  throw Error('WAVE1_INVALID_CONFIG');
 const scope=Object.freeze({...s}) as Scope;
 const map=new Map<string,CandidateProduct>();
 const skus=new Set<string>();
 for(const p of deps.products){
  if(map.has(p.product_key)||skus.has(p.sku_ios)||skus.has(p.sku_android))
   throw Error('WAVE1_DUPLICATE_STORE_MAPPING');
  map.set(p.product_key,Object.freeze({...p,features:Object.freeze([...p.features])}));
  skus.add(p.sku_ios);skus.add(p.sku_android);
 }
 const identity=async():Promise<string|null>=>{
  const x=exact(await deps.ports.readIdentity(),IDENTITY);
  if(!x||x.kind!=='offline_auth_fixture_only'||x.brand_id!=='starry'
   ||x.app_id!==scope.app_id||typeof x.member_digest!=='string'
   ||!MEMBER.test(x.member_digest)||!POS(x.auth_version)
   ||x.session_state!=='active')return null;
  return x.member_digest as string;
 };
 return Object.freeze({
  contract:WAVE1_BILLING_CONTRACT,
  async purchasePreflight(key:unknown){
   // A mobile cache or mock identity is not a signed Auth session.
   // Check Q2 early but NEVER invoke a real purchase from this adapter.
   if(deps.enabled!==true||typeof key!=='string'||!map.has(key))
    return response(scope,String(key),'blocked','DISABLED_OR_UNLISTED');
   try{
    if(!(await identity()))return response(scope,key,'blocked','SIGNED_STARRY_SESSION_REQUIRED');
    return response(scope,key,'blocked','LIVE_AUTH_AND_STORE_NOT_APPROVED');
   }catch{return response(scope,key,'blocked','AUTH_UNAVAILABLE');}
  },
  async inspect(key:unknown):Promise<BillingReview>{
   if(deps.enabled!==true||typeof key!=='string'||!map.has(key))
    return response(scope,String(key),'blocked','DISABLED_OR_UNLISTED');
   try{
    const member=await identity();
    if(!member)return response(scope,key,'blocked','SIGNED_STARRY_SESSION_REQUIRED');
    const raw=await deps.ports.readCandidateEvents();
    if(!Array.isArray(raw)||raw.length>500)
     return response(scope,key,'blocked','UNTRUSTED_STORE_HISTORY');
    // All provided events must fit this ONE member and ONE App, not just
    // events matching the requested product. This prevents cross-app mixing.
    const rows:Record<string,unknown>[]=[];
    const seen=new Map<string,string>();
    const versions=new Map<string,Record<string,unknown>>();
    for(const item of raw){
     const e=event(item,scope,member,map);
     if(!e)return response(scope,key,'blocked','FOREIGN_OR_INVALID_EVENT');
     const encoded=JSON.stringify(e);
     const ref=e.event_ref as string;
     if(seen.has(ref)){
      if(seen.get(ref)!==encoded)
       return response(scope,key,'blocked','CONFLICTING_WEBHOOK_REPLAY');
      continue; // idempotent duplicate of same local event
     }
     seen.set(ref,encoded);rows.push(e);
     const k=(e.product_key as string)+'|'+e.platform;
     const previous=versions.get(k);
     if(previous&&previous.version===e.version
      &&JSON.stringify(previous)!==encoded)
      return response(scope,key,'blocked','NONMONOTONIC_SOURCE_VERSION');
     if(!previous||(e.version as number)>(previous.version as number))
      versions.set(k,e);
    }
    const target=map.get(key)!;
    let permanent:BillingReview['permanent_candidate']='none';
    let subscription:BillingReview['subscription_candidate']='none';
    const selected=[...versions.values()].filter(x=>x.product_key===key);
    for(const x of selected){
     const positive=x.status==='active';
     if(target.kind==='NON_CONSUMABLE'){
      if(positive)permanent='active_local';
      else if(permanent!=='active_local')permanent='revoked_local';
     }else{
      if(positive&&(x.expires_at_sec as number)>deps.nowSeconds)
       subscription='active_local';
      else if(subscription!=='active_local')subscription=
       ['refunded','revoked'].includes(x.status as string)
        ?'revoked_local':'expired_local';
     }
    }
    // Deliberately no paid entitlement: these statuses are MOCK REVIEWS.
    const platforms=new Set(selected.filter(x=>
      x.status==='active'&&(target.kind==='NON_CONSUMABLE'
       ||(x.expires_at_sec as number)>deps.nowSeconds))
      .map(x=>x.platform));
    const cross=platforms.size>0;
    return response(scope,key,'review_only',
     'UNVERIFIED_REVENUECAT_AND_STORE_AUTHORITY',permanent,subscription,cross);
   }catch{return response(scope,key,'blocked','AUTH_OR_STORE_READ_UNAVAILABLE');}
  }
 });
}
