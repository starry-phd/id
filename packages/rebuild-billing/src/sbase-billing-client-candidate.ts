/** AI-2 SBASE-20261028: non-live, replaceable BillingClient contract (v0 candidate).
 * DEV-B owns server-verified purchases. NEVER infer store authority from phone,
 * cached entitlements, RevenueCat client callbacks, receipts or mock SQLite.
 * No real SDK imports, payments, network, identity writes or D1 migrations.
 */
export const SBASE_BILLING_CONTRACT='starry.billing-client.v0-candidate' as const;
export const SBASE_BILLING_LIVE=false as const;
export const SBASE_STORE_PAYMENTS_ENABLED=false as const;
export const SBASE_BATTERY_PURCHASABLE=false as const;
export type BillingIntent='lifetime_unlock'|'subscription_monthly'|
 'subscription_yearly'|'remove_ads';
export type BillingPlatform='ios'|'android';
export type BillingState='unavailable'|'unverified'|'refund_review_only'|
 'revoked'|'expired'|'blocked';
export type CandidateProduct=Readonly<{productKey:string;app_id:string;
 store_app_ref:string;store_sku_ref:string;platform:BillingPlatform;
 intent:BillingIntent;official_product_approved:false}>;
export type EntitlementView=Readonly<{
 contract:typeof SBASE_BILLING_CONTRACT;brand_id:'starry';app_id:string;
 state:BillingState;reason:string;source:'none'|'local_unapproved_only';
 official_store_verified:false;identity_mapping_approved:false;
 purchased:false;subscription_active:false;lifetime_unlocked:false;
 ads_suppressed:false;can_restore:false;may_grant:false;may_regrant:false;
 may_ack_queue:false;may_publish:false;may_purchase:false;live:false;
}>;
export type BillingAction=Readonly<{
 ok:false;reason:'NOT_APPROVED'|'PRODUCT_NOT_REGISTERED'|
 'BATTERY_PERMANENTLY_FREE'|'INVALID_IDENTITY';live:false;
}>;
export interface BillingClient{
 readonly contract:typeof SBASE_BILLING_CONTRACT;
 purchase(productKey:string):Promise<BillingAction>;
 getOfferings():Promise<Readonly<{status:'candidate_only';products:readonly CandidateProduct[];sellable:false}>>;
 getEntitlements(productKey:string):Promise<EntitlementView>;
 restorePurchases():Promise<BillingAction>;
 identifyUser(candidateIdentity:unknown):Promise<BillingAction>;
 logout():Promise<BillingAction>;
 observeEntitlementChanges(listener:(view:EntitlementView)=>void):()=>void;
}
type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging';
 app_id:string;platform:BillingPlatform;store_app_ref:string}>;
type ReadPort=Readonly<{
 /** Test-only local Billing candidate. NOT official Store/RevenueCat authority. */
 readCandidate:(productKey:string)=>Promise<unknown>;
 /** Hypothetical independent version floor, also NOT an external durable witness. */
 readFloor:(productKey:string)=>Promise<unknown>;
 lawfulProcessingAndRetention:()=>Promise<boolean>;
}>;
type Snapshot=Readonly<{brand_id:'starry';environment:string;app_id:string;
 platform:BillingPlatform;store_app_ref:string;store_sku_ref:string;
 productKey:string;member_digest:string;transaction_ref:string;
 event_ref:string;source_version:number;state:'active'|'refunded'|
 'revoked'|'expired'|'grace'|'hold';store_signature_verified:false;
 identity_mapping_approved:false}>;
type Floor=Readonly<{brand_id:'starry';environment:string;app_id:string;
 productKey:string;transaction_ref:string;member_digest:string;
 source_version:number;external_witness_verified:false}>;
const KEY=/^[A-Za-z0-9][A-Za-z0-9._-]{1,95}$/;
const OPAQUE=/^r_[a-f0-9]{64}$/;
const DIGEST=/^m_[a-f0-9]{64}$/;
const forbidden=(v:string)=>/battery|電池|sticker|貼紙|top.?up/i.test(v);
const F=['brand_id','environment','app_id','platform','store_app_ref',
 'store_sku_ref','productKey','member_digest','transaction_ref',
 'event_ref','source_version','state','store_signature_verified',
 'identity_mapping_approved'] as const;
const FLOOR=['brand_id','environment','app_id','productKey',
 'transaction_ref','member_digest','source_version',
 'external_witness_verified'] as const;
const PRODUCT=['productKey','app_id','store_app_ref','store_sku_ref','platform',
 'intent','official_product_approved'] as const;
function exact(x:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const d=Object.getOwnPropertyDescriptors(x);
  if(Reflect.ownKeys(x).length!==fields.length)return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of fields){
   if(!Object.hasOwn(d,k)||!d[k].enumerable||!('value' in d[k]))return null;
   out[k]=d[k].value;
  }return out;
 }catch{return null;}
}
const INT=(x:unknown):x is number=>typeof x==='number'&&
 Number.isSafeInteger(x)&&x>0;
const INTENTS=['lifetime_unlock','subscription_monthly',
 'subscription_yearly','remove_ads'] as const;
const STATES=['active','refunded','revoked','expired','grace','hold'] as const;
function deny(scope:Scope,state:BillingState,reason:string,
 source:'none'|'local_unapproved_only'='none'):EntitlementView{
 return Object.freeze({contract:SBASE_BILLING_CONTRACT,brand_id:'starry',
 app_id:scope.app_id,state,reason,source,official_store_verified:false,
 identity_mapping_approved:false,purchased:false,subscription_active:false,
 lifetime_unlocked:false,ads_suppressed:false,can_restore:false,
 may_grant:false,may_regrant:false,may_ack_queue:false,may_publish:false,
 may_purchase:false,live:false});
}
function validProduct(raw:unknown,scope:Scope):raw is CandidateProduct{
 const x=exact(raw,PRODUCT);
 return !!x&&typeof x.productKey==='string'&&KEY.test(x.productKey)
  &&!forbidden(x.productKey)&&x.app_id===scope.app_id
  &&x.store_app_ref===scope.store_app_ref
  &&typeof x.store_sku_ref==='string'&&OPAQUE.test(x.store_sku_ref)
  &&x.platform===scope.platform&&
  INTENTS.includes(x.intent as BillingIntent)
  &&x.official_product_approved===false;
}
function localEvidence(raw:unknown,product:CandidateProduct,scope:Scope){
 const x=exact(raw,F);
 if(!x||x.brand_id!=='starry'||x.environment!==scope.environment
  ||x.app_id!==scope.app_id||x.platform!==scope.platform
  ||x.store_app_ref!==scope.store_app_ref
  ||x.store_sku_ref!==product.store_sku_ref
  ||x.productKey!==product.productKey
  ||typeof x.member_digest!=='string'||!DIGEST.test(x.member_digest)
  ||typeof x.transaction_ref!=='string'||!OPAQUE.test(x.transaction_ref)
  ||typeof x.event_ref!=='string'||!OPAQUE.test(x.event_ref)
  ||!INT(x.source_version)||!STATES.includes(x.state as Snapshot['state'])
  ||x.store_signature_verified!==false||x.identity_mapping_approved!==false)
  return null;
 return x as unknown as Snapshot;
}
function localFloor(raw:unknown,x:Snapshot,scope:Scope){
 const f=exact(raw,FLOOR);
 return !!f&&f.brand_id==='starry'&&f.environment===scope.environment
  &&f.app_id===scope.app_id&&f.productKey===x.productKey
  &&f.transaction_ref===x.transaction_ref
  &&f.member_digest===x.member_digest
  &&f.source_version===x.source_version
  &&f.external_witness_verified===false;
}
export function createSbaseOfflineBillingClient(deps:Readonly<{
 scope:Scope;products:readonly CandidateProduct[];ports:ReadPort;
 enabled?:boolean;
}>):BillingClient{
 const s=exact(deps?.scope,['brand_id','environment','app_id','platform',
  'store_app_ref']);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(String(s.environment))
  ||!['ios','android'].includes(String(s.platform))
  ||typeof s.app_id!=='string'||!KEY.test(s.app_id)
  ||typeof s.store_app_ref!=='string'||!OPAQUE.test(s.store_app_ref))
  throw Error('SBASE_BILLING_SCOPE_REJECTED');
 const scope=Object.freeze({...s}) as Scope;
 if(!Array.isArray(deps.products)
  ||deps.products.some(x=>!validProduct(x,scope))
  ||new Set(deps.products.map(x=>x.productKey)).size!==deps.products.length
  ||new Set(deps.products.map(x=>x.store_sku_ref)).size!==deps.products.length
  ||!deps.ports||typeof deps.ports.readCandidate!=='function'
  ||typeof deps.ports.readFloor!=='function'
  ||typeof deps.ports.lawfulProcessingAndRetention!=='function')
  throw Error('SBASE_BILLING_PRODUCT_OR_PORT_REJECTED');
 const products=Object.freeze(deps.products.map(x=>Object.freeze({...x})));
 const productFor=(key:string)=>products.find(x=>x.productKey===key);
 const action=(reason:BillingAction['reason']):BillingAction=>
  Object.freeze({ok:false,reason,live:false});
 const inspect=async(productKey:string):Promise<EntitlementView>=>{
  if(!deps.enabled)return deny(scope,'unavailable','CANDIDATE_PROVIDER_DISABLED');
  if(typeof productKey!=='string'||forbidden(productKey))
   return deny(scope,'blocked','FREE_BATTERY_NEVER_PURCHASED');
  const product=productFor(productKey);
  if(!product)return deny(scope,'blocked','APP_PRODUCT_SCOPE_MISMATCH');
  try{
   if(await deps.ports.lawfulProcessingAndRetention()!==true)
    return deny(scope,'blocked','LAWFUL_PURPOSE_UNAPPROVED');
   const a=localEvidence(await deps.ports.readCandidate(productKey),product,scope);
   if(!a)return deny(scope,'unverified','NO_OFFICIAL_STORE_SOURCE');
   if(!localFloor(await deps.ports.readFloor(productKey),a,scope))
    return deny(scope,'unverified','SOURCE_VERSION_OR_PITR_DRIFT');
   if(await deps.ports.lawfulProcessingAndRetention()!==true)
    return deny(scope,'blocked','LAW_CHANGED_AFTER_READ');
   const b=localEvidence(await deps.ports.readCandidate(productKey),product,scope);
   if(!b||JSON.stringify(b)!==JSON.stringify(a)
    ||!localFloor(await deps.ports.readFloor(productKey),b,scope))
    return deny(scope,'unverified','SOURCE_CHANGED_AFTER_READ');
   if(b.state==='refunded'||b.state==='revoked')
    return deny(scope,b.state==='refunded'?'refund_review_only':'revoked',
     'LOCAL_REFUND_OR_REVOCATION_NOT_OFFICIAL','local_unapproved_only');
   if(b.state==='expired')
    return deny(scope,'expired','LOCAL_EXPIRED_NOT_OFFICIAL','local_unapproved_only');
   // Even local "active", "grace" or "hold" is NEVER a verified Store grant.
   return deny(scope,'unverified','OFFICIAL_SIGNED_STORE_AUTHORITY_MISSING',
    'local_unapproved_only');
  }catch{return deny(scope,'blocked','PRIVATE_EVIDENCE_READ_FAILED');}
 };
 return Object.freeze({
  contract:SBASE_BILLING_CONTRACT,
  async purchase(key:string){
   if(typeof key==='string'&&forbidden(key))
    return action('BATTERY_PERMANENTLY_FREE');
   return action(productFor(key)?'NOT_APPROVED':'PRODUCT_NOT_REGISTERED');
  },
  async getOfferings(){
   return Object.freeze({status:'candidate_only' as const,
    products:Object.freeze(products.map(x=>Object.freeze({...x}))),sellable:false as const});
  },
  getEntitlements:inspect,
  async restorePurchases(){return action('NOT_APPROVED');},
  async identifyUser(_claim:unknown){return action('INVALID_IDENTITY');},
  async logout(){return action('NOT_APPROVED');},
  observeEntitlementChanges(_listener:(view:EntitlementView)=>void){return ()=>{};}
 });
}
