/**
 * AI-1 R007: review-only contract between canonical R006 P05 and a future
 * physical, monotonic Auth actor/session authority. Issue #2 / AI-0 #1.
 * All injected snapshots are SYNTHETIC: no live issuer, D1 CAS or Queue ACK.
 */
import {R006_AUTH_ADAPTER_VERSION} from './wave1-round006-p05-vnext-auth-adapter.ts';
import type {R006PrivateReview,R006PublicReview} from
 './wave1-round006-p05-vnext-auth-adapter.ts';

export const R007_AUTH_REVIEW_VERSION =
 'starry.auth.p05-current-actor-monotonic.r007.offline-review' as const;
export const R007_AUTH_REVIEW_LIVE = false as const;

type Env = 'development'|'staging';
type Snapshot = Readonly<{
 source:'synthetic_offline_port';brand_id:'starry';app_id:string;
 environment:Env;event_id:string;actor_ref:string;
 member_ref:string;session_ref:string;provider_binding_ref:string;
 auth_version:number;session_version:number;
 member_state:'active'|'suspended'|'deleted';
 session_state:'active'|'revoked'|'expired';
}>;
type Lease = Readonly<{
 source:'synthetic_offline_port';issuer_kid:string;
 issuer_epoch:number;rotation_generation:number;
}>;
type Reason = 'DISABLED'|'MISSING_R006_PROOF'|'INVALID_SCOPE'|'EXPIRED'|
 'ACTOR_CHANGED'|'AUTH_VERSION_CHANGED'|'SESSION_VERSION_CHANGED'|
 'REVOKED_OR_DELETED'|'ISSUER_ROTATED'|'PORT_FAILURE'|
 'SYNTHETIC_ONLY_NOT_PHYSICAL_AUTHORITY';
export type R007AuthReview = Readonly<{
 contract:typeof R007_AUTH_REVIEW_VERSION;
 status:'blocked'|'review_only';reason:Reason;
 authority:'synthetic_offline_only';verified_live:false;
 may_read_live:false;may_write_d1:false;may_send:false;
 may_enqueue:false;may_ack_queue:false;may_grant:false;
 may_charge:false;may_publish:false;
}>;
const deny=(reason:Reason,status:R007AuthReview['status']='blocked'):
 R007AuthReview=>Object.freeze({
 contract:R007_AUTH_REVIEW_VERSION,status,reason,
 authority:'synthetic_offline_only' as const,verified_live:false as const,
 may_read_live:false as const,may_write_d1:false as const,
 may_send:false as const,may_enqueue:false as const,may_ack_queue:false as const,
 may_grant:false as const,may_charge:false as const,may_publish:false as const
});
const number=(n:unknown)=>typeof n==='number'&&
 Number.isSafeInteger(n)&&n>=0;
const nonblank=(v:unknown)=>typeof v==='string'&&
 v.length>0&&v.length<=180;
function plain<T>(v:unknown,keys:readonly string[]):T|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const own=Reflect.ownKeys(v);
  if(own.length!==keys.length||own.some(k=>
    typeof k!=='string'||!keys.includes(k)))return null;
  const output:Record<string,unknown>=Object.create(null);
  for(const key of keys){
   const d=Object.getOwnPropertyDescriptor(v,key);
   if(!d||!d.enumerable||!('value' in d))return null;
   output[key]=d.value;
  }
  return Object.freeze(output) as T;
 }catch{return null;}
}
const snapshotFields=[
 'source','brand_id','app_id','environment','event_id','actor_ref',
 'member_ref','session_ref','provider_binding_ref','auth_version',
 'session_version','member_state','session_state'
] as const;
const leaseFields=[
 'source','issuer_kid','issuer_epoch','rotation_generation'
] as const;
function validSnapshot(raw:unknown,p:R006PrivateReview):Snapshot|null{
 const s=plain<Snapshot>(raw,snapshotFields);
 if(!s||s.source!=='synthetic_offline_port'||s.brand_id!=='starry'||
  s.app_id!==p.scope.app_id||s.environment!==p.scope.environment||
  s.event_id!==p.event_id||s.actor_ref!==p.actor_ref||
  !nonblank(s.member_ref)||!nonblank(s.session_ref)||
  !nonblank(s.provider_binding_ref)||!number(s.auth_version)||
  !number(s.session_version)||
  !['active','suspended','deleted'].includes(s.member_state)||
  !['active','revoked','expired'].includes(s.session_state))return null;
 return s;
}
function validLease(raw:unknown,p:R006PrivateReview):Lease|null{
 const v=plain<Lease>(raw,leaseFields);
 if(!v||v.source!=='synthetic_offline_port'||
  v.issuer_kid!==p.issuer_kid||v.issuer_epoch!==p.issuer_epoch||
  !number(v.rotation_generation))return null;
 return v;
}
function proofValid(p:R006PrivateReview|null,now:number):p is R006PrivateReview{
 return !!p&&p.contract===R006_AUTH_ADAPTER_VERSION&&
  p.evidence==='synthetic_offline_current_auth_only'&&
  p.verified_live===false&&p.may_send===false&&
  p.may_ack_queue===false&&p.may_grant===false&&
  p.scope?.brand_id==='starry'&&
  (p.scope.environment==='development'||p.scope.environment==='staging')&&
  nonblank(p.scope.app_id)&&nonblank(p.event_id)&&
  nonblank(p.actor_ref)&&number(p.auth_version)&&p.auth_version>0&&
  number(p.session_version)&&number(p.issuer_epoch)&&
  nonblank(p.issuer_kid)&&number(p.expires_at)&&p.expires_at>now;
}
export function createOfflineR007AuthAuthorityReview(deps:Readonly<{
 enabled?:boolean;
 r006:Readonly<{
  reviewFresh:(raw:unknown,request:unknown,now:unknown)=>Promise<R006PublicReview>;
  readServerReview:(view:unknown)=>R006PrivateReview|null;
 }>;
 /** Future Auth-owned CAS read; only synthetic offline ports allowed here. */
 readCurrentActorSession:(proof:R006PrivateReview)=>Promise<unknown>;
 /** Future KMS custody/rotation evidence; here it is synthetic only. */
 readCurrentIssuerLease:(proof:R006PrivateReview)=>Promise<unknown>;
}>){
 if(!deps?.r006||typeof deps.r006.reviewFresh!=='function'||
  typeof deps.r006.readServerReview!=='function'||
  typeof deps.readCurrentActorSession!=='function'||
  typeof deps.readCurrentIssuerLease!=='function')
  throw Error('R007_OFFLINE_PORTS_REQUIRED');
 return Object.freeze({
  contract:R007_AUTH_REVIEW_VERSION,
  async review(raw:unknown,request:unknown,now:unknown):
   Promise<R007AuthReview>{
   if(deps.enabled!==true)return deny('DISABLED');
   if(!number(now)||now===0)return deny('EXPIRED');
   try{
    // R006 must validate canonical HMAC and current signed Auth BEFORE these
    // mock-only checks. A caller-supplied "verified" boolean is not proof.
    const v=await deps.r006.reviewFresh(raw,request,now);
    if(v.status!=='review_only'||v.verified_live!==false||
     v.may_send!==false||v.may_ack_queue!==false)
     return deny('MISSING_R006_PROOF');
    const p=deps.r006.readServerReview(v);
    if(!proofValid(p,now))return deny('MISSING_R006_PROOF');
    // Snapshot the two distinct reads to detect revocation, actor/account
    // switch, version regression/advance, session and provider reassociation.
    const k1=validLease(await deps.readCurrentIssuerLease(p),p);
    if(!k1)return deny('ISSUER_ROTATED');
    const a=validSnapshot(await deps.readCurrentActorSession(p),p);
    if(!a)return deny('INVALID_SCOPE');
    const b=validSnapshot(await deps.readCurrentActorSession(p),p);
    if(!b)return deny('INVALID_SCOPE');
    const k2=validLease(await deps.readCurrentIssuerLease(p),p);
    if(!k2||k1.rotation_generation!==k2.rotation_generation)
     return deny('ISSUER_ROTATED');
    if(a.member_state!=='active'||b.member_state!=='active'||
     a.session_state!=='active'||b.session_state!=='active')
     return deny('REVOKED_OR_DELETED');
    if(a.auth_version!==p.auth_version||b.auth_version!==p.auth_version)
     return deny('AUTH_VERSION_CHANGED');
    if(a.session_version!==p.session_version||
     b.session_version!==p.session_version)
     return deny('SESSION_VERSION_CHANGED');
    if(snapshotFields.some(k=>a[k]!==b[k]))
     return deny('ACTOR_CHANGED');
    // Still NO atomic compare-and-swap, durable anti-PITR witness, issuer or
    // transaction covering the read/ack gap. "review_only" never grants.
    return deny('SYNTHETIC_ONLY_NOT_PHYSICAL_AUTHORITY','review_only');
   }catch{return deny('PORT_FAILURE');}
  }
 });
}
