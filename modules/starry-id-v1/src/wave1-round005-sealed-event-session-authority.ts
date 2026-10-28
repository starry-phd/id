/**
 * Wave1 R005: cryptographically checked OFFLINE P05 envelope -> R004 Auth
 * current SessionFence, with server-owned verifier key lease and fail-closed
 * replay. This is NOT an AI-0-approved P05 issuer, production KMS, or Queue.
 */
import {createOfflineR004EventBoundSessionFence,R004_SESSION_FENCE_VERSION} from
 './wave1-round004-event-session-fence.ts';
import type {CandidateVerifiedEvent,CandidateActorBinding,R004PrivateFence} from
 './wave1-round004-event-session-fence.ts';
import type {D1Database} from './d1-ports.ts';
import type {TrustedScope} from './index.ts';

export const R005_ENVELOPE_AUTH_VERSION='starry.auth.p05-envelope-r005.v1-offline-candidate' as const;
export const R005_ENVELOPE_AUTH_LIVE=false as const;
export const R005_R004_DEPENDENCY=R004_SESSION_FENCE_VERSION;
type Env='development'|'staging';
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:Env}>;
type EventType=CandidateVerifiedEvent['event_type'];
export type R005CandidateEnvelope=Readonly<{
 version:typeof R005_ENVELOPE_AUTH_VERSION;
 purpose:'p05_auth_review_only';brand_id:'starry';app_id:string;environment:Env;
 event_id:string;actor_ref:string;event_type:EventType;
 auth_version:number;session_version:number;issuer_kid:string;issuer_epoch:number;
 issued_at:number;expires_at:number;nonce:string;
}>;
/** Signed candidate input is UNTRUSTED. Test-only HMAC signing stays in tests. */
export type R005OpaqueSignedEnvelope=Readonly<{envelope:unknown;mac:unknown}>;
type KeyLease=Readonly<{kid:string;epoch:number;key:CryptoKey}>;
export type R005ServerReview=Readonly<{
 kind:'synthetic_offline_event_bound_auth_review_only';
 contract:typeof R005_ENVELOPE_AUTH_VERSION;
 session_fence_contract:typeof R004_SESSION_FENCE_VERSION;
 brand_id:'starry';app_id:string;environment:Env;event_id:string;
 actor_ref:string;auth_version:number;session_version:number;
 issuer_kid:string;issuer_epoch:number;expires_at:number;
 verified_live:false;may_send:false;may_ack_queue:false;may_grant:false;
}>;
export type R005PublicReview=Readonly<{
 contract:typeof R005_ENVELOPE_AUTH_VERSION;
 status:'blocked'|'review_only';
 reason:'DISABLED'|'INVALID_ENVELOPE'|'ISSUER_UNAVAILABLE'|
  'ISSUER_ROTATED'|'REPLAY_BLOCKED'|'CURRENT_AUTH_DENIED'|'AUTH_REVIEW_ONLY';
 verified_live:false;may_send:false;may_ack_queue:false;may_grant:false;
 may_charge:false;may_publish:false;
}>;
/** Auth->Billing stays a separate R003 CURRENT signed-Session authority.
 * Never pass a P05 event or an AI-2 offline fixture as a Billing identity.
 */
export type R005BillingIdentityBoundaryProposal=Readonly<{
 contract:'starry.auth.identity-authority.r003.v1-candidate';
 kind:'signed_auth_d1_review_only';
 digest_format:'ai1.r002.json-hmac.v1';
 purpose:'billing_identity_review';
 key_lease:'server-only-purpose-app-environment-kid-epoch';
 q104_q119:'PENDING_OWNER_GATE';
 store_authorized:false;
}>;
const fields=['version','purpose','brand_id','app_id','environment','event_id',
 'actor_ref','event_type','auth_version','session_version','issuer_kid',
 'issuer_epoch','issued_at','expires_at','nonce'] as const;
type Fields=typeof fields;
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(x);
const eventRef=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{8,128}$/.test(x);
const keyId=(x:unknown):x is string=>typeof x==='string'&&/^[a-z0-9][a-z0-9._-]{2,63}$/.test(x);
const pos=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0;
const epoch=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const events=new Set<string>(['notification.delivery.queued',
 'identity.session.revoked','identity.member.deleted']);
function exactRecord(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return null;
  const actual=Reflect.ownKeys(v);
  if(actual.length!==keys.length||
   actual.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const r:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   r[k]=d.value;
  }
  return r;
 }catch{return null;}
}
function validLease(v:KeyLease|null):v is KeyLease{
 if(!v||!keyId(v.kid)||!pos(v.epoch))return false;
 try{
  const k=v.key;
  return !!k&&k.type==='secret'&&k.extractable===false&&
   k.algorithm.name==='HMAC'&&
   (k.algorithm as HmacKeyAlgorithm).hash.name==='SHA-256'&&
   k.usages.includes('verify');
 }catch{return false;}
}
function readInput(raw:unknown,s:Scope,now:number):
 {envelope:R005CandidateEnvelope;mac:string}|null{
 const outer=exactRecord(raw,['envelope','mac']);
 if(!outer||typeof outer.mac!=='string'||!/^[a-f0-9]{64}$/.test(outer.mac))
  return null;
 const p=exactRecord(outer.envelope,fields);
 if(!p||p.version!==R005_ENVELOPE_AUTH_VERSION||
  p.purpose!=='p05_auth_review_only'||p.brand_id!=='starry'||
  p.app_id!==s.app_id||p.environment!==s.environment||
  !eventRef(p.event_id)||!eventRef(p.actor_ref)||
  typeof p.event_type!=='string'||!events.has(p.event_type)||
  !pos(p.auth_version)||!epoch(p.session_version)||
  !keyId(p.issuer_kid)||!pos(p.issuer_epoch)||
  !epoch(p.issued_at)||!epoch(p.expires_at)||
  !eventRef(p.nonce)||p.issued_at>now||p.expires_at<=now||
  p.expires_at<=p.issued_at||p.expires_at-p.issued_at>60||
  now-p.issued_at>60)return null;
 return {envelope:Object.freeze(p) as R005CandidateEnvelope,mac:outer.mac};
}
/** Domain-separated deterministic bytes; does NOT sign, verify, or grant. */
export function r005EnvelopeSigningBytes(raw:unknown):Uint8Array|null{
 const p=exactRecord(raw,fields);
 if(!p||p.version!==R005_ENVELOPE_AUTH_VERSION)return null;
 if(fields.some(k=>!['string','number'].includes(typeof p[k])))return null;
 return new TextEncoder().encode(JSON.stringify([
  'starry.auth.r005.p05:synthetic-envelope:v1',...fields.map(k=>p[k])
 ]));
}
function hexBytes(s:string):Uint8Array<ArrayBuffer>{
 const a=new Uint8Array(new ArrayBuffer(32));
 for(let i=0;i<32;i++)a[i]=Number.parseInt(s.slice(i*2,i*2+2),16);
 return a;
}
function denied(reason:R005PublicReview['reason'],
 status:R005PublicReview['status']='blocked'):R005PublicReview{
 return Object.freeze({contract:R005_ENVELOPE_AUTH_VERSION,status,reason,
  verified_live:false,may_send:false,may_ack_queue:false,
  may_grant:false,may_charge:false,may_publish:false});
}
function leaseEqual(a:KeyLease,b:KeyLease){
 return a.kid===b.kid&&a.epoch===b.epoch&&a.key===b.key;
}
export function createOfflineR005SealedEventSessionAuthority(deps:Readonly<{
 enabled?:boolean;serverScope:TrustedScope;expectedOrigin:string;authDb:D1Database;
 getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
 readActiveDigestKey:()=>Promise<{kid:string;epoch:number;key:CryptoKey}|null>;
 /** Injected trusted read of the ONE *current* P05 issuer verification key.
  * No HTTP-provided KID/epoch can become authority. Not a real KMS binding.
  */
 readCurrentIssuerKey:()=>Promise<KeyLease|null>;
 /** Auth-owned current, server-resolved event+actor mapping, not HTTP JSON. */
 resolveEventActor:(e:CandidateVerifiedEvent)=>Promise<CandidateActorBinding|null>;
 /** Auth-owned monotonic session_version, unavailable in physical schema 001. */
 readSessionEpoch:(b:CandidateActorBinding)=>Promise<{
  session_id:string;app_id:string;environment:Env;version:number
 }|null>;
}>){
 const s=deps?.serverScope;
 if(!s||s.brand_id!=='starry'||!id(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  typeof deps.readCurrentIssuerKey!=='function'||
  typeof deps.resolveEventActor!=='function'||typeof deps.readSessionEpoch!=='function')
  throw Error('R005_SERVER_PORTS_REQUIRED');
 const scope:Scope=Object.freeze({brand_id:'starry',app_id:s.app_id,
  environment:s.environment});
 const enabled=deps.enabled===true;
 const used=new Set<string>(); // PROCESS-LOCAL ONLY, never durable P05 replay ledger.
 const views=new WeakMap<object,R005ServerReview>();
 const consumed=new WeakSet<object>();
 return Object.freeze({
  contract:R005_ENVELOPE_AUTH_VERSION,
  async reviewFresh(raw:unknown,request:unknown,now:unknown):Promise<R005PublicReview>{
   if(!enabled)return denied('DISABLED');
   if(!epoch(now))return denied('INVALID_ENVELOPE');
   const input=readInput(raw,scope,now);
   if(!input)return denied('INVALID_ENVELOPE');
   const {envelope:e}=input;
   if(used.has(e.event_id)||used.size>=256)return denied('REPLAY_BLOCKED');
   let pinned:KeyLease|null=null;
   let verifiedCount=0;
   let rotated=false;
   const verifyCanonicalSource=async (delivery:unknown):Promise<CandidateVerifiedEvent|null>=>{
    const d=readInput(delivery,scope,now);
    if(!d||d.mac!==input.mac||!fields.every(k=>d.envelope[k]===e[k]))
     return null;
    const k1=await deps.readCurrentIssuerKey();
    if(!validLease(k1)||k1.kid!==e.issuer_kid||k1.epoch!==e.issuer_epoch)
     return null;
    const bytes=r005EnvelopeSigningBytes(e);
    if(!bytes)return null;
    const good=await crypto.subtle.verify('HMAC',k1.key,hexBytes(d.mac),bytes);
    if(!good)return null;
    const k2=await deps.readCurrentIssuerKey();
    if(!validLease(k2)||!leaseEqual(k1,k2)||
     (pinned!==null&&!leaseEqual(pinned,k1))){
     rotated=true;return null;
    }
    // Claim replay ID only AFTER genuine MAC verification and stable key lease.
    // A forged/invalid MAC cannot consume another event's identifier.
    if(verifiedCount===0){
     if(used.has(e.event_id)||used.size>=256)return null;
     used.add(e.event_id);
    }
    pinned=k2;
    verifiedCount++;
    return Object.freeze({
     brand_id:'starry',app_id:scope.app_id,environment:scope.environment,
     event_id:e.event_id,actor_ref:e.actor_ref,event_type:e.event_type,
     auth_version:e.auth_version,session_version:e.session_version,
     issuer_kid:e.issuer_kid,issuer_epoch:e.issuer_epoch,issued_at:e.issued_at
    });
   };
   try{
    // The verifier claims only a cryptographically verified event before
    // opening current Auth D1 reads; invalid MAC attempts do not poison replay.
    const r004=createOfflineR004EventBoundSessionFence({
     enabled:true,serverScope:scope,expectedOrigin:deps.expectedOrigin,
     authDb:deps.authDb,getVerificationKey:deps.getVerificationKey,
     readActiveDigestKey:deps.readActiveDigestKey,
     verifyCanonicalSource,resolveEventActor:deps.resolveEventActor,
     readSessionEpoch:deps.readSessionEpoch
    });
    const v=await r004.readEventBoundCurrentSession(raw,request,now);
    if(rotated)return denied('ISSUER_ROTATED');
    if(verifiedCount!==2||v.status!=='review_only')
     return denied(verifiedCount===0?'ISSUER_UNAVAILABLE':'CURRENT_AUTH_DENIED');
    const proof:R004PrivateFence|null=r004.readServerFence(v);
    if(!proof||proof.event_id!==e.event_id||proof.actor_ref!==e.actor_ref||
     proof.issuer_kid!==e.issuer_kid||proof.issuer_epoch!==e.issuer_epoch||
     proof.auth_version!==e.auth_version||
     proof.session_version!==e.session_version)return denied('CURRENT_AUTH_DENIED');
    // R004 current-session and provenance can *never* authorize a P05 action.
    const privateProof:R005ServerReview=Object.freeze({
     kind:'synthetic_offline_event_bound_auth_review_only',
     contract:R005_ENVELOPE_AUTH_VERSION,
     session_fence_contract:R004_SESSION_FENCE_VERSION,
     brand_id:'starry',app_id:scope.app_id,environment:scope.environment,
     event_id:e.event_id,actor_ref:e.actor_ref,auth_version:e.auth_version,
     session_version:e.session_version,issuer_kid:e.issuer_kid,
     issuer_epoch:e.issuer_epoch,expires_at:e.expires_at,
     verified_live:false,may_send:false,may_ack_queue:false,may_grant:false
    });
    const publicView=denied('AUTH_REVIEW_ONLY','review_only');
    views.set(publicView,privateProof);
    return publicView;
   }catch{return denied('CURRENT_AUTH_DENIED');}
  },
  /** Must be original in-process view, consumed once; never an HTTP DTO. */
  readServerReview(view:unknown):R005ServerReview|null{
   if(!view||typeof view!=='object'||consumed.has(view))return null;
   const p=views.get(view);
   if(!p)return null;
   consumed.add(view);return p;
  }
 });
}
