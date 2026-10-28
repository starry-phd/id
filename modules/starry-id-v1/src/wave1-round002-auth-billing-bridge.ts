/**
 * AI-1 Round-002: real signed Session -> current Auth D1 -> server-only
 * App-scoped Billing identity digest. OFFLINE REVIEW ONLY, never Store authority.
 * AI-2 fixture-only identity remains distinct and MUST NOT be impersonated.
 */
import {createOfflineStarryPurchaseEntryGate} from './wave1-purchase-entry-auth-gate.ts';
import type {PurchaseFlowIntent,PurchaseServerIdentity} from './wave1-purchase-entry-auth-gate.ts';
import type {TrustedScope} from './index.ts';
import type {D1Database} from './d1-ports.ts';

export const R002_BILLING_IDENTITY_CONTRACT='starry.auth.billing-identity.r002.v1-offline' as const;
export const R002_BILLING_IDENTITY_LIVE=false as const;
type Status='blocked'|'login_required'|'identity_review_only'|'member_changed';
type Reason='INVALID_OR_DISABLED'|'SIGNED_SESSION_REQUIRED'|'DIGEST_KEY_UNAVAILABLE'|
 'AUTH_IDENTITY_REVIEW_ONLY'|'ACCOUNT_SWITCH_DENIED';
export type BillingIdentityReviewView=Readonly<{
 contract:typeof R002_BILLING_IDENTITY_CONTRACT;status:Status;reason:Reason;
 flow_ref:string|null;
 verified_live:false;may_purchase:false;may_grant:false;may_restore:false;
 may_charge:false;may_open_store:false;may_ack_webhook:false;
}>;
/** PRIVATE SERVER port only. Not AI-2 fixture kind and not UI JSON. */
export type BillingServerIdentityReview=Readonly<{
 kind:'signed_auth_d1_review_only';brand_id:'starry';app_id:string;
 environment:'development'|'staging';member_digest:string;
 auth_version:number;session_state:'active';checked_at:number;expires_at:number;
 verified_live:false;billing_authorized:false;
}>;
type Bound=Readonly<{
 intent:PurchaseFlowIntent;identity:PurchaseServerIdentity;
 server:BillingServerIdentityReview;
}>;
const provenance=new WeakMap<object,Bound>();
const validTime=(v:unknown):v is number=>typeof v==='number'&&
 Number.isSafeInteger(v)&&v>=0;
function result(status:Status,reason:Reason,ref:string|null):BillingIdentityReviewView{
 return Object.freeze({contract:R002_BILLING_IDENTITY_CONTRACT,status,reason,
  flow_ref:ref,verified_live:false,may_purchase:false,may_grant:false,
  may_restore:false,may_charge:false,may_open_store:false,may_ack_webhook:false});
}
function parse(raw:unknown,scope:Readonly<{app_id:string;environment:string}>):PurchaseFlowIntent|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  const keys=['brand_id','app_id','environment','flow_ref'];
  const actual=Reflect.ownKeys(raw);
  if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const d=Object.getOwnPropertyDescriptors(raw);
  if(keys.some(k=>!d[k]?.enumerable||!('value' in d[k])))return null;
  const x=Object.fromEntries(keys.map(k=>[k,d[k].value]));
  if(x.brand_id!=='starry'||x.app_id!==scope.app_id||
   x.environment!==scope.environment||typeof x.flow_ref!=='string'||
   !/^[A-Za-z0-9_-]{32,96}$/.test(x.flow_ref))return null;
  return Object.freeze({brand_id:'starry',app_id:x.app_id,
   environment:x.environment as 'development'|'staging',flow_ref:x.flow_ref});
 }catch{return null;}
}
function keySuitable(k:CryptoKey|null):k is CryptoKey{
 return !!k&&k.type==='secret'&&!k.extractable&&k.algorithm.name==='HMAC'&&
  k.usages.includes('sign')&&(k.algorithm as HmacKeyAlgorithm).hash.name==='SHA-256';
}
function equalString(a:string,b:string):boolean{
 if(a.length!==b.length)return false;
 let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);
 return x===0;
}
export function createOfflineWave1BillingIdentityBridge(deps:Readonly<{
 enabled?:boolean;serverScope:TrustedScope;expectedOrigin:string;
 authDb:D1Database;getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
 getMemberDigestKey:()=>Promise<CryptoKey|null>;
}>) {
 const s=deps.serverScope;
 if(!s||s.brand_id!=='starry'||typeof s.app_id!=='string'||
  !/^[A-Za-z0-9._:-]{1,180}$/.test(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  typeof deps.getMemberDigestKey!=='function')
  throw Error('R002_SCOPE_OR_PORT_DENIED');
 const scope=Object.freeze({...s});
 const gate=createOfflineStarryPurchaseEntryGate(deps);
 const enabled=deps.enabled===true;
 const original=(view:unknown,intent:PurchaseFlowIntent,now:unknown):Bound|null=>{
  if(!validTime(now)||!view||typeof view!=='object')return null;
  const p=provenance.get(view);
  if(!p||p.intent.flow_ref!==intent.flow_ref||
   p.intent.app_id!==intent.app_id||p.intent.environment!==intent.environment||
   p.identity.checked_at>now||now-p.identity.checked_at>5||
   p.identity.expires_at<=now)return null;
  return p;
 };
 return Object.freeze({
  contract:R002_BILLING_IDENTITY_CONTRACT,
  /** Fresh request, fresh crypto verification, fresh D1 Member+Session+provider reads. */
  async reviewFresh(request:unknown,rawIntent:unknown,now:unknown,
   previous?:unknown):Promise<BillingIdentityReviewView>{
   const intent=parse(rawIntent,scope);
   if(!enabled||!intent||!validTime(now))
    return result('blocked','INVALID_OR_DISABLED',null);
   const prior=previous===undefined?null:original(previous,intent,now);
   if(previous!==undefined&&!prior)return result('blocked','INVALID_OR_DISABLED',null);
   try{
    const v=await gate.beforeStore(request,intent,now);
    const identity=gate.readServerIdentity(v,intent,now);
    if(v.status!=='identity_verified_only'||!identity)
     return result('login_required','SIGNED_SESSION_REQUIRED',intent.flow_ref);
    const key=await deps.getMemberDigestKey();
    if(!keySuitable(key))return result('blocked','DIGEST_KEY_UNAVAILABLE',null);
    const payload=new TextEncoder().encode(JSON.stringify([
     R002_BILLING_IDENTITY_CONTRACT,'member:v1',
     identity.brand_id,identity.app_id,identity.environment,identity.starryUserId
    ]));
    const signature=await crypto.subtle.sign('HMAC',key,payload);
    const digest='m_'+Array.from(new Uint8Array(signature))
     .map(b=>b.toString(16).padStart(2,'0')).join('');
    if(!/^m_[a-f0-9]{64}$/.test(digest))
     return result('blocked','DIGEST_KEY_UNAVAILABLE',null);
    if(prior&&(!equalString(prior.server.member_digest,digest)||
      prior.identity.auth_version!==identity.auth_version))
     return result('member_changed','ACCOUNT_SWITCH_DENIED',intent.flow_ref);
    const server:BillingServerIdentityReview=Object.freeze({
     kind:'signed_auth_d1_review_only',brand_id:'starry',
     app_id:identity.app_id,environment:identity.environment,
     member_digest:digest,auth_version:identity.auth_version,
     session_state:'active',checked_at:now,expires_at:identity.expires_at,
     verified_live:false,billing_authorized:false
    });
    const response=result('identity_review_only','AUTH_IDENTITY_REVIEW_ONLY',
     intent.flow_ref);
    provenance.set(response,Object.freeze({intent,identity,server}));
    return response;
   }catch{return result('blocked','DIGEST_KEY_UNAVAILABLE',null);}
  },
  /** No additional D1 read here: caller MUST use reviewFresh for every use. */
  readServerReview(view:unknown,rawIntent:unknown,now:unknown):
   BillingServerIdentityReview|null{
   const intent=parse(rawIntent,scope);
   return enabled&&intent?original(view,intent,now)?.server??null:null;
  }
 });
}
