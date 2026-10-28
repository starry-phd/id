/** AI-2 R003: server-only candidate that consumes AI-1's R003 authority port.
 * Neither Auth proof nor untrusted Store fixtures can grant or restore rights.
 * No RevenueCat SDK, receipt verification, D1 writer, webhooks or route here.
 */
export const AI2_R003_CONTRACT='starry.billing.r003.auth-store-fence.v1-candidate' as const;
export const AI2_R003_LIVE=false as const;
export const AI1_R003_CONTRACT='starry.auth.identity-authority.r003.v1-candidate' as const;

type Scope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
type Intent=Scope&Readonly<{flow_ref:string}>;
type PublicIdentity=Readonly<{contract:string;status:string;verified_live:false;
 may_open_store:false;may_purchase:false;may_restore:false;may_grant:false;
 may_charge:false;may_ack_webhook:false}>;
type PrivateIdentity=Readonly<{
 kind:'signed_auth_d1_review_only';contract:string;purpose:string;digest_format:string;
 brand_id:'starry';app_id:string;environment:'development'|'staging';
 member_digest:string;session_binding:string;digest_kid:string;digest_epoch:number;
 auth_version:number;checked_at:number;expires_at:number;session_state:'active';
 verified_live:false;billing_authorized:false;
}>;
/** Must be supplied by the trusted AI-1 server after Gate1 approval. It is NOT
 * accepted from client JSON or sourced from the R002 offline_auth_fixture. */
export type R003IdentityAuthorityPort=Readonly<{
 contract:typeof AI1_R003_CONTRACT;
 reviewFresh:(request:unknown,intent:unknown,now:number,previous?:unknown)=>Promise<unknown>;
 readServerReview:(view:unknown,intent:unknown,now:number)=>PrivateIdentity|null;
}>;
export type CandidateStoreProbe=Readonly<{
 source:'revenuecat_unverified_fixture';brand_id:'starry';app_id:string;
 environment:'development'|'staging';member_digest:string;
 platform:'ios'|'android';product_key:string;store_sku:string;
 source_version:number;status:'active'|'expired'|'refunded'|'revoked'|'grace'|'hold';
 expires_at_sec:number|null;
}>;
export type CandidateSku=Readonly<{product_key:string;kind:'NON_CONSUMABLE'|'AUTO_RENEWABLE_SUBSCRIPTION';
 period:null|'MONTH'|'YEAR';sku_ios:string;sku_android:string}>;
export type R003BillingResult=Readonly<{
 contract:typeof AI2_R003_CONTRACT;status:'blocked'|'review_only';reason:string;
 app_id:string;product_key:string;platform:'ios'|'android'|null;
 candidate_state:'none'|'unverified_active'|'expired'|'revoked';
 auth_reread_count:0|3;official_store_verified:false;official_revenuecat_verified:false;
 approved_identity_mapping:false;cross_store_transaction_transfer:false;
 can_start_purchase:false;can_restore:false;can_grant:false;can_remove_ads:false;
 can_ack_webhook:false;can_publish:false;live:false;
}>;
const ID=/^[a-z][a-z0-9._-]{2,70}$/;
const DIGEST=/^m_[0-9a-f]{64}$/;
const SESSION=/^s_[0-9a-f]{64}$/;
const KID=/^[a-z0-9][a-z0-9._-]{2,63}$/;
const FORBIDDEN=/battery|電池|consumable|top.?up|sticker/i;
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
function data(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const desc=Object.getOwnPropertyDescriptors(x);
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){const d=desc[k];if(!d||!d.enumerable||!('value' in d))return null;out[k]=d.value;}
  return out;
 }catch{return null;}
}
const PUBLIC=['contract','status','reason','flow_ref','verified_live','may_open_store',
 'may_purchase','may_restore','may_grant','may_charge','may_ack_webhook'];
const PRIVATE=['kind','contract','brand_id','app_id','environment','purpose','digest_format',
 'member_digest','session_binding','digest_kid','digest_epoch','auth_version','checked_at',
 'expires_at','session_state','verified_live','billing_authorized'];
const STORE=['source','brand_id','app_id','environment','member_digest','platform',
 'product_key','store_sku','source_version','status','expires_at_sec'];
const skuKeys=['product_key','kind','period','sku_ios','sku_android'];
function equal(a:string,b:string){
 if(a.length!==b.length)return false;
 let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);
 return d===0;
}
function proofMatches(x:unknown,s:Scope,now:number):x is PrivateIdentity{
 const p=data(x,PRIVATE);
 return !!p&&p.kind==='signed_auth_d1_review_only'&&p.contract===AI1_R003_CONTRACT
 &&p.brand_id==='starry'&&p.app_id===s.app_id&&p.environment===s.environment
 &&p.purpose==='billing_identity_review'&&p.digest_format==='ai1.r002.json-hmac.v1'
 &&typeof p.member_digest==='string'&&DIGEST.test(p.member_digest)
 &&typeof p.session_binding==='string'&&SESSION.test(p.session_binding)
 &&typeof p.digest_kid==='string'&&KID.test(p.digest_kid)&&positive(p.digest_epoch)
 &&positive(p.auth_version)&&Number.isSafeInteger(p.checked_at)
 &&(p.checked_at as number)<=now&&now-(p.checked_at as number)<=5
 &&positive(p.expires_at)&&(p.expires_at as number)>now&&p.session_state==='active'
 &&p.verified_live===false&&p.billing_authorized===false;
}
function identical(a:PrivateIdentity,b:PrivateIdentity){
 return equal(a.member_digest,b.member_digest)&&equal(a.session_binding,b.session_binding)
 &&equal(a.digest_kid,b.digest_kid)&&a.digest_epoch===b.digest_epoch
 &&a.auth_version===b.auth_version&&a.expires_at===b.expires_at
 &&a.brand_id===b.brand_id&&a.app_id===b.app_id&&a.environment===b.environment;
}
function product(x:unknown):x is CandidateSku{
 const p=data(x,skuKeys);
 return !!p&&typeof p.product_key==='string'&&ID.test(p.product_key)
 &&!FORBIDDEN.test(p.product_key)&&typeof p.sku_ios==='string'&&ID.test(p.sku_ios)
 &&!FORBIDDEN.test(p.sku_ios)&&typeof p.sku_android==='string'&&ID.test(p.sku_android)
 &&!FORBIDDEN.test(p.sku_android)&&p.sku_ios!==p.sku_android
 &&(p.kind==='NON_CONSUMABLE'?p.period===null:
 p.kind==='AUTO_RENEWABLE_SUBSCRIPTION'&&(p.period==='MONTH'||p.period==='YEAR'));
}
const response=(s:Scope,key:string,state:R003BillingResult['status'],reason:string,
 platform:R003BillingResult['platform']=null,
 candidate:R003BillingResult['candidate_state']='none',reads:0|3=0):R003BillingResult=>
 Object.freeze({contract:AI2_R003_CONTRACT,status:state,reason,app_id:s.app_id,
 product_key:key,platform,candidate_state:candidate,auth_reread_count:reads,
 official_store_verified:false,official_revenuecat_verified:false,
 approved_identity_mapping:false,cross_store_transaction_transfer:false,
 can_start_purchase:false,can_restore:false,can_grant:false,can_remove_ads:false,
 can_ack_webhook:false,can_publish:false,live:false});
export function createOfflineR003BillingStoreReview(deps:Readonly<{
 enabled?:boolean;scope:Scope;identity:R003IdentityAuthorityPort;
 products:readonly CandidateSku[];
 /** Untrusted local probe; must never carry a receipt/secret or be used for grant. */
 readUnverifiedStoreProbe:()=>Promise<unknown>;
 nowSeconds:()=>number;
}>){
 const s=deps?.scope;
 if(!s||s.brand_id!=='starry'||!ID.test(s.app_id)||FORBIDDEN.test(s.app_id)
 ||(s.environment!=='development'&&s.environment!=='staging')
 ||deps.identity?.contract!==AI1_R003_CONTRACT
 ||typeof deps.identity.reviewFresh!=='function'
 ||typeof deps.identity.readServerReview!=='function'
 ||typeof deps.readUnverifiedStoreProbe!=='function'||typeof deps.nowSeconds!=='function'
 ||!Array.isArray(deps.products)||deps.products.length>80||!deps.products.every(product))
 throw Error('AI2_R003_INVALID_CONTRACT');
 const products=new Map<string,CandidateSku>();const skus=new Set<string>();
 for(const p of deps.products){
  if(products.has(p.product_key)||skus.has(p.sku_ios)||skus.has(p.sku_android))
   throw Error('AI2_R003_DUPLICATE_SKU');
  products.set(p.product_key,Object.freeze({...p}));
  skus.add(p.sku_ios);skus.add(p.sku_android);
 }
 const scope=Object.freeze({...s});
 const seen=new Map<string,{version:number;fingerprint:string}>(); // volatile TEST ONLY, not anti-PITR
 async function readIdentity(request:unknown,intent:unknown,previous?:unknown){
  const now=deps.nowSeconds();if(!positive(now))return null;
  const v=await deps.identity.reviewFresh(request,intent,now,previous);
  const pub=data(v,PUBLIC) as PublicIdentity|null;
  if(!pub||pub.contract!==AI1_R003_CONTRACT||pub.status!=='review_only'
   ||pub.verified_live!==false||pub.may_open_store!==false||pub.may_purchase!==false
   ||pub.may_restore!==false||pub.may_grant!==false||pub.may_charge!==false
   ||pub.may_ack_webhook!==false)return null;
  const p=deps.identity.readServerReview(v,intent,now);
  if(!proofMatches(p,scope,now))return null;
  return {view:v,proof:p};
 }
 return Object.freeze({contract:AI2_R003_CONTRACT,
  async inspect(request:unknown,intent:unknown,productKey:unknown,
   platform:unknown):Promise<R003BillingResult>{
   const key=typeof productKey==='string'?productKey:'invalid';
   if(deps.enabled!==true||!products.has(key)||
    (platform!=='ios'&&platform!=='android'))
    return response(scope,key,'blocked','DISABLED_OR_UNLISTED');
   const item=products.get(key)!;
   const sku=platform==='ios'?item.sku_ios:item.sku_android;
   try{
    const a=await readIdentity(request,intent);
    if(!a)return response(scope,key,'blocked','SIGNED_AUTH_AUTHORITY_REQUIRED');
    const b=await readIdentity(request,intent,a.view);
    if(!b||!identical(a.proof,b.proof))
     return response(scope,key,'blocked','IDENTITY_CHANGED_BEFORE_STORE');
    const raw=await deps.readUnverifiedStoreProbe();
    const c=await readIdentity(request,intent,b.view);
    if(!c||!identical(b.proof,c.proof))
     return response(scope,key,'blocked','IDENTITY_CHANGED_AFTER_STORE');
    const e=data(raw,STORE);
    if(!e||e.source!=='revenuecat_unverified_fixture'||e.brand_id!=='starry'
     ||e.app_id!==scope.app_id||e.environment!==scope.environment
     ||e.product_key!==key||e.platform!==platform||e.store_sku!==sku
     ||typeof e.member_digest!=='string'||!equal(e.member_digest,c.proof.member_digest)
     ||!positive(e.source_version)||!['active','expired','refunded','revoked','grace','hold'].includes(e.status as string)
     ||(item.kind==='NON_CONSUMABLE'?e.expires_at_sec!==null:
       !positive(e.expires_at_sec)))
      return response(scope,key,'blocked','FOREIGN_OR_UNVERIFIED_STORE_PROBE');
    const prevKey=[scope.brand_id,scope.app_id,scope.environment,
     c.proof.member_digest,c.proof.digest_kid,c.proof.digest_epoch,platform,key].join('|');
    const fingerprint=[e.status,e.expires_at_sec,e.store_sku].join('|');
    const previous=seen.get(prevKey);
    if(previous&&((e.source_version as number)<previous.version||
     ((e.source_version as number)===previous.version&&fingerprint!==previous.fingerprint)))
     return response(scope,key,'blocked','ROLLBACK_OR_CONFLICTING_EVENT');
    seen.set(prevKey,{version:e.source_version as number,fingerprint});
    const now=deps.nowSeconds();
    if(!positive(now))return response(scope,key,'blocked','CLOCK_UNAVAILABLE');
    const candidate=e.status==='refunded'||e.status==='revoked'?'revoked':
     item.kind==='AUTO_RENEWABLE_SUBSCRIPTION'&&
      ((e.expires_at_sec as number)<=now||e.status!=='active')?'expired':
     e.status==='active'?'unverified_active':'expired';
    return response(scope,key,'review_only','STORE_AND_REVENUECAT_NOT_VERIFIED',
     platform,candidate,3);
   }catch{return response(scope,key,'blocked','AUTH_OR_STORE_PROBE_UNAVAILABLE');}
  }
 });
}
