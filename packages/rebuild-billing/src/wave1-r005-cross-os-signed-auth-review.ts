/** AI-2 R005: real AI-1-port-compatible, same-app iOS/Android review ONLY.
 * Two distinct signed Sessions may belong to the same central member.
 * Identity is read via AI-1's private, single-use server Port, NEVER a UI ID.
 * No Store verification, RevenueCat account binding, D1 writes or grants.
 */
import type {R003IdentityAuthorityPort} from './wave1-r003-canonical-identity-store-review.ts';
import type {R004Review} from './wave1-r004-entitlement-continuity-review.ts';
export const R005_CROSS_OS_CONTRACT='starry.billing.r005.cross-os-signed-auth-review.v1-candidate' as const;
export const R005_CROSS_OS_LIVE=false as const;
const AUTH='starry.auth.identity-authority.r003.v1-candidate' as const;
const R004='starry.billing.r004.entitlement-continuity.v1-candidate' as const;
type Platform='ios'|'android';
type Candidate='none'|'unverified_active'|'expired'|'revoked';
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
type Private=Readonly<{member_digest:string;session_binding:string;digest_kid:string;
 digest_epoch:number;auth_version:number;expires_at:number;checked_at:number}>;
export type R005CrossOsReview=Readonly<{
 contract:typeof R005_CROSS_OS_CONTRACT;status:'blocked'|'review_only';reason:string;
 app_id:string;ios_candidate:Candidate;android_candidate:Candidate;
 same_app_member_review_only:boolean;cross_os_restore_candidate_review_only:boolean;
 buyout_candidate_review_only:boolean;subscription_candidate_review_only:boolean;
 remove_ads_candidate_review_only:boolean;
 adsProviderSelection:'google-admob-mediation';adsEnabled:false;
 adsSdkInitialized:false;adRequestsEnabled:false;can_open_store:false;
 can_purchase:false;can_restore:false;can_grant:false;can_regrant:false;
 can_remove_ads:false;can_request_ads:false;can_ack_webhook:false;
 official_apple_verified:false;official_google_verified:false;
 official_revenuecat_verified:false;durable_cas_verified:false;
 anti_pitr_verified:false;live:false}>;
type Reviewer=Readonly<{contract:typeof R004;
 inspect:(request:unknown,intent:unknown,platform:Platform)=>Promise<R004Review>}>;
const NO='none' as const;
const DIGEST=/^m_[0-9a-f]{64}$/,SESSION=/^s_[0-9a-f]{64}$/;
const KID=/^[a-z0-9][a-z0-9._-]{2,63}$/;
function plain(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return null;
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const ds=Object.getOwnPropertyDescriptors(x);
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=ds[k];if(!d||!d.enumerable||!('value' in d))return null;
   o[k]=d.value;
  }return o;
 }catch{return null;}
}
const PUB=['contract','status','reason','flow_ref','verified_live','may_open_store',
 'may_purchase','may_restore','may_grant','may_charge','may_ack_webhook'];
const PRIV=['kind','contract','brand_id','app_id','environment','purpose',
 'digest_format','member_digest','session_binding','digest_kid','digest_epoch',
 'auth_version','checked_at','expires_at','session_state','verified_live','billing_authorized'];
function same(a:Private,b:Private):boolean{
 return a.member_digest===b.member_digest&&a.session_binding===b.session_binding&&
 a.digest_kid===b.digest_kid&&a.digest_epoch===b.digest_epoch&&
 a.auth_version===b.auth_version&&a.expires_at===b.expires_at;
}
function member(a:Private,b:Private):boolean{
 return a.member_digest===b.member_digest&&a.digest_kid===b.digest_kid&&
 a.digest_epoch===b.digest_epoch&&a.auth_version===b.auth_version;
}
function deny(s:Scope,reason:string):R005CrossOsReview{
 return Object.freeze({contract:R005_CROSS_OS_CONTRACT,status:'blocked',reason,app_id:s.app_id,
 ios_candidate:NO,android_candidate:NO,same_app_member_review_only:false,
 cross_os_restore_candidate_review_only:false,buyout_candidate_review_only:false,
 subscription_candidate_review_only:false,remove_ads_candidate_review_only:false,
 adsProviderSelection:'google-admob-mediation',adsEnabled:false,
 adsSdkInitialized:false,adRequestsEnabled:false,can_open_store:false,
 can_purchase:false,can_restore:false,can_grant:false,can_regrant:false,
 can_remove_ads:false,can_request_ads:false,can_ack_webhook:false,
 official_apple_verified:false,official_google_verified:false,
 official_revenuecat_verified:false,durable_cas_verified:false,
 anti_pitr_verified:false,live:false});
}
function candidate(r:R004Review,scope:Scope,os:Platform):boolean{
 try{
  if(!r||r.contract!==R004||r.status!=='review_only'||r.app_id!==scope.app_id||
   r.platform!==os||r.reason!=='AUTH_CONTINUITY_REVIEW_ONLY_NO_STORE_GRANT'||
   r.adsProviderSelection!=='google-admob-mediation'||r.adsEnabled!==false||
   r.adsSdkInitialized!==false||r.adRequestsEnabled!==false||
   r.actual_identity_provider_integrated!==false||
   r.official_store_verified!==false||r.official_revenuecat_verified!==false||
   r.can_start_purchase!==false||r.can_restore!==false||
   r.can_grant!==false||r.can_regrant!==false||r.can_remove_ads!==false||
   r.can_request_ads!==false||r.can_ack_webhook!==false||
   r.can_publish!==false||r.live!==false||!Array.isArray(r.candidates)||
   r.candidates.length<1||r.candidates.length>3||
   !['none','unverified_active','expired','revoked'].includes(r.permanent_candidate)||
   !['none','unverified_active','expired','revoked'].includes(r.subscription_candidate)||
   typeof r.ads_removal_candidate_review_only!=='boolean')return false;
  return r.candidates.every(c=>!!c&&typeof c.product_key==='string'&&
   ['NON_CONSUMABLE','AUTO_RENEWABLE_SUBSCRIPTION'].includes(c.kind)&&
   ['none','unverified_active','expired','revoked'].includes(c.state));
 }catch{return false;}
}
export function createOfflineR005CrossOsReview(d:Readonly<{
 enabled?:boolean;scope:Scope;identity:R003IdentityAuthorityPort;
 ios:Reviewer;android:Reviewer;nowSeconds:()=>number;
}>){
 const s=d?.scope;
 if(!s||s.brand_id!=='starry'||typeof s.app_id!=='string'||
 !/^[a-z][a-z0-9._-]{2,70}$/.test(s.app_id)||
 /battery|電池|hglobal/i.test(s.app_id)||
 (s.environment!=='development'&&s.environment!=='staging')||
 d.identity?.contract!==AUTH||typeof d.identity.reviewFresh!=='function'||
 typeof d.identity.readServerReview!=='function'||
 d.ios?.contract!==R004||typeof d.ios.inspect!=='function'||
 d.android?.contract!==R004||typeof d.android.inspect!=='function'||
 typeof d.nowSeconds!=='function')throw Error('R005_UNTRUSTED_PORT_OR_SCOPE');
 const scope=Object.freeze({...s});
 async function auth(request:unknown,intent:unknown,previous?:unknown){
  const now=d.nowSeconds();
  if(!Number.isSafeInteger(now)||now<1)return null;
  const view=await d.identity.reviewFresh(request,intent,now,previous);
  const pub=plain(view,PUB);
  if(!pub||pub.contract!==AUTH||pub.status!=='review_only'||
  pub.verified_live!==false||pub.may_open_store!==false||
  pub.may_purchase!==false||pub.may_restore!==false||
  pub.may_grant!==false||pub.may_charge!==false||
  pub.may_ack_webhook!==false)return null;
  const p=plain(d.identity.readServerReview(view,intent,now),PRIV);
  if(!p||p.kind!=='signed_auth_d1_review_only'||p.contract!==AUTH||
  p.purpose!=='billing_identity_review'||p.digest_format!=='ai1.r002.json-hmac.v1'||
  p.brand_id!=='starry'||p.app_id!==scope.app_id||
  p.environment!==scope.environment||p.session_state!=='active'||
  p.verified_live!==false||p.billing_authorized!==false||
  typeof p.member_digest!=='string'||!DIGEST.test(p.member_digest)||
  typeof p.session_binding!=='string'||!SESSION.test(p.session_binding)||
  typeof p.digest_kid!=='string'||!KID.test(p.digest_kid)||
  !Number.isSafeInteger(p.digest_epoch)||(p.digest_epoch as number)<1||
  !Number.isSafeInteger(p.auth_version)||(p.auth_version as number)<1||
  !Number.isSafeInteger(p.checked_at)||(p.checked_at as number)>now||
  now-(p.checked_at as number)>5||
  !Number.isSafeInteger(p.expires_at)||(p.expires_at as number)<=now)return null;
  return {view,proof:p as unknown as Private};
 }
 return Object.freeze({contract:R005_CROSS_OS_CONTRACT,
 async inspect(iosRequest:unknown,iosIntent:unknown,
 androidRequest:unknown,androidIntent:unknown):Promise<R005CrossOsReview>{
  if(d.enabled!==true)return deny(scope,'DEFAULT_OFF');
  try{
   let i=await auth(iosRequest,iosIntent);
   if(!i)return deny(scope,'IOS_SIGNED_CURRENT_AUTH_REQUIRED');
   let a=await auth(androidRequest,androidIntent);
   if(!a)return deny(scope,'ANDROID_SIGNED_CURRENT_AUTH_REQUIRED');
   if(!member(i.proof,a.proof))
    return deny(scope,'CROSS_OS_MEMBER_OR_KID_MISMATCH');
   // Distinct Sessions are EXPECTED across operating systems. Same scoped member
   // proof required; same session binding is NOT required across devices.
   const ios=await d.ios.inspect(iosRequest,iosIntent,'ios');
   if(!candidate(ios,scope,'ios'))return deny(scope,'IOS_STORE_REVIEW_DENIED');
   const i2=await auth(iosRequest,iosIntent,i.view);
   const a2=await auth(androidRequest,androidIntent,a.view);
   if(!i2||!a2||!same(i.proof,i2.proof)||!same(a.proof,a2.proof)||
    !member(i2.proof,a2.proof))
    return deny(scope,'CURRENT_AUTH_CHANGED_AFTER_IOS');
   i=i2;a=a2;
   const android=await d.android.inspect(androidRequest,androidIntent,'android');
   if(!candidate(android,scope,'android'))
    return deny(scope,'ANDROID_STORE_REVIEW_DENIED');
   const i3=await auth(iosRequest,iosIntent,i.view);
   const a3=await auth(androidRequest,androidIntent,a.view);
   if(!i3||!a3||!same(i.proof,i3.proof)||!same(a.proof,a3.proof)||
    !member(i3.proof,a3.proof))
    return deny(scope,'CURRENT_AUTH_CHANGED_AFTER_ANDROID');
   const buy=ios.permanent_candidate==='unverified_active'||
     android.permanent_candidate==='unverified_active';
   const sub=ios.subscription_candidate==='unverified_active'||
     android.subscription_candidate==='unverified_active';
   const ads=ios.ads_removal_candidate_review_only||
     android.ads_removal_candidate_review_only;
   return Object.freeze({...deny(scope,'UNVERIFIED_STORE'),
    status:'review_only',reason:'SIGNED_AUTH_CANDIDATE_NO_STORE_PROOF',
    ios_candidate:ios.permanent_candidate==='unverified_active'?
     ios.permanent_candidate:ios.subscription_candidate,
    android_candidate:android.permanent_candidate==='unverified_active'?
     android.permanent_candidate:android.subscription_candidate,
    same_app_member_review_only:true,
    cross_os_restore_candidate_review_only:buy||sub,
    buyout_candidate_review_only:buy,
    subscription_candidate_review_only:sub,
    remove_ads_candidate_review_only:ads});
  }catch{return deny(scope,'AUTH_OR_STORE_UNAVAILABLE');}
 }});
}
