/**
 * AI-1 Wave1 R006: read-only Auth consumer for AI-0's ONE proposed P05 vNext
 * wire contract (Issue #1 #6474929122). Not an event issuer or KMS.
 * Offline synthetic verification cannot authorize delivery, Queue ACK or live.
 */
import {createOfflineR004EventBoundSessionFence,R004_SESSION_FENCE_VERSION} from
 './wave1-round004-event-session-fence.ts';
import type {CandidateVerifiedEvent,CandidateActorBinding,R004PrivateFence} from
 './wave1-round004-event-session-fence.ts';
import type {D1Database} from './d1-ports.ts';
import type {TrustedScope} from './index.ts';

export const R006_AI0_P05_VERSION=
 'starry.p05.canonical.vnext.offline-candidate' as const;
export const R006_AI0_P05_PURPOSE='p05_delivery_review_only' as const;
export const R006_AI0_P05_DOMAIN=
 'starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1' as const;
export const R006_AUTH_ADAPTER_VERSION=
 'starry.auth.p05-vnext-session-fence.r006.offline-adapter' as const;
export const R006_AUTH_ADAPTER_LIVE=false as const;
export const R006_DEPENDENCY_R004=R004_SESSION_FENCE_VERSION;
export const R006_P05_FIELDS=Object.freeze([
 'version','purpose','brand_id','app_id','environment','event_id',
 'event_type','actor_ref','auth_version','session_version','idempotency_key',
 'issuer_kid','issuer_epoch','issued_at','expires_at','nonce','payload_sha256'
] as const);

type Env='development'|'staging';
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:Env}>;
type EventType=CandidateVerifiedEvent['event_type'];
export type R006VNextEnvelope=Readonly<{
 version:typeof R006_AI0_P05_VERSION;purpose:typeof R006_AI0_P05_PURPOSE;
 brand_id:'starry';app_id:string;environment:Env;event_id:string;
 event_type:EventType;actor_ref:string;auth_version:number;session_version:number;
 idempotency_key:string;issuer_kid:string;issuer_epoch:number;
 issued_at:number;expires_at:number;nonce:string;payload_sha256:string;
}>;
type Lease=Readonly<{kid:string;epoch:number;key:CryptoKey}>;
export type R006PrivateReview=Readonly<{
 contract:typeof R006_AUTH_ADAPTER_VERSION;
 wire_version:typeof R006_AI0_P05_VERSION;
 scope:Scope;event_id:string;actor_ref:string;
 idempotency_key:string;nonce:string;payload_sha256:string;
 issuer_kid:string;issuer_epoch:number;auth_version:number;
 session_version:number;expires_at:number;
 session_fence_contract:typeof R004_SESSION_FENCE_VERSION;
 evidence:'synthetic_offline_current_auth_only';
 verified_live:false;may_send:false;may_ack_queue:false;may_grant:false;
}>;
export type R006PublicReview=Readonly<{
 contract:typeof R006_AUTH_ADAPTER_VERSION;
 wire_version:typeof R006_AI0_P05_VERSION;
 status:'blocked'|'review_only';
 reason:'DISABLED'|'INVALID_VNEXT'|'SCOPE_DENIED'|'KEY_UNAVAILABLE'|
  'SIGNATURE_INVALID'|'KEY_ROTATED'|'REPLAY_DENIED'|'CURRENT_AUTH_DENIED'|
  'REVIEW_ONLY_NOT_AUTHORIZED';
 verified_live:false;may_read_live:false;may_write_d1:false;
 may_send:false;may_enqueue:false;may_ack_queue:false;
 may_grant:false;may_purchase:false;may_charge:false;may_publish:false;
}>;
const id=(x:unknown):x is string=>typeof x==='string'&&
 /^[A-Za-z0-9._:-]{8,120}$/.test(x);
const app=(x:unknown):x is string=>typeof x==='string'&&
 /^[A-Za-z0-9._:-]{3,120}$/.test(x);
const kid=(x:unknown):x is string=>typeof x==='string'&&
 /^[a-z0-9][a-z0-9._-]{2,63}$/.test(x);
const nonce=(x:unknown):x is string=>typeof x==='string'&&
 /^[A-Za-z0-9_-]{16,64}$/.test(x);
const hex=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const time=(x:unknown):x is number=>typeof x==='number'&&
 Number.isSafeInteger(x)&&x>=0;
const version=(x:unknown):x is number=>time(x)&&x>0;
const eventTypes=new Set<string>([
 'notification.delivery.queued','identity.session.revoked','identity.member.deleted'
]);
/** Own data-only, exact fields/order; getters, proxies and unexpected keys deny. */
function owned(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return null;
  const ks=Reflect.ownKeys(x);
  if(ks.length!==keys.length||ks.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const y:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(x,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   y[k]=d.value;
  }
  return y;
 }catch{return null;}
}
function parseWire(raw:unknown,scope:Scope,now:number):
 {event:R006VNextEnvelope;mac_hex:string}|null{
 const wrapper=owned(raw,['envelope','mac_hex']);
 if(!wrapper||!hex(wrapper.mac_hex))return null;
 const e=owned(wrapper.envelope,R006_P05_FIELDS);
 if(!e||e.version!==R006_AI0_P05_VERSION||e.purpose!==R006_AI0_P05_PURPOSE||
  e.brand_id!=='starry'||e.app_id!==scope.app_id||
  e.environment!==scope.environment||
  !id(e.event_id)||!id(e.actor_ref)||!id(e.idempotency_key)||
  typeof e.event_type!=='string'||!eventTypes.has(e.event_type)||
  !version(e.auth_version)||!time(e.session_version)||
  !kid(e.issuer_kid)||!version(e.issuer_epoch)||
  !time(e.issued_at)||!time(e.expires_at)||
  !nonce(e.nonce)||!hex(e.payload_sha256)||
  e.expires_at<=e.issued_at||e.expires_at-e.issued_at>120||
  e.expires_at<=now||e.issued_at>now+5||
  now-e.issued_at>120)return null;
 return {event:Object.freeze(e) as R006VNextEnvelope,
  mac_hex:wrapper.mac_hex};
}
/** Never a signer; reference bytes conform EXACTLY to AI-0 vNext Issue #1. */
export function r006VNextSigningBytes(raw:unknown):Uint8Array<ArrayBuffer>|null{
 const e=owned(raw,R006_P05_FIELDS);
 if(!e||e.version!==R006_AI0_P05_VERSION||
  R006_P05_FIELDS.some(k=>typeof e[k]!=='string'&&typeof e[k]!=='number'))
  return null;
 const bytes=new TextEncoder().encode(JSON.stringify([
  R006_AI0_P05_DOMAIN,...R006_P05_FIELDS.map(k=>e[k])
 ]));
 const buf=new Uint8Array(new ArrayBuffer(bytes.byteLength));buf.set(bytes);
 return buf;
}
function macBytes(s:string):Uint8Array<ArrayBuffer>{
 const b=new Uint8Array(new ArrayBuffer(32));
 for(let i=0;i<32;i++)b[i]=Number.parseInt(s.slice(i*2,i*2+2),16);
 return b;
}
function leaseValid(l:Lease|null,e:R006VNextEnvelope):l is Lease{
 try{return !!l&&l.kid===e.issuer_kid&&l.epoch===e.issuer_epoch&&
  !!l.key&&l.key.type==='secret'&&!l.key.extractable&&
  l.key.algorithm.name==='HMAC'&&
  (l.key.algorithm as HmacKeyAlgorithm).hash.name==='SHA-256'&&
  l.key.usages.includes('verify');}
 catch{return false;}
}
function sameLease(a:Lease,b:Lease):boolean{
 return a.kid===b.kid&&a.epoch===b.epoch&&a.key===b.key;
}
function deny(reason:R006PublicReview['reason'],
 status:R006PublicReview['status']='blocked'):R006PublicReview{
 return Object.freeze({
  contract:R006_AUTH_ADAPTER_VERSION,wire_version:R006_AI0_P05_VERSION,
  status,reason,verified_live:false,may_read_live:false,may_write_d1:false,
  may_send:false,may_enqueue:false,may_ack_queue:false,may_grant:false,
  may_purchase:false,may_charge:false,may_publish:false
 });
}
export function createOfflineR006P05VNextAuthAdapter(deps:Readonly<{
 enabled?:boolean;serverScope:TrustedScope;expectedOrigin:string;authDb:D1Database;
 getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
 readActiveDigestKey:()=>Promise<{kid:string;epoch:number;key:CryptoKey}|null>;
 /** AI-0-owned candidate verifier key lease, read-only injection; no KMS/writer. */
 readCurrentIssuerKey:()=>Promise<Lease|null>;
 /** Auth-owned actor binding and physical monotonically advancing version
  * require FUTURE Gate approval; test-only injection is NOT real D1 authority.
  */
 resolveEventActor:(e:CandidateVerifiedEvent)=>Promise<CandidateActorBinding|null>;
 readSessionEpoch:(b:CandidateActorBinding)=>Promise<{
  session_id:string;app_id:string;environment:Env;version:number
 }|null>;
}>){
 const s=deps?.serverScope;
 if(!s||s.brand_id!=='starry'||!app(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  !deps.authDb||typeof deps.authDb.prepare!=='function'||
  typeof deps.getVerificationKey!=='function'||
  typeof deps.readActiveDigestKey!=='function'||
  typeof deps.readCurrentIssuerKey!=='function'||
  typeof deps.resolveEventActor!=='function'||
  typeof deps.readSessionEpoch!=='function')
  throw Error('R006_TRUSTED_PORTS_REQUIRED');
 const scope:Scope=Object.freeze({brand_id:'starry',app_id:s.app_id,
  environment:s.environment});
 const used=new Set<string>(); // bounded local only; NOT distributed replay protection
 const views=new WeakMap<object,R006PrivateReview>();
 const consumed=new WeakSet<object>();
 return Object.freeze({
  contract:R006_AUTH_ADAPTER_VERSION,
  async reviewFresh(raw:unknown,request:unknown,now:unknown):
   Promise<R006PublicReview>{
   if(deps.enabled!==true)return deny('DISABLED');
   if(!time(now))return deny('INVALID_VNEXT');
   const parsed=parseWire(raw,scope,now);
   if(!parsed)return deny('INVALID_VNEXT');
   const e=parsed.event;
   const replay=[e.event_id,e.idempotency_key,e.nonce].map(
    (v,i)=>['event','idempotency','nonce'][i]+':'+v);
   if(replay.some(k=>used.has(k))||used.size+3>768)
    return deny('REPLAY_DENIED');
   const canonical=r006VNextSigningBytes(e);
   if(!canonical)return deny('INVALID_VNEXT');
   let pinned:Lease|null=null;
   let verified=0,rotated=false;
   const verify=async (input:unknown):Promise<CandidateVerifiedEvent|null>=>{
    const next=parseWire(input,scope,now);
    if(!next||next.mac_hex!==parsed.mac_hex||
     R006_P05_FIELDS.some(k=>next.event[k]!==e[k]))return null;
    const before=await deps.readCurrentIssuerKey();
    if(!leaseValid(before,e))return null;
    const valid=await crypto.subtle.verify('HMAC',before.key,
     macBytes(parsed.mac_hex),canonical);
    if(!valid)return null;
    const after=await deps.readCurrentIssuerKey();
    if(!leaseValid(after,e)||!sameLease(before,after)||
     (pinned!==null&&!sameLease(pinned,before))){
     rotated=true;return null;
    }
    if(verified===0){
     // Only cryptographically valid, stable-issuer candidates reserve slots.
     if(replay.some(k=>used.has(k))||used.size+3>768)return null;
     replay.forEach(k=>used.add(k));
    }
    pinned=after;verified++;
    return Object.freeze({
     brand_id:'starry',app_id:scope.app_id,environment:scope.environment,
     event_id:e.event_id,event_type:e.event_type,actor_ref:e.actor_ref,
     auth_version:e.auth_version,session_version:e.session_version,
     issuer_kid:e.issuer_kid,issuer_epoch:e.issuer_epoch,issued_at:e.issued_at
    });
   };
   try{
    const r004=createOfflineR004EventBoundSessionFence({
     enabled:true,serverScope:scope,expectedOrigin:deps.expectedOrigin,
     authDb:deps.authDb,getVerificationKey:deps.getVerificationKey,
     readActiveDigestKey:deps.readActiveDigestKey,
     verifyCanonicalSource:verify,
     resolveEventActor:deps.resolveEventActor,
     readSessionEpoch:deps.readSessionEpoch
    });
    const view=await r004.readEventBoundCurrentSession(raw,request,now);
    if(rotated)return deny('KEY_ROTATED');
    if(verified!==2||view.status!=='review_only')
     return deny(verified===0?'SIGNATURE_INVALID':'CURRENT_AUTH_DENIED');
    const proof:R004PrivateFence|null=r004.readServerFence(view);
    if(!proof||proof.event_id!==e.event_id||proof.actor_ref!==e.actor_ref||
     proof.issuer_kid!==e.issuer_kid||proof.issuer_epoch!==e.issuer_epoch||
     proof.auth_version!==e.auth_version||
     proof.session_version!==e.session_version)return deny('CURRENT_AUTH_DENIED');
    const p:R006PrivateReview=Object.freeze({
     contract:R006_AUTH_ADAPTER_VERSION,wire_version:R006_AI0_P05_VERSION,
     scope,event_id:e.event_id,actor_ref:e.actor_ref,
     idempotency_key:e.idempotency_key,nonce:e.nonce,
     payload_sha256:e.payload_sha256,issuer_kid:e.issuer_kid,
     issuer_epoch:e.issuer_epoch,auth_version:e.auth_version,
     session_version:e.session_version,expires_at:e.expires_at,
     session_fence_contract:R004_SESSION_FENCE_VERSION,
     evidence:'synthetic_offline_current_auth_only',
     verified_live:false,may_send:false,may_ack_queue:false,may_grant:false
    });
    const result=deny('REVIEW_ONLY_NOT_AUTHORIZED','review_only');
    views.set(result,p);return result;
   }catch{return deny('CURRENT_AUTH_DENIED');}
  },
  readServerReview(view:unknown):R006PrivateReview|null{
   if(!view||typeof view!=='object'||consumed.has(view))return null;
   const p=views.get(view);
   if(!p)return null;
   consumed.add(view);return p;
  }
 });
}
