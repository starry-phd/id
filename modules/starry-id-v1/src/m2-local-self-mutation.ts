/** AI-1 M2: LOCAL-ONLY member self-update and single-session logout.
 * Reuses the R23 signed/DB-fenced principal and original planSelfUpdate.
 * Not wired into the public Worker, OpenAPI, SDK or a live D1 binding.
 * Source-side audit uses SQLite triggers in the DRAFT 003 migration.
 */
import {
  isTrustedPrincipal,planSelfUpdate,readSelf,
} from './index.ts';
import type {SelfProfile,TrustedScope,VerifiedAuthEvidence} from './index.ts';
import {createOfflineStarryRequestAuthBoundary} from './r23-signed-session-d1-request-boundary.ts';
import {createVerifiedSignedSession} from './session-crypto.ts';
import {createStarryD1Port} from './d1-ports.ts';
import type {D1Database} from './d1-ports.ts';

export const M2_SELF_MUTATION_LIVE_ENABLED=false as const;
export const M2_SELF_MUTATION_CONTRACT='starry.ai1.m2.self-cas-logout.local-v1' as const;
export const M2_SELF_PROFILE_PATH='/v1/starry-id/members/me' as const;
export const M2_SELF_LOGOUT_PATH='/v1/starry-id/sessions/logout' as const;
type Scope=TrustedScope & {environment:'development'|'staging'};
type Deps=Readonly<{
 enabled?:boolean;
 serverScope:Scope;
 expectedOrigin:string;
 authDb:D1Database;
 getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
 now:()=>number;
}>;
const positive=(n:unknown):n is number=>
 typeof n==='number'&&Number.isSafeInteger(n)&&n>=1&&n<Number.MAX_SAFE_INTEGER;
const clock=(n:unknown):n is number=>
 typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const bearerPattern=/^Bearer (v1\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{43})$/;
const ifMatch=/^"rev-([1-9][0-9]{0,15})"$/;

const profileCAS=`UPDATE starry_members
SET display_name=?,directory_opt_in=?,display_name_public=?,
    profile_revision=profile_revision+1,updated_at=?
WHERE s_user_id=? AND status='active' AND auth_version=? AND profile_revision=?
  AND profile_revision<9007199254740991
  AND EXISTS (
    SELECT 1 FROM starry_sessions s
    WHERE s.session_id=? AND s.s_user_id=starry_members.s_user_id
    AND s.app_id=? AND s.environment=?
    AND s.auth_version=starry_members.auth_version
    AND s.revoked_at IS NULL AND s.expires_at>?
  )
  AND EXISTS (
    SELECT 1 FROM starry_identities i
    WHERE i.provider=? AND i.subject=?
    AND i.s_user_id=starry_members.s_user_id
  )
RETURNING s_user_id,profile_revision`;

const sessionRevoke=`UPDATE starry_sessions SET revoked_at=?
WHERE session_id=? AND s_user_id=? AND app_id=? AND environment=?
AND auth_version=? AND revoked_at IS NULL AND expires_at>?
AND EXISTS (
  SELECT 1 FROM starry_members m
  WHERE m.s_user_id=starry_sessions.s_user_id
  AND m.status='active' AND m.auth_version=starry_sessions.auth_version
)
AND EXISTS (
  SELECT 1 FROM starry_identities i
  WHERE i.s_user_id=starry_sessions.s_user_id
  AND i.provider=? AND i.subject=?
)
RETURNING session_id,revoked_at`;

function securityHeaders():Headers {
 return new Headers({
  'cache-control':'no-store','pragma':'no-cache',
  'content-type':'application/json; charset=utf-8',
  'x-content-type-options':'nosniff',
 });
}
function deny(status:number,code:string,allow?:string):Response{
 const headers=securityHeaders();
 if(allow)headers.set('allow',allow);
 return new Response(JSON.stringify({error:{code}}),{status,headers});
}
function success(profile:SelfProfile):Response{
 return new Response(JSON.stringify({
  s_user_id:profile.s_user_id,
  display_name:profile.display_name,
  directory_opt_in:profile.directory_opt_in,
  display_name_public:profile.display_name_public,
  profile_revision:profile.profile_revision,
 }),{status:200,headers:securityHeaders()});
}
/** Workerd may surface a zero-byte POST as a non-null ReadableStream.
 * Only an actually exhausted, at-most-zero-byte stream is an empty logout
 * body. Any data, stream error or already-consumed stream fails closed.
 */
async function emptyRequestBody(request:Request):Promise<boolean>{
 if(request.bodyUsed)return false;
 const declared=request.headers.get('content-length');
 if(declared!==null&&!/^0$/.test(declared))return false;
 if(request.body===null)return true;
 let reader:ReadableStreamDefaultReader<Uint8Array>|null=null;
 try{
  reader=request.body.getReader();
  const {done}=await reader.read();
  if(!done){
   await reader.cancel();
   return false;
  }
  return true;
 }catch{return false;}
 finally{try{reader?.releaseLock();}catch{/* fail closed above */}}
}
async function boundedJson(request:Request):Promise<unknown>{
 if(!request.body||request.bodyUsed)throw Error('BODY_DENIED');
 const contentLength=request.headers.get('content-length');
 if(contentLength!==null &&
   (!/^[0-9]{1,4}$/.test(contentLength)||Number(contentLength)>2048))
   throw Error('BODY_DENIED');
 const reader=request.body.getReader();
 const parts:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>2048){await reader.cancel();throw Error('BODY_DENIED');}
   parts.push(value);
  }
 }finally{reader.releaseLock();}
 if(size===0)throw Error('BODY_DENIED');
 const bytes=new Uint8Array(size);let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
/** Authentication evidence is always derived from an actual HMAC bearer, never JSON. */
function sameCurrentEvidence(e:VerifiedAuthEvidence|null,p:{
 brand_id:string;app_id:string;environment:string;
 s_user_id:string;session_id:string;auth_version:number;
}):e is VerifiedAuthEvidence{
 return !!e&&e.brand_id===p.brand_id&&e.app_id===p.app_id&&
 e.environment===p.environment&&e.s_user_id===p.s_user_id&&
 e.session_id===p.session_id&&e.auth_version===p.auth_version;
}
export function createM2LocalSelfMutationHandler(deps:Deps){
 const scope=Object.freeze({...deps.serverScope});
 if(scope.brand_id!=='starry'||scope.app_id!=='starry-id'||
  !['development','staging'].includes(scope.environment)||
  !deps.authDb||typeof deps.authDb.prepare!=='function'||
  typeof deps.getVerificationKey!=='function'||typeof deps.now!=='function')
  throw Error('M2_SELF_MUTATION_CONFIGURATION_DENIED');
 let origin:URL;
 try{origin=new URL(deps.expectedOrigin);}
 catch{throw Error('M2_SELF_MUTATION_ORIGIN_DENIED');}
 if(origin.protocol!=='https:'||origin.username||origin.password||
  origin.pathname!=='/'||origin.search||origin.hash||
  origin.href!==origin.origin+'/')
  throw Error('M2_SELF_MUTATION_ORIGIN_DENIED');
 const enabled=deps.enabled===true;
 const auth=createOfflineStarryRequestAuthBoundary({
  enabled,serverScope:scope,expectedOrigin:origin.origin,
  authDb:deps.authDb,getVerificationKey:deps.getVerificationKey,
 });
 const verifier=createVerifiedSignedSession({scope,getKey:deps.getVerificationKey});
 const port=createStarryD1Port(deps.authDb,scope);
 return Object.freeze({
  contract:M2_SELF_MUTATION_CONTRACT,
  local_only:true as const,
  live_enabled:M2_SELF_MUTATION_LIVE_ENABLED,
  public_worker_route_registered:false as const,
  async handle(request:unknown):Promise<Response>{
   if(!enabled)return deny(503,'FEATURE_DISABLED');
   if(!(request instanceof Request))return deny(400,'REQUEST_DENIED');
   let url:URL;
   try{url=new URL(request.url);}
   catch{return deny(404,'NOT_FOUND');}
   const isProfile=url.pathname===M2_SELF_PROFILE_PATH;
   const isLogout=url.pathname===M2_SELF_LOGOUT_PATH;
   if(url.origin!==origin.origin||url.username||url.password||
    !isProfile&&!isLogout||
    (request.headers.has('host')&&request.headers.get('host')!==url.host)||
    (request.headers.has('origin')&&request.headers.get('origin')!==origin.origin))
    return deny(404,'NOT_FOUND');
   if(isProfile&&request.method!=='PATCH')return deny(405,'METHOD_NOT_ALLOWED','PATCH');
   if(isLogout&&request.method!=='POST')return deny(405,'METHOD_NOT_ALLOWED','POST');
   if(url.search||url.hash)return deny(400,'REQUEST_DENIED');
   if(request.headers.has('cookie')||request.headers.has('proxy-authorization')||
    request.headers.has('x-forwarded-authorization')||
    request.headers.has('x-forwarded-host'))
    return deny(401,'IDENTITY_DENIED');
   const bearer=bearerPattern.exec(request.headers.get('authorization')??'');
   if(!bearer)return deny(401,'IDENTITY_DENIED');
   try{
    // Clock outages must use this handler's sanitized HTTP error boundary.
    const now=deps.now();
    if(!clock(now))return deny(503,'SERVICE_UNAVAILABLE');
    const principal=await auth.authenticate(request,now);
    if(!isTrustedPrincipal(principal))return deny(401,'IDENTITY_DENIED');
    const signed=await verifier(bearer[1],now);
    if(!sameCurrentEvidence(signed,principal))return deny(401,'IDENTITY_DENIED');
    // Every mutation is re-fenced against current member/session/identity in
    // the single SQL UPDATE itself, not only the stale pre-UPDATE principal.
    if(isLogout){
     if(!await emptyRequestBody(request))return deny(400,'REQUEST_DENIED');
     const atWrite=deps.now();
     if(!clock(atWrite)||atWrite<now||atWrite>now+30||
       atWrite>=principal.expires_at)return deny(401,'IDENTITY_DENIED');
     const result=await deps.authDb.prepare(sessionRevoke).bind(
      atWrite,principal.session_id,principal.s_user_id,scope.app_id,
      scope.environment,principal.auth_version,atWrite,
      signed.provider,signed.provider_subject,
     ).first<{session_id:string;revoked_at:number}>();
     if(!result)return deny(401,'IDENTITY_DENIED');
     if(result.session_id!==principal.session_id||result.revoked_at!==atWrite)
      return deny(503,'SERVICE_UNAVAILABLE');
     // UPDATE ... RETURNING binds confirmation to the unique Session row,
     // independent of D1 meta.changes including AFTER UPDATE audit triggers.
     // The audit trigger is still atomic or it aborts the source statement.
     return new Response(null,{status:204,headers:securityHeaders()});
    }
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get('content-type')??''))return deny(415,'UNSUPPORTED_MEDIA_TYPE');
    const etag=ifMatch.exec(request.headers.get('if-match')??'');
    if(!etag)return deny(428,'PRECONDITION_REQUIRED');
    const expectedRevision=Number(etag[1]);
    if(!positive(expectedRevision))return deny(400,'REQUEST_DENIED');
    let body:unknown;
    try{body=await boundedJson(request);}
    catch{return deny(400,'REQUEST_DENIED');}
    const current=await port.readMember(principal.s_user_id);
    if(!current)return deny(401,'IDENTITY_DENIED');
    let planned:ReturnType<typeof planSelfUpdate>;
    try{
     planned=planSelfUpdate(principal,scope,current,expectedRevision,body,now);
    }catch(error){
     return error instanceof Error&&error.message==='PROFILE_VERSION_CONFLICT'?
      deny(409,'PROFILE_VERSION_CONFLICT'):
      deny(400,'PROFILE_FIELDS_DENIED');
    }
    const atWrite=deps.now();
    if(!clock(atWrite)||atWrite<now||atWrite>now+30||
      atWrite>=principal.expires_at)return deny(401,'IDENTITY_DENIED');
    const result=await deps.authDb.prepare(profileCAS).bind(
      planned.display_name,Number(planned.directory_opt_in),
      Number(planned.display_name_public),atWrite,
      principal.s_user_id,principal.auth_version,expectedRevision,
      principal.session_id,scope.app_id,scope.environment,atWrite,
      signed.provider,signed.provider_subject,
    ).first<{s_user_id:string;profile_revision:number}>();
    if(!result)return deny(409,'PROFILE_VERSION_CONFLICT');
    if(result.s_user_id!==principal.s_user_id||
      result.profile_revision!==planned.profile_revision)
      return deny(503,'SERVICE_UNAVAILABLE');
    // Confirm the row actually updated by unique-key UPDATE...RETURNING;
    // D1's trigger-inclusive changes metadata is NOT a safe CAS oracle.
    // Reuse original five-field projector and its trusted-principal check.
    return success(readSelf(principal,scope,planned,atWrite));
   }catch{
    return deny(503,'SERVICE_UNAVAILABLE'); // no raw SQL/key/body/token echo
   }
  },
 });
}
