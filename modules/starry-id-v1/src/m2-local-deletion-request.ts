/**
 * AI-1 M2 | durable TWO-confirmation account-deletion REQUEST receipt, LOCAL ONLY.
 *
 * A valid request becomes pending_processing. It DOES NOT erase data, change
 * Member.status, revoke Sessions, execute an outbox, or claim completion.
 * Q104/Q119/anti-PITR/audit-FK/legal retention remain separately blocked.
 * No public Worker route or production D1 migration is registered.
 */
import {isTrustedPrincipal} from './index.ts';
import type {TrustedScope,VerifiedAuthEvidence} from './index.ts';
import {createOfflineStarryRequestAuthBoundary} from './r23-signed-session-d1-request-boundary.ts';
import {createVerifiedSignedSession} from './session-crypto.ts';
import type {D1Database} from './d1-ports.ts';

export const M2_DELETE_REQUEST_LIVE_ENABLED=false as const;
export const M2_DELETE_REQUEST_CONTRACT='starry.m2.local-delete-request-receipt.v1' as const;
export const M2_DELETE_REQUEST_PATH='/v1/starry-id/members/me/deletion-requests' as const;
export const M2_DELETE_CONFIRM_PATH='/v1/starry-id/members/me/deletion-requests/confirm' as const;
export const M2_DELETE_STATUS_PATH='/v1/starry-id/members/me/deletion-requests/status' as const;
export const FIRST_CONFIRMATION='REQUEST_MY_ACCOUNT_DELETION' as const;
export const SECOND_CONFIRMATION='CONFIRM_MY_ACCOUNT_DELETION' as const;

type Scope=TrustedScope&{environment:'development'|'staging'};
type Deps=Readonly<{
 enabled?:boolean;
 serverScope:Scope;
 expectedOrigin:string;
 authDb:D1Database;
 getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
 now:()=>number;
 /** Test-only seam. A real enabled backend must inject a server CSPRNG. */
 randomBytes?:(length:number)=>Uint8Array;
}>;
type Row=Readonly<{
 request_id:string;
 status:'awaiting_second_confirmation'|'pending_processing';
 first_confirmed_at:number;
 second_confirmed_at:number|null;
}>;
const bearerPattern=/^Bearer (v1\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{43})$/;
const reqIdPattern=/^m2del-[a-f0-9]{48}$/;
const timestamp=(x:unknown):x is number=>
 typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const safeId=(x:unknown):x is string=>
 typeof x==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(x);
const goodRow=(r:Row|null):r is Row=>!!r&&
 reqIdPattern.test(r.request_id)&&timestamp(r.first_confirmed_at)&&
 (r.status==='awaiting_second_confirmation'&&r.second_confirmed_at===null||
  r.status==='pending_processing'&&timestamp(r.second_confirmed_at)&&
   r.second_confirmed_at>=r.first_confirmed_at);

function headers():Headers{
 return new Headers({'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','pragma':'no-cache','x-content-type-options':'nosniff'});
}
function error(status:number,code:string,allow?:string):Response{
 const h=headers();if(allow)h.set('allow',allow);
 return new Response(JSON.stringify({error:{code}}),{status,headers:h});
}
function accepted(row:Row):Response{
 return new Response(JSON.stringify({
  request_id:row.request_id,status:row.status,
  first_confirmed_at:row.first_confirmed_at,
  second_confirmed_at:row.second_confirmed_at,
  physical_erasure_completed:false,
  execution_authorized:false,
 }),{status:202,headers:headers()});
}
function status(row:Row):Response{
 return new Response(JSON.stringify({
  request_id:row.request_id,status:row.status,
  first_confirmed_at:row.first_confirmed_at,
  second_confirmed_at:row.second_confirmed_at,
  physical_erasure_completed:false,
  execution_authorized:false,
 }),{status:200,headers:headers()});
}
function currentEvidence(e:VerifiedAuthEvidence|null,p:{
 brand_id:string;app_id:string;environment:string;
 s_user_id:string;session_id:string;auth_version:number;
}):e is VerifiedAuthEvidence{
 return !!e&&e.brand_id===p.brand_id&&e.app_id===p.app_id&&
  e.environment===p.environment&&e.s_user_id===p.s_user_id&&
  e.session_id===p.session_id&&e.auth_version===p.auth_version&&
  safeId(e.provider_subject)&&['apple','google'].includes(e.provider);
}
async function readJson(request:Request):Promise<unknown>{
 if(request.bodyUsed||!request.body)throw Error('BODY_DENIED');
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^[0-9]{1,3}$/.test(length)||Number(length)>512))
  throw Error('BODY_DENIED');
 const reader=request.body.getReader();
 const chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>512){await reader.cancel();throw Error('BODY_DENIED');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 if(total===0)throw Error('BODY_DENIED');
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function exactBody(body:unknown,stage:'first'|'second'):string|null{
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 const obj=body as Record<string,unknown>;
 const keys=Object.keys(obj).sort().join('|');
 if(stage==='first'){
  return keys==='confirmation'&&obj.confirmation===FIRST_CONFIRMATION?'first':null;
 }
 return keys==='confirmation|request_id'&&
  obj.confirmation===SECOND_CONFIRMATION&&
  typeof obj.request_id==='string'&&reqIdPattern.test(obj.request_id)?
  obj.request_id:null;
}
function randomId(random:(n:number)=>Uint8Array):string{
 const bytes=random(24);
 if(!(bytes instanceof Uint8Array)||bytes.length!==24)throw Error('RNG_DENIED');
 return 'm2del-'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}

// These predicates are evaluated in the ACTUAL SQLite source write, never
// only against the earlier (possibly stale) signed Auth principal.
const currentMember=`SELECT m.s_user_id FROM starry_members m
 WHERE m.s_user_id=? AND m.status='active' AND m.auth_version=?
 AND EXISTS (
  SELECT 1 FROM starry_sessions s WHERE s.session_id=?
   AND s.s_user_id=m.s_user_id AND s.app_id=? AND s.environment=?
   AND s.auth_version=m.auth_version AND s.revoked_at IS NULL
   AND s.expires_at>?
 )
 AND EXISTS (
  SELECT 1 FROM starry_identities i WHERE i.s_user_id=m.s_user_id
   AND i.provider=? AND i.subject=?
 )`;
const insertRequest=`INSERT INTO starry_m2_deletion_requests
 (request_id,s_user_id,app_id,environment,status,first_confirmed_at,second_confirmed_at)
 SELECT ?,m.s_user_id,?,?,'awaiting_second_confirmation',?,NULL
 FROM starry_members m
 WHERE m.s_user_id=? AND m.status='active' AND m.auth_version=?
 AND EXISTS(
  SELECT 1 FROM starry_sessions s WHERE s.session_id=?
  AND s.s_user_id=m.s_user_id AND s.app_id=? AND s.environment=?
  AND s.auth_version=m.auth_version AND s.revoked_at IS NULL
  AND s.expires_at>?
 )
 AND EXISTS(
  SELECT 1 FROM starry_identities i WHERE i.s_user_id=m.s_user_id
  AND i.provider=? AND i.subject=?
 )
 ON CONFLICT(s_user_id,app_id,environment) DO NOTHING
 RETURNING request_id,status,first_confirmed_at,second_confirmed_at`;
const selectRequest=`SELECT r.request_id,r.status,r.first_confirmed_at,r.second_confirmed_at
 FROM starry_m2_deletion_requests r
 WHERE r.s_user_id=? AND r.app_id=? AND r.environment=?
 AND EXISTS (${currentMember.replace('SELECT m.s_user_id','SELECT 1')})
 LIMIT 1`;
const confirmRequest=`UPDATE starry_m2_deletion_requests SET
 status='pending_processing',second_confirmed_at=?
 WHERE request_id=? AND s_user_id=? AND app_id=? AND environment=?
 AND status='awaiting_second_confirmation'
 AND EXISTS (${currentMember.replace('SELECT m.s_user_id','SELECT 1')})
 RETURNING request_id,status,first_confirmed_at,second_confirmed_at`;

export function createM2LocalDeletionRequestHandler(deps:Deps){
 const scope=Object.freeze({...deps?.serverScope});
 // Trusted DI may be a mutable JS object even with Readonly<T> at compile
 // time. Pin every authority and method BEFORE an awaited key/DB operation.
 const sourceDb=deps?.authDb;
 const getVerificationKey=deps?.getVerificationKey;
 const now=deps?.now;
 const randomBytes=deps?.randomBytes;
 if(scope.brand_id!=='starry'||scope.app_id!=='starry-id'||
  !['development','staging'].includes(scope.environment)||
  !sourceDb||typeof sourceDb.prepare!=='function'||
  typeof getVerificationKey!=='function'||typeof now!=='function')
  throw Error('M2_DELETE_REQUEST_CONFIGURATION_DENIED');
 const authDb:D1Database=Object.freeze({
  prepare:sourceDb.prepare.bind(sourceDb),
 });
 let origin:URL;
 try{origin=new URL(deps.expectedOrigin);}catch{throw Error('M2_DELETE_REQUEST_ORIGIN_DENIED');}
 if(origin.protocol!=='https:'||origin.username||origin.password||
  origin.pathname!=='/'||origin.search||origin.hash||
  origin.href!==origin.origin+'/')throw Error('M2_DELETE_REQUEST_ORIGIN_DENIED');
 const enabled=deps.enabled===true;
 const authenticate=createOfflineStarryRequestAuthBoundary({
  enabled,serverScope:scope,expectedOrigin:origin.origin,
  authDb,getVerificationKey,
 });
 const verifySession=createVerifiedSignedSession({
  scope,getKey:getVerificationKey,
 });
 const random=randomBytes??(n=>crypto.getRandomValues(new Uint8Array(n)));
 return Object.freeze({
  contract:M2_DELETE_REQUEST_CONTRACT,
  local_only:true as const,
  live_enabled:M2_DELETE_REQUEST_LIVE_ENABLED,
  public_worker_route_registered:false as const,
  physical_erasure_implemented:false as const,
  async handle(request:unknown):Promise<Response>{
   if(!enabled)return error(503,'FEATURE_DISABLED');
   if(!(request instanceof Request))return error(400,'REQUEST_DENIED');
   let url:URL;
   try{url=new URL(request.url);}catch{return error(404,'NOT_FOUND');}
   const first=url.pathname===M2_DELETE_REQUEST_PATH;
   const second=url.pathname===M2_DELETE_CONFIRM_PATH;
   const check=url.pathname===M2_DELETE_STATUS_PATH;
   if(url.origin!==origin.origin||url.username||url.password||
    !(first||second||check)||
    request.headers.has('host')&&request.headers.get('host')!==url.host||
    request.headers.has('origin')&&request.headers.get('origin')!==origin.origin)
    return error(404,'NOT_FOUND');
   if(check&&request.method!=='GET')return error(405,'METHOD_NOT_ALLOWED','GET');
   if((first||second)&&request.method!=='POST')
    return error(405,'METHOD_NOT_ALLOWED','POST');
   if(url.search||url.hash)return error(400,'REQUEST_DENIED');
   if(request.headers.has('cookie')||
    request.headers.has('proxy-authorization')||
    request.headers.has('x-forwarded-authorization')||
    request.headers.has('x-forwarded-host'))
    return error(401,'IDENTITY_DENIED');
   if(check&&request.body!==null)return error(400,'REQUEST_DENIED');
   const bearer=bearerPattern.exec(request.headers.get('authorization')??'');
   if(!bearer)return error(401,'IDENTITY_DENIED');
   try{
    // Trusted time itself may throw; own the exception boundary instead of
    // letting a raw Promise rejection leak via an unapproved HTTP wrapper.
    const startedAt=now();
    if(!timestamp(startedAt))return error(503,'SERVICE_UNAVAILABLE');
    const principal=await authenticate.authenticate(request,startedAt);
    if(!isTrustedPrincipal(principal))return error(401,'IDENTITY_DENIED');
    const verified=await verifySession(bearer[1],startedAt);
    if(!currentEvidence(verified,principal))return error(401,'IDENTITY_DENIED');
    let body:unknown;
    if(!check){
     if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get('content-type')??''))
      return error(415,'UNSUPPORTED_MEDIA_TYPE');
     try{body=await readJson(request);}catch{return error(400,'REQUEST_DENIED');}
    }
    const key=check?'check':exactBody(body,first?'first':'second');
    if(!key)return error(400,'CONFIRMATION_DENIED');
    const atWrite=now();
    if(!timestamp(atWrite)||atWrite<startedAt||atWrite>startedAt+30||
      atWrite>=principal.expires_at)
      return error(401,'IDENTITY_DENIED');
    const fence=[
     principal.s_user_id,principal.auth_version,
     principal.session_id,scope.app_id,scope.environment,atWrite,
     verified.provider,verified.provider_subject,
    ] as const;
    const get=()=>authDb.prepare(selectRequest).bind(
     principal.s_user_id,scope.app_id,scope.environment,...fence,
    ).first<Row>();
    if(check){
     const row=await get();
     return goodRow(row)?status(row):error(404,'NO_REQUEST');
    }
    if(first){
     // SINGLE SQLite INSERT: trigger audits atomically, unique member/app/env
     // ensures even parallel first confirmations share exactly one row.
     const inserted=await authDb.prepare(insertRequest).bind(
      randomId(random),scope.app_id,scope.environment,atWrite,...fence,
     ).first<Row>();
     if(inserted&&!goodRow(inserted))return error(503,'SERVICE_UNAVAILABLE');
     const row=inserted??await get(); // idempotent retry; never duplicate audit
     return goodRow(row)?accepted(row):error(401,'IDENTITY_DENIED');
    }
    // The second confirmation references the first response's opaque ID.
    // UPDATE RETURNING is a CAS oracle unaffected by AFTER UPDATE triggers.
    const changed=await authDb.prepare(confirmRequest).bind(
     atWrite,key,principal.s_user_id,scope.app_id,scope.environment,...fence,
    ).first<Row>();
    if(changed&&!goodRow(changed))return error(503,'SERVICE_UNAVAILABLE');
    if(changed)return accepted(changed);
    const row=await get();
    if(!goodRow(row)||row.request_id!==key)return error(404,'NO_REQUEST');
    return row.status==='pending_processing'?
     accepted(row):error(409,'REQUEST_NOT_CONFIRMED');
   }catch{
    // Do not leak provider/session/account/SQLite/constraint/secret details.
    return error(503,'SERVICE_UNAVAILABLE');
   }
  },
 });
}
