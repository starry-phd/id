/** AI-2 R004: deny-only, cross-product current-Auth continuity inspection.
 * Not an Apple/Google/RevenueCat Store authority or AdMob SDK.
 * AI-1 remains the sole signed Session/Member authority. No DB writer.
 */
import type {R003IdentityAuthorityPort,R003BillingResult} from './wave1-r003-canonical-identity-store-review.ts';
export const R004_BILLING_CONTINUITY='starry.billing.r004.entitlement-continuity.v1-candidate' as const;
export const R004_BILLING_LIVE=false as const;
const AUTH='starry.auth.identity-authority.r003.v1-candidate' as const;
const BILLING='starry.billing.r003.auth-store-fence.v1-candidate' as const;
const ID=/^[a-z][a-z0-9._-]{2,70}$/;
const DIGEST=/^m_[a-f0-9]{64}$/,BIND=/^s_[a-f0-9]{64}$/;
const KID=/^[a-z0-9][a-z0-9._-]{2,63}$/;
const FORBIDDEN=/battery|電池|top.?up|consumable|sticker/i;
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
type Platform='ios'|'android';
type Candidate='none'|'unverified_active'|'expired'|'revoked';
type Mode='buyout'|'subscription'|'both';
type Product=Readonly<{product_key:string;kind:'NON_CONSUMABLE'|'AUTO_RENEWABLE_SUBSCRIPTION';period:null|'MONTH'|'YEAR';features:readonly string[]}>;
export type R004Plan=Readonly<{app_id:string;mode:Mode;products:readonly Product[];
 adsProviderSelection:'google-admob-mediation';adsEnabled:false;
 adsSdkInitialized:false;adRequestsEnabled:false}>;
type Proof=Readonly<{kind:'signed_auth_d1_review_only';contract:typeof AUTH;
 brand_id:'starry';app_id:string;environment:'development'|'staging';
 purpose:'billing_identity_review';digest_format:'ai1.r002.json-hmac.v1';
 member_digest:string;session_binding:string;digest_kid:string;digest_epoch:number;
 auth_version:number;checked_at:number;expires_at:number;session_state:'active';
 verified_live:false;billing_authorized:false}>;
export type R004Review=Readonly<{contract:typeof R004_BILLING_CONTINUITY;
 status:'blocked'|'review_only';reason:string;app_id:string;platform:Platform|null;mode:Mode;
 candidates:readonly Readonly<{product_key:string;kind:Product['kind'];period:Product['period'];
 state:Candidate;features:readonly string[]}>[];
 permanent_candidate:'none'|'unverified_active'|'revoked';
 subscription_candidate:'none'|'unverified_active'|'expired'|'revoked';
 ads_removal_candidate_review_only:boolean;
 adsProviderSelection:'google-admob-mediation';adsEnabled:false;
 adsSdkInitialized:false;adRequestsEnabled:false;
 actual_identity_provider_integrated:false;official_store_verified:false;
 official_revenuecat_verified:false;can_start_purchase:false;can_restore:false;
 can_grant:false;can_regrant:false;can_remove_ads:false;can_request_ads:false;
 can_ack_webhook:false;can_publish:false;live:false}>;
function record(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const ds=Object.getOwnPropertyDescriptors(x);
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){const d=ds[k];if(!d||!d.enumerable||!('value' in d))return null;out[k]=d.value;}
  return out;
 }catch{return null;}
}
const PROOF=['kind','contract','brand_id','app_id','environment','purpose','digest_format',
 'member_digest','session_binding','digest_kid','digest_epoch','auth_version',
 'checked_at','expires_at','session_state','verified_live','billing_authorized'];
const PUBLIC=['contract','status','reason','flow_ref','verified_live','may_open_store',
 'may_purchase','may_restore','may_grant','may_charge','may_ack_webhook'];
function validProof(x:unknown,s:Scope,now:number):x is Proof{
 const p=record(x,PROOF);
 return !!p&&p.kind==='signed_auth_d1_review_only'&&p.contract===AUTH&&
 p.brand_id==='starry'&&p.app_id===s.app_id&&p.environment===s.environment&&
 p.purpose==='billing_identity_review'&&p.digest_format==='ai1.r002.json-hmac.v1'&&
 typeof p.member_digest==='string'&&DIGEST.test(p.member_digest)&&
 typeof p.session_binding==='string'&&BIND.test(p.session_binding)&&
 typeof p.digest_kid==='string'&&KID.test(p.digest_kid)&&
 Number.isSafeInteger(p.digest_epoch)&&(p.digest_epoch as number)>0&&
 Number.isSafeInteger(p.auth_version)&&(p.auth_version as number)>0&&
 Number.isSafeInteger(p.checked_at)&&(p.checked_at as number)<=now&&
 now-(p.checked_at as number)<=5&&
 Number.isSafeInteger(p.expires_at)&&(p.expires_at as number)>now&&
 p.session_state==='active'&&p.verified_live===false&&p.billing_authorized===false;
}
function same(a:Proof,b:Proof){
 return a.member_digest===b.member_digest&&a.session_binding===b.session_binding&&
 a.digest_kid===b.digest_kid&&a.digest_epoch===b.digest_epoch&&
 a.auth_version===b.auth_version&&a.expires_at===b.expires_at&&
 a.brand_id===b.brand_id&&a.app_id===b.app_id&&a.environment===b.environment;
}
const product=(x:unknown):x is Product=>{
 const p=record(x,['product_key','kind','period','features']);
 return !!p&&typeof p.product_key==='string'&&ID.test(p.product_key)&&!FORBIDDEN.test(p.product_key)&&
 (p.kind==='NON_CONSUMABLE'?p.period===null:p.kind==='AUTO_RENEWABLE_SUBSCRIPTION'&&
 (p.period==='MONTH'||p.period==='YEAR'))&&Array.isArray(p.features)&&
 p.features.length>0&&p.features.length<=20&&
 p.features.every((f:unknown)=>typeof f==='string'&&ID.test(f)&&!FORBIDDEN.test(f))&&
 new Set(p.features).size===p.features.length;
};
function disabled(s:Scope,mode:Mode,reason:string):R004Review{
 return Object.freeze({contract:R004_BILLING_CONTINUITY,status:'blocked',reason,
 app_id:s.app_id,platform:null,mode,candidates:Object.freeze([]),
 permanent_candidate:'none',subscription_candidate:'none',
 ads_removal_candidate_review_only:false,
 adsProviderSelection:'google-admob-mediation',adsEnabled:false,
 adsSdkInitialized:false,adRequestsEnabled:false,
 actual_identity_provider_integrated:false,official_store_verified:false,
 official_revenuecat_verified:false,can_start_purchase:false,can_restore:false,
 can_grant:false,can_regrant:false,can_remove_ads:false,can_request_ads:false,
 can_ack_webhook:false,can_publish:false,live:false});
}
function safeResult(x:unknown,s:Scope,p:Product,os:Platform):Candidate|null{
 if(!x||typeof x!=='object')return null;
 const r=x as Partial<R003BillingResult>;
 if(r.contract!==BILLING||r.status!=='review_only'||r.app_id!==s.app_id||
 r.product_key!==p.product_key||r.platform!==os||
 r.auth_reread_count!==3||r.official_store_verified!==false||
 r.official_revenuecat_verified!==false||r.approved_identity_mapping!==false||
 r.cross_store_transaction_transfer!==false||r.can_start_purchase!==false||
 r.can_restore!==false||r.can_grant!==false||r.can_remove_ads!==false||
 r.can_ack_webhook!==false||r.can_publish!==false||r.live!==false)return null;
 return ['none','unverified_active','expired','revoked'].includes(r.candidate_state as string)
  ?r.candidate_state as Candidate:null;
}
export function createOfflineR004EntitlementReview(d:Readonly<{
 enabled?:boolean;scope:Scope;identity:R003IdentityAuthorityPort;
 plan:R004Plan;nowSeconds:()=>number;
 reviewerForProduct:(product_key:string)=>Readonly<{
 contract:typeof BILLING;inspect:(request:unknown,intent:unknown,product:string,platform:Platform)=>Promise<unknown>}>;
}>){
 const s=d?.scope,plan=d?.plan;
 if(!s||s.brand_id!=='starry'||!ID.test(s.app_id)||!plan||
 (s.environment!=='development'&&s.environment!=='staging')||plan.app_id!==s.app_id||
 !['buyout','subscription','both'].includes(plan.mode)||
 plan.adsProviderSelection!=='google-admob-mediation'||plan.adsEnabled!==false||
 plan.adsSdkInitialized!==false||plan.adRequestsEnabled!==false||
 !Array.isArray(plan.products)||plan.products.length<1||plan.products.length>3||
 !plan.products.every(product)||
 new Set(plan.products.map(p=>p.product_key)).size!==plan.products.length||
 d.identity?.contract!==AUTH||typeof d.identity.reviewFresh!=='function'||
 typeof d.identity.readServerReview!=='function'||
 typeof d.reviewerForProduct!=='function'||typeof d.nowSeconds!=='function')
 throw Error('R004_INVALID_SCOPE_OR_POLICY');
 const buy=plan.products.filter(p=>p.kind==='NON_CONSUMABLE');
 const sub=plan.products.filter(p=>p.kind==='AUTO_RENEWABLE_SUBSCRIPTION');
 if(buy.length>1||sub.length>2||new Set(sub.map(p=>p.period)).size!==sub.length||
 ((plan.mode==='buyout'||plan.mode==='both')!==!!buy.length)||
 ((plan.mode==='subscription'||plan.mode==='both')!==(sub.length>0)))
 throw Error('R004_INCONSISTENT_PRODUCT_MODE');
 const scope=Object.freeze({...s}),mode=plan.mode;
 const items=Object.freeze(plan.products.map(p=>Object.freeze({...p,features:Object.freeze([...p.features])})));
 async function auth(request:unknown,intent:unknown,previous?:unknown){
  const now=d.nowSeconds();if(!Number.isSafeInteger(now)||now<1)return null;
  const v=await d.identity.reviewFresh(request,intent,now,previous);
  const pub=record(v,PUBLIC);
  if(!pub||pub.contract!==AUTH||pub.status!=='review_only'||
   pub.verified_live!==false||pub.may_open_store!==false||
   pub.may_purchase!==false||pub.may_restore!==false||pub.may_grant!==false||
   pub.may_charge!==false||pub.may_ack_webhook!==false)return null;
  const privateProof=d.identity.readServerReview(v,intent,now);
  if(!validProof(privateProof,scope,now))return null;
  return {view:v,proof:privateProof};
 }
 return Object.freeze({contract:R004_BILLING_CONTINUITY,
  async inspect(request:unknown,intent:unknown,os:unknown):Promise<R004Review>{
   if(d.enabled!==true||(os!=='ios'&&os!=='android'))return disabled(scope,mode,'DISABLED_OR_PLATFORM');
   try{
    let previous=await auth(request,intent);
    if(!previous)return disabled(scope,mode,'CURRENT_AUTH_REQUIRED');
    const candidates:{product_key:string;kind:Product['kind'];period:Product['period'];
     state:Candidate;features:readonly string[]}[]=[];
    for(const item of items){
     const inspector=d.reviewerForProduct(item.product_key);
     if(!inspector||inspector.contract!==BILLING||typeof inspector.inspect!=='function')
      return disabled(scope,mode,'BILLING_REVIEWER_NOT_CANONICAL');
     const result=await inspector.inspect(request,intent,item.product_key,os);
     const state=safeResult(result,scope,item,os);
     if(!state)return disabled(scope,mode,'UNVERIFIED_OR_FOREIGN_PRODUCT_REVIEW');
     const next=await auth(request,intent,previous.view);
     if(!next||!same(previous.proof,next.proof))
      return disabled(scope,mode,'AUTH_CHANGED_DURING_PRODUCTS');
     previous=next;
     candidates.push(Object.freeze({product_key:item.product_key,kind:item.kind,
      period:item.period,state,features:item.features}));
    }
    const permanent=candidates.find(x=>x.kind==='NON_CONSUMABLE');
    const subscriptions=candidates.filter(x=>x.kind==='AUTO_RENEWABLE_SUBSCRIPTION');
    const permanent_state=permanent?.state==='unverified_active'?'unverified_active':
     permanent?.state==='revoked'?'revoked':'none';
    const subscription_state=subscriptions.some(x=>x.state==='revoked')?'revoked':
     subscriptions.some(x=>x.state==='unverified_active')?'unverified_active':
     subscriptions.some(x=>x.state==='expired')?'expired':'none';
    const adsCandidate=candidates.some(x=>x.state==='unverified_active'&&
     x.features.includes('ads_free'));
    return Object.freeze({...disabled(scope,mode,'UNVERIFIED_STORE_AUTHORITIES'),
     status:'review_only',reason:'AUTH_CONTINUITY_REVIEW_ONLY_NO_STORE_GRANT',
     platform:os,candidates:Object.freeze(candidates),
     permanent_candidate:permanent_state,subscription_candidate:subscription_state,
     ads_removal_candidate_review_only:adsCandidate});
   }catch{return disabled(scope,mode,'AUTH_OR_REVIEW_UNAVAILABLE');}
  }
 });
}
