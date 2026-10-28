/**
 * AI-1 Wave1 R004: OFFLINE current Auth/Session fence for a FUTURE canonical
 * signed P05 event. Never a P05 issuer, deployment, notification or Queue ACK.
 * AI-0/AI-4 MUST inject a real verifier only after future Gate1 approval.
 */
import {createStarryD1Port} from './d1-ports.ts';
import {createOfflineStarryRequestAuthBoundary} from './r23-signed-session-d1-request-boundary.ts';
import {createOfflineR003IdentityAuthorityPort,R003_AUTHORITY_VERSION} from
 './wave1-round003-identity-authority-port.ts';
import type {D1Database} from './d1-ports.ts';
import type {TrustedScope,Provider} from './index.ts';

export const R004_SESSION_FENCE_VERSION='starry.auth.event-session-fence.r004.v1-candidate' as const;
export const R004_SESSION_FENCE_LIVE=false as const;
type Env='development'|'staging';
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:Env}>;
type EventType='notification.delivery.queued'|'identity.session.revoked'|'identity.member.deleted';
/** Only output of a TRUSTED injected canonical verifier; not HTTP JSON authority. */
export type CandidateVerifiedEvent=Readonly<{
 brand_id:'starry';app_id:string;environment:Env;event_id:string;
 actor_ref:string;event_type:EventType;auth_version:number;session_version:number;
 issuer_kid:string;issuer_epoch:number;issued_at:number;
}>;
/** Only trusted server-side actor resolver may produce this mapping. */
export type CandidateActorBinding=Readonly<{
 brand_id:'starry';app_id:string;environment:Env;event_id:string;actor_ref:string;
 s_user_id:string;session_id:string;provider:Provider;provider_subject:string;
 auth_version:number;session_version:number;
}>;
type SessionEpoch=Readonly<{
 session_id:string;app_id:string;environment:Env;version:number;
}>;
export type R004PrivateFence=Readonly<{
 contract:typeof R004_SESSION_FENCE_VERSION;
 brand_id:'starry';app_id:string;environment:Env;event_id:string;actor_ref:string;
 auth_version:number;session_version:number;
 state:'active'|'revoked'|'deleted';issuer_kid:string;issuer_epoch:number;
 r003_contract:typeof R003_AUTHORITY_VERSION;
 evidence_level:'synthetic_offline_review_only';
 verified_live:false;may_send:false;may_enqueue:false;may_ack_queue:false;
}>;
export type R004PublicFence=Readonly<{
 contract:typeof R004_SESSION_FENCE_VERSION;status:'blocked'|'review_only';
 reason:'DISABLED'|'INVALID_SOURCE'|'SCOPE_DENIED'|'ACTOR_UNBOUND'|
  'CURRENT_SESSION_DENIED'|'SESSION_CHANGED'|'REPLAY_DENIED'|
  'AUTH_OR_KEY_UNAVAILABLE'|'AUTH_REVIEW_ONLY';
 verified_live:false;may_send:false;may_enqueue:false;may_ack_queue:false;
 may_grant:false;may_charge:false;may_publish:false;
}>;
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(x);
const ref=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{8,128}$/.test(x);
const pos=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0;
const epoch=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const types=new Set<string>(['notification.delivery.queued','identity.session.revoked','identity.member.deleted']);
function denial(reason:R004PublicFence['reason'],status:R004PublicFence['status']='blocked'):R004PublicFence{
 return Object.freeze({contract:R004_SESSION_FENCE_VERSION,status,reason,
  verified_live:false,may_send:false,may_enqueue:false,may_ack_queue:false,
  may_grant:false,may_charge:false,may_publish:false});
}
function eventValid(v:unknown,s:Scope,now:number):v is CandidateVerifiedEvent{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const e=v as CandidateVerifiedEvent;
 return e.brand_id===s.brand_id&&e.app_id===s.app_id&&
  e.environment===s.environment&&ref(e.event_id)&&ref(e.actor_ref)&&
  types.has(e.event_type)&&pos(e.auth_version)&&epoch(e.session_version)&&
  id(e.issuer_kid)&&pos(e.issuer_epoch)&&epoch(e.issued_at)&&
  e.issued_at<=now&&now-e.issued_at<=300;
}
function bindingValid(b:unknown,e:CandidateVerifiedEvent,s:Scope):b is CandidateActorBinding{
 if(!b||typeof b!=='object'||Array.isArray(b))return false;
 const x=b as CandidateActorBinding;
 return x.brand_id==='starry'&&x.app_id===s.app_id&&x.environment===s.environment&&
  x.event_id===e.event_id&&x.actor_ref===e.actor_ref&&
  id(x.s_user_id)&&id(x.session_id)&&id(x.provider_subject)&&
  (x.provider==='apple'||x.provider==='google')&&
  x.auth_version===e.auth_version&&x.session_version===e.session_version;
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function createOfflineR004EventBoundSessionFence(deps:Readonly<{
 enabled?:boolean;serverScope:TrustedScope;expectedOrigin:string;authDb:D1Database;
 getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
 readActiveDigestKey:()=>Promise<{kid:string;epoch:number;key:CryptoKey}|null>;
 /** An injected AI-0/4 future canonical cryptographic verifier, NEVER request flags. */
 verifyCanonicalSource:(raw:unknown)=>Promise<CandidateVerifiedEvent|null>;
 /** Server-only mapping of the verified event actor, never a caller-supplied ID. */
 resolveEventActor:(e:CandidateVerifiedEvent)=>Promise<CandidateActorBinding|null>;
 /** A future persistent Auth-owned monotonic version read; absent in 001 schema. */
 readSessionEpoch:(b:CandidateActorBinding)=>Promise<SessionEpoch|null>;
}>){
 const s=deps?.serverScope;
 if(!s||s.brand_id!=='starry'||!id(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  !deps.authDb||typeof deps.authDb.prepare!=='function'||
  typeof deps.getVerificationKey!=='function'||
  typeof deps.readActiveDigestKey!=='function'||
  typeof deps.verifyCanonicalSource!=='function'||
  typeof deps.resolveEventActor!=='function'||
  typeof deps.readSessionEpoch!=='function')throw Error('R004_SCOPE_OR_PORT_DENIED');
 const scope:Scope=Object.freeze({brand_id:'starry',app_id:s.app_id,environment:s.environment});
 const auth=createStarryD1Port(deps.authDb,scope);
 const requestAuth=createOfflineStarryRequestAuthBoundary(deps);
 const authority=createOfflineR003IdentityAuthorityPort(deps);
 const used=new Set<string>(); // local negative guard; NOT a durable replay ledger.
 const privateViews=new WeakMap<object,R004PrivateFence>();
 const consumed=new WeakSet<object>();
 async function current(e:CandidateVerifiedEvent,b:CandidateActorBinding,
  request:unknown,now:number):Promise<R004PrivateFence|null>{
  const [m,session,linked,sv]=await Promise.all([
   auth.readMember(b.s_user_id),auth.readSession(b.session_id),
   auth.identityMatches(b.provider,b.provider_subject,b.s_user_id),
   deps.readSessionEpoch(b)
  ]);
  if(!m||!session||!linked||!sv||sv.session_id!==b.session_id||
   sv.app_id!==scope.app_id||sv.environment!==scope.environment||
   !epoch(sv.version)||sv.version<e.session_version||
   session.s_user_id!==b.s_user_id||session.app_id!==scope.app_id||
   session.environment!==scope.environment||session.session_id!==b.session_id||
   m.auth_version<e.auth_version||session.auth_version!==b.auth_version)
   return null;
  let state:R004PrivateFence['state'];
  if(e.event_type==='notification.delivery.queued'){
   if(m.status!=='active'||m.auth_version!==b.auth_version||
    session.revoked_at!==null||session.expires_at<=now||
    sv.version!==b.session_version)return null;
   // Existing R003 signed Session+Auth SQLite review is checked BEFORE this
   // candidate; never substitute its Billing digest for a P05 event signature.
   const intent={...scope,flow_ref:'fence_'+'A'.repeat(42)};
   const v=await authority.reviewFresh(request,intent,now);
   const proof=authority.readServerReview(v,intent,now);
   const principal=await requestAuth.authenticate(request,now);
   if(v.status!=='review_only'||!proof||!principal||
    principal.s_user_id!==b.s_user_id||principal.session_id!==b.session_id||
    principal.auth_version!==b.auth_version||
    proof.auth_version!==b.auth_version||proof.app_id!==scope.app_id||
    proof.digest_epoch<1)return null;
   state='active';
  }else if(e.event_type==='identity.session.revoked'){
   if(m.status==='deleted'||session.revoked_at===null||
    session.revoked_at>now)return null;
   state='revoked';
  }else{
   if(m.status!=='deleted'||session.revoked_at===null||
    session.revoked_at>now)return null;
   state='deleted';
  }
  return Object.freeze({contract:R004_SESSION_FENCE_VERSION,
   brand_id:'starry',app_id:scope.app_id,environment:scope.environment,
   event_id:e.event_id,actor_ref:e.actor_ref,auth_version:m.auth_version,
   session_version:sv.version,state,issuer_kid:e.issuer_kid,
   issuer_epoch:e.issuer_epoch,r003_contract:R003_AUTHORITY_VERSION,
   evidence_level:'synthetic_offline_review_only',
   verified_live:false,may_send:false,may_enqueue:false,may_ack_queue:false});
 }
 return Object.freeze({
  contract:R004_SESSION_FENCE_VERSION,
  async readEventBoundCurrentSession(raw:unknown,request:unknown,now:unknown):
   Promise<R004PublicFence>{
   if(deps.enabled!==true)return denial('DISABLED');
   if(!epoch(now))return denial('INVALID_SOURCE');
   try{
    // Mandatory ordering: source verification FIRST, before any Auth D1 read.
    const e=await deps.verifyCanonicalSource(raw);
    if(!eventValid(e,scope,now))return denial('INVALID_SOURCE');
    if(used.has(e.event_id))return denial('REPLAY_DENIED');
    const b=await deps.resolveEventActor(e);
    if(!bindingValid(b,e,scope))return denial('ACTOR_UNBOUND');
    const a=await current(e,b,request,now);
    if(!a)return denial('CURRENT_SESSION_DENIED');
    const e2=await deps.verifyCanonicalSource(raw);
    if(!eventValid(e2,scope,now)||!same(e,e2))return denial('SESSION_CHANGED');
    const b2=await deps.resolveEventActor(e2);
    if(!bindingValid(b2,e2,scope)||!same(b,b2))return denial('SESSION_CHANGED');
    const c=await current(e2,b2,request,now);
    if(!c||!same(a,c))return denial('SESSION_CHANGED');
    if(used.size>=256)return denial('REPLAY_DENIED'); // fail closed, not unbounded.
    used.add(e.event_id);
    const v=denial('AUTH_REVIEW_ONLY','review_only');
    privateViews.set(v,a);
    return v;
   }catch{return denial('AUTH_OR_KEY_UNAVAILABLE');}
  },
  /** No live authority; in-process single-use review for trusted integration only. */
  readServerFence(view:unknown):R004PrivateFence|null{
   if(!view||typeof view!=='object'||consumed.has(view))return null;
   const evidence=privateViews.get(view);
   if(!evidence)return null;
   consumed.add(view);
   return evidence;
  }
 });
}
