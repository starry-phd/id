/**
 * Wave1 AI-1 R008 OFFLINE-ONLY Auth current-session monotonic CAS review.
 * AI-0 Issue #2 #6476963111. This is not a D1 writer, issuer, or live gate.
 */
export const R008_AUTH_CAS_VERSION =
 'starry.auth.current-session-monotonic-cas.r008.offline-only' as const;
export const R008_AUTH_CAS_LIVE = false as const;
type Env='development'|'staging';
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:Env}>;
type Claim=Readonly<{
 source:'synthetic_server_auth_resolver';brand_id:'starry';
 app_id:string;environment:Env;event_id:string;actor_ref:string;
 member_ref:string;session_ref:string;provider_ref:string;
 token_fingerprint:string;auth_version:number;session_version:number;
 issuer_epoch:number;expires_at:number;
}>;
type Lease=Readonly<{
 source:'synthetic_server_issuer_lease';kid:string;
 issuer_epoch:number;generation:number;
}>;
export type R008PublicResult=Readonly<{
 contract:typeof R008_AUTH_CAS_VERSION;
 status:'blocked'|'review_only';
 reason:'DISABLED'|'UNTRUSTED_REQUEST'|'AUTH_UNAVAILABLE'|
 'INVALID_SERVER_CLAIM'|'STALE_SESSION'|'ISSUER_DRIFT'|
 'CAS_CONFLICT_OR_REPLAY'|'PORT_FAILURE'|'OFFLINE_CAS_NOT_LIVE_AUTHORITY';
 authority:'local_sqlite_memory_simulation_only';
 verified_live:false;may_write_live_d1:false;may_send:false;
 may_enqueue:false;may_ack_queue:false;may_grant:false;
 may_bill:false;may_charge:false;may_publish:false;
}>;
const denial=(reason:R008PublicResult['reason'],
 status:R008PublicResult['status']='blocked'):R008PublicResult=>
 Object.freeze({contract:R008_AUTH_CAS_VERSION,status,reason,
 authority:'local_sqlite_memory_simulation_only' as const,
 verified_live:false as const,may_write_live_d1:false as const,
 may_send:false as const,may_enqueue:false as const,
 may_ack_queue:false as const,may_grant:false as const,
 may_bill:false as const,may_charge:false as const,
 may_publish:false as const});
const unsigned=(v:unknown):v is number=>typeof v==='number'&&
 Number.isSafeInteger(v)&&v>=0;
const positive=(v:unknown):v is number=>unsigned(v)&&v>0;
const ref=(v:unknown):v is string=>typeof v==='string'&&
 /^[A-Za-z0-9._:-]{8,128}$/.test(v);
const app=(v:unknown):v is string=>typeof v==='string'&&
 /^[A-Za-z0-9._:-]{3,100}$/.test(v);
function exact<T>(raw:unknown,fields:readonly string[]):T|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const proto=Object.getPrototypeOf(raw);
  if(proto!==null&&proto!==Object.prototype)return null;
  const keys=Reflect.ownKeys(raw);
  if(keys.length!==fields.length||
    keys.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const copy:Record<string,unknown>=Object.create(null);
  for(const k of fields){
   const d=Object.getOwnPropertyDescriptor(raw,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   copy[k]=d.value;
  }
  return Object.freeze(copy) as T;
 }catch{return null;}
}
const claimFields=[
 'source','brand_id','app_id','environment','event_id','actor_ref',
 'member_ref','session_ref','provider_ref','token_fingerprint',
 'auth_version','session_version','issuer_epoch','expires_at'
] as const;
const leaseFields=['source','kid','issuer_epoch','generation'] as const;
function currentClaim(raw:unknown,s:Scope,now:number):Claim|null{
 const c=exact<Claim>(raw,claimFields);
 if(!c||c.source!=='synthetic_server_auth_resolver'||
 c.brand_id!=='starry'||c.app_id!==s.app_id||
 c.environment!==s.environment||!ref(c.event_id)||!ref(c.actor_ref)||
 !ref(c.member_ref)||!ref(c.session_ref)||!ref(c.provider_ref)||
 !/^[a-f0-9]{64}$/.test(c.token_fingerprint)||
 !positive(c.auth_version)||!unsigned(c.session_version)||
 !positive(c.issuer_epoch)||!positive(c.expires_at)||
 c.expires_at<=now)return null;
 return c;
}
function currentLease(raw:unknown,c:Claim):Lease|null{
 const l=exact<Lease>(raw,leaseFields);
 if(!l||l.source!=='synthetic_server_issuer_lease'||
 !ref(l.kid)||!positive(l.issuer_epoch)||
 !unsigned(l.generation)||l.issuer_epoch!==c.issuer_epoch)
 return null;
 return l;
}
function validRequest(raw:unknown,expectedOrigin:string):raw is Request{
 try{
  if(!(raw instanceof Request)||raw.method!=='POST')return false;
  const url=new URL(raw.url);
  if(url.origin!==expectedOrigin||url.username||url.password)return false;
  const host=raw.headers.get('host');
  if(host!==null&&host!==url.host)return false;
  if(raw.headers.has('x-verified')||raw.headers.has('x-auth-version')||
   raw.headers.has('x-session-version')||raw.headers.has('x-issuer-epoch'))
   return false;
  return /^Bearer [A-Za-z0-9._~-]{8,512}$/.test(
   raw.headers.get('authorization')??'');
 }catch{return false;}
}
export function createOfflineR008AuthSessionCasReview(deps:Readonly<{
 enabled?:boolean;
 serverScope:Scope;
 expectedOrigin:string;
 /** Synthetic server-only Auth verifier; never use untrusted client JSON. */
 readServerAuthenticatedClaim:(request:Request)=>Promise<unknown>;
 /** Synthetic epoch floor; does NOT satisfy independent anti-PITR witness. */
 readMockMonotonicFloor:(claim:Claim)=>Promise<number|null>;
 /** Synthetic issuer check, not a real KMS/key custody interface. */
 readMockIssuerLease:(claim:Claim)=>Promise<unknown>;
 /** Sole mocked atomic SQL transaction: conditional row update + replay INSERT.
  * Must return applied ONLY after local SQLite transaction COMMIT.
  */
 compareAndSwapLocalOnly:(claim:Claim,lease:Lease)=>Promise<'local_applied'|'denied'>;
}>){
 const s=deps?.serverScope;
 if(!s||s.brand_id!=='starry'||!app(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  typeof deps.expectedOrigin!=='string'||
  !/^https:\/\/[^/]+$/.test(deps.expectedOrigin)||
  typeof deps.readServerAuthenticatedClaim!=='function'||
  typeof deps.readMockMonotonicFloor!=='function'||
  typeof deps.readMockIssuerLease!=='function'||
  typeof deps.compareAndSwapLocalOnly!=='function')
  throw Error('R008_LOCAL_AUTH_PORTS_REQUIRED');
 const scope:Scope=Object.freeze({brand_id:'starry',app_id:s.app_id,
  environment:s.environment});
 return Object.freeze({
  contract:R008_AUTH_CAS_VERSION,
  async review(raw:unknown,now:unknown):Promise<R008PublicResult>{
   if(deps.enabled!==true)return denial('DISABLED');
   if(!positive(now)||!validRequest(raw,deps.expectedOrigin))
    return denial('UNTRUSTED_REQUEST');
   try{
    // A client-controlled verified=true, token timestamp, or version NEVER
    // creates server authority. This callback is offline test injection only.
    const c=currentClaim(await deps.readServerAuthenticatedClaim(raw),
     scope,now);
    if(!c)return denial('AUTH_UNAVAILABLE');
    const floor=await deps.readMockMonotonicFloor(c);
    if(!unsigned(floor)||c.session_version<floor)
     return denial('STALE_SESSION');
    const first=currentLease(await deps.readMockIssuerLease(c),c);
    if(!first)return denial('ISSUER_DRIFT');
    // Mock SQL performs CAS and unique event insert in ONE local transaction.
    // Fail closed on conflicts, revocation, missing row, timeout, rollback.
    const applied=await deps.compareAndSwapLocalOnly(c,first);
    if(applied!=='local_applied')return denial('CAS_CONFLICT_OR_REPLAY');
    const second=currentLease(await deps.readMockIssuerLease(c),c);
    if(!second||second.kid!==first.kid||
      second.generation!==first.generation)
     return denial('ISSUER_DRIFT');
    // Local commit cannot be rolled back here on a post-CAS KID change.
    // In particular it NEVER implies a live delivery/Queue authorization.
    return denial('OFFLINE_CAS_NOT_LIVE_AUTHORITY','review_only');
   }catch{return denial('PORT_FAILURE');}
  }
 });
}
