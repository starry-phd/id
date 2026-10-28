/**
 * AI-1 Wave1 Round-003: candidate ONE server-side Auth -> Billing identity
 * authority. All observations are OFFLINE REVIEW ONLY.
 * No Store, token issuance, remote D1, rights writer or public HTTP route.
 */
import {createOfflineStarryPurchaseEntryGate} from './wave1-purchase-entry-auth-gate.ts';
import type {PurchaseServerIdentity, PurchaseFlowIntent} from './wave1-purchase-entry-auth-gate.ts';
import {R002_BILLING_IDENTITY_CONTRACT} from './wave1-round002-auth-billing-bridge.ts';
import type {TrustedScope} from './index.ts';
import type {D1Database} from './d1-ports.ts';

export const R003_AUTHORITY_VERSION='starry.auth.identity-authority.r003.v1-candidate' as const;
export const R003_AUTHORITY_LIVE=false as const;
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
type KeyLease=Readonly<{kid:string;epoch:number;key:CryptoKey}>;
export type R003ServerIdentity=Readonly<{
 kind:'signed_auth_d1_review_only';
 contract:typeof R003_AUTHORITY_VERSION;
 brand_id:'starry';app_id:string;environment:'development'|'staging';
 purpose:'billing_identity_review';digest_format:'ai1.r002.json-hmac.v1';
 member_digest:string;session_binding:string;
 digest_kid:string;digest_epoch:number;
 auth_version:number;checked_at:number;expires_at:number;session_state:'active';
 verified_live:false;billing_authorized:false;
}>;
export type R003PublicReview=Readonly<{
 contract:typeof R003_AUTHORITY_VERSION;
 status:'blocked'|'review_only';reason:
  'DISABLED_OR_INVALID'|'SIGNED_AUTH_REQUIRED'|'KEY_UNAVAILABLE'|
  'KEY_ROTATED'|'AUTH_CHANGED'|'PREVIOUS_PROOF_INVALID'|
  'MEMBER_OR_SESSION_SWITCH'|'AUTH_REVIEW_NOT_STORE_PERMISSION';
 flow_ref:string|null;verified_live:false;may_open_store:false;may_purchase:false;
 may_restore:false;may_grant:false;may_charge:false;may_ack_webhook:false;
}>;
type PrivateReview=Readonly<{intent:PurchaseFlowIntent;identity:PurchaseServerIdentity;
 proof:R003ServerIdentity}>;
const proofs=new WeakMap<object,PrivateReview>();
const consumed=new WeakSet<object>();
const validTime=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(x);
const validKid=(x:unknown):x is string=>typeof x==='string'&&/^[a-z0-9][a-z0-9._-]{2,63}$/.test(x);
function intentOf(x:unknown,s:Scope):PurchaseFlowIntent|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return null;
  const keys=['brand_id','app_id','environment','flow_ref'];
  const actual=Reflect.ownKeys(x);
  if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const d=Object.getOwnPropertyDescriptors(x);
  if(keys.some(k=>!d[k]?.enumerable||!('value' in d[k])))return null;
  if(d.brand_id.value!=='starry'||d.app_id.value!==s.app_id||
   d.environment.value!==s.environment||
   typeof d.flow_ref.value!=='string'||!/^[A-Za-z0-9_-]{32,96}$/.test(d.flow_ref.value))
   return null;
  return Object.freeze({brand_id:'starry',app_id:s.app_id,
   environment:s.environment,flow_ref:d.flow_ref.value});
 }catch{return null;}
}
function activeKey(k:KeyLease|null):k is KeyLease{
 if(!k||!validKid(k.kid)||!validTime(k.epoch)||k.epoch===0)return false;
 const key=k.key;
 return !!key&&key.type==='secret'&&!key.extractable&&key.algorithm.name==='HMAC'&&
  (key.algorithm as HmacKeyAlgorithm).hash.name==='SHA-256'&&key.usages.includes('sign');
}
function equal(a:string,b:string):boolean{
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
function sameIdentity(a:PurchaseServerIdentity,b:PurchaseServerIdentity):boolean{
 return a.brand_id===b.brand_id&&a.app_id===b.app_id&&
 a.environment===b.environment&&equal(a.starryUserId,b.starryUserId)&&
 equal(a.session_id,b.session_id)&&a.auth_version===b.auth_version&&
 a.expires_at===b.expires_at&&a.scope==='purchase_identity_only'&&
 b.scope==='purchase_identity_only';
}
function publicView(status:R003PublicReview['status'],reason:R003PublicReview['reason'],
 flow_ref:string|null):R003PublicReview{
 return Object.freeze({contract:R003_AUTHORITY_VERSION,status,reason,flow_ref,
  verified_live:false,may_open_store:false,may_purchase:false,may_restore:false,
  may_grant:false,may_charge:false,may_ack_webhook:false});
}
async function mac(key:CryptoKey,fields:readonly (string|number)[]):Promise<string>{
 const bytes=await crypto.subtle.sign('HMAC',key,
  new TextEncoder().encode(JSON.stringify(fields)));
 return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
/** Candidate only: AI-0/4 MUST verify the signed P05 source before invoking it.
 * Physical actor_ref -> session lookup/version/retention has NOT been approved.
 */
export type R003EventAuthFenceProposal=Readonly<{
 brand_id:'starry';app_id:string;environment:'development'|'staging';
 event_id:string;actor_ref:string;auth_version:number;session_version:number;
 state:'active'|'revoked'|'deleted'|'unknown';
}>;
export function createOfflineR003IdentityAuthorityPort(deps:Readonly<{
 enabled?:boolean;serverScope:TrustedScope;expectedOrigin:string;
 authDb:D1Database;getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
 /** Must be server injected; future managed KID/rotation and lawful purpose need Gate1. */
 readActiveDigestKey:()=>Promise<KeyLease|null>;
}>){
 const s=deps?.serverScope;
 if(!s||s.brand_id!=='starry'||!validId(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  typeof deps.readActiveDigestKey!=='function')
  throw Error('R003_SCOPE_OR_KEYRING_DENIED');
 const scope:Scope=Object.freeze({brand_id:'starry',app_id:s.app_id,
  environment:s.environment});
 const gate=createOfflineStarryPurchaseEntryGate(deps);
 const enabled=deps.enabled===true;
 function priorOf(v:unknown,intent:PurchaseFlowIntent,now:number):PrivateReview|null{
  if(!v||typeof v!=='object')return null;
  const p=proofs.get(v);
  return p&&p.intent.flow_ref===intent.flow_ref&&
   p.intent.app_id===intent.app_id&&p.intent.environment===intent.environment&&
   p.proof.checked_at<=now&&now-p.proof.checked_at<=5&&
   p.proof.expires_at>now?p:null;
 }
 return Object.freeze({
  contract:R003_AUTHORITY_VERSION,
  async reviewFresh(request:unknown,rawIntent:unknown,now:unknown,
   previous?:unknown):Promise<R003PublicReview>{
   const intent=intentOf(rawIntent,scope);
   if(!enabled||!intent||!validTime(now))
    return publicView('blocked','DISABLED_OR_INVALID',null);
   const prior=previous===undefined?null:priorOf(previous,intent,now);
   if(previous!==undefined&&!prior)
    return publicView('blocked','PREVIOUS_PROOF_INVALID',null);
   try{
    // Reuse existing R23 signed bearer + CURRENT Member/Session/provider D1 reads.
    const firstView=await gate.beforeStore(request,intent,now);
    const first=gate.readServerIdentity(firstView,intent,now);
    if(!first)return publicView('blocked','SIGNED_AUTH_REQUIRED',intent.flow_ref);
    const k1=await deps.readActiveDigestKey();
    if(!activeKey(k1))return publicView('blocked','KEY_UNAVAILABLE',null);
    // Reuse AI-1 R002's exact JSON HMAC domain; never silently accept AI-2's
    // NUL fixture digest namespace as the same issuer.
    const digest='m_'+await mac(k1.key,[R002_BILLING_IDENTITY_CONTRACT,
      'member:v1',first.brand_id,first.app_id,first.environment,first.starryUserId]);
    const session='s_'+await mac(k1.key,[R003_AUTHORITY_VERSION,
      'session:v1',first.brand_id,first.app_id,first.environment,
      first.session_id,first.auth_version]);
    // Second signature + CURRENT SQL recheck closes common mid-read revoke/switch.
    // Still NOT a physical D1+Billing atomic transaction.
    const secondView=await gate.beforeStore(request,intent,now);
    const second=gate.readServerIdentity(secondView,intent,now);
    if(!second||!sameIdentity(first,second))
     return publicView('blocked','AUTH_CHANGED',intent.flow_ref);
    const k2=await deps.readActiveDigestKey();
    if(!activeKey(k2)||k1.kid!==k2.kid||k1.epoch!==k2.epoch||
     k1.key!==k2.key)
     return publicView('blocked','KEY_ROTATED',null);
    if(prior&&(!equal(prior.proof.member_digest,digest)||
     !equal(prior.proof.session_binding,session)||
     prior.proof.digest_kid!==k1.kid||prior.proof.digest_epoch!==k1.epoch||
     prior.identity.auth_version!==second.auth_version))
     return publicView('blocked','MEMBER_OR_SESSION_SWITCH',intent.flow_ref);
    const proof:R003ServerIdentity=Object.freeze({
     kind:'signed_auth_d1_review_only',contract:R003_AUTHORITY_VERSION,
     brand_id:'starry',app_id:scope.app_id,environment:scope.environment,
     purpose:'billing_identity_review',digest_format:'ai1.r002.json-hmac.v1',
     member_digest:digest,session_binding:session,digest_kid:k1.kid,
     digest_epoch:k1.epoch,auth_version:first.auth_version,
     checked_at:now,expires_at:first.expires_at,session_state:'active',
     verified_live:false,billing_authorized:false
    });
    const v=publicView('review_only','AUTH_REVIEW_NOT_STORE_PERMISSION',intent.flow_ref);
    proofs.set(v,Object.freeze({intent,identity:first,proof}));
    return v;
   }catch{return publicView('blocked','SIGNED_AUTH_REQUIRED',intent.flow_ref);}
  },
  /** Single-consumption local reference ONLY. Caller must fresh-read again at
   * transaction time; receipt/Store never authorized by this private evidence.
   */
  readServerReview(view:unknown,rawIntent:unknown,now:unknown):
   R003ServerIdentity|null{
   const intent=intentOf(rawIntent,scope);
   if(!enabled||!intent||!validTime(now)||!view||typeof view!=='object'||
    consumed.has(view))return null;
   const p=priorOf(view,intent,now);
   if(!p)return null;
   consumed.add(view);
   return p.proof;
  }
 });
}
