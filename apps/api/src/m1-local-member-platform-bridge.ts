/**
 * AI-4: local-only and default-OFF transport router for AI-1-owned ports.
 * Does NOT issue/verify sessions, own D1, register the public Worker or
 * authorize staging. Both injected ports MUST be AI-1's reviewed handlers.
 */
import type {createM1LocalSelfHttp} from './m1-local-self-http.ts';
import type {createM2LocalSelfMutationHandler} from
  '../../../modules/starry-id-v1/src/m2-local-self-mutation.ts';
import type {createM2LocalDeletionRequestHandler} from
  '../../../modules/starry-id-v1/src/m2-local-deletion-request.ts';

type ReadPort=Pick<ReturnType<typeof createM1LocalSelfHttp>,'handle'>;
type MutationPort=Pick<ReturnType<typeof createM2LocalSelfMutationHandler>,'handle'>;
type DeletionPort=Pick<ReturnType<typeof createM2LocalDeletionRequestHandler>,'handle'>;
type Scope=Readonly<{
  brand_id:'starry';app_id:'starry-id';
  environment:'development'|'staging';
}>;
export type M1LocalMemberPlatformConfig=Readonly<{
  enabled?:boolean;
  scope:Scope;
  expectedOrigin:string;
  readPort:ReadPort;
  mutationPort:MutationPort;
  /** Optional AI-1-owned, 2-step REQUEST receipt port. Never physical erasure. */
  deletionPort?:DeletionPort;
}>;
export const M1_LOCAL_MEMBER_BRIDGE_LIVE=false as const;
export const M1_LOCAL_MEMBER_BRIDGE_CONTRACT='starry.ai4.m1.local-member-bridge.v1' as const;
const SELF='/v1/starry-id/members/me';
const LOGOUT='/v1/starry-id/sessions/logout';
const DELETE_FIRST='/v1/starry-id/members/me/deletion-requests';
const DELETE_SECOND='/v1/starry-id/members/me/deletion-requests/confirm';
const DELETE_STATUS='/v1/starry-id/members/me/deletion-requests/status';
const fields=['s_user_id','display_name','directory_opt_in','display_name_public','profile_revision'];
const bearer=/^Bearer v1\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{43}$/;
const headers=()=>new Headers({
 'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store','pragma':'no-cache',
 'x-content-type-options':'nosniff',
});
function denied(status:number,code:string,allow?:string):Response{
 const h=headers();if(allow)h.set('allow',allow);
 return new Response(JSON.stringify({error:{code}}),{status,headers:h});
}
function selfDto(value:unknown):value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).sort().join('|')===fields.slice().sort().join('|')&&
   typeof v.s_user_id==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v.s_user_id)&&
   (v.display_name===null||(typeof v.display_name==='string'&&
     v.display_name.length>0&&v.display_name.length<=80))&&
   typeof v.directory_opt_in==='boolean'&&
   typeof v.display_name_public==='boolean'&&
   typeof v.profile_revision==='number'&&
   Number.isSafeInteger(v.profile_revision)&&v.profile_revision>=1&&
   v.profile_revision<Number.MAX_SAFE_INTEGER;
}
async function safeProfile(response:Response):Promise<Response>{
 if(!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(
   response.headers.get('content-type')??''))
   return denied(503,'SERVICE_UNAVAILABLE');
 const cache=(response.headers.get('cache-control')??'').toLowerCase()
   .split(',').map(v=>v.trim());
 if(!cache.includes('no-store'))return denied(503,'SERVICE_UNAVAILABLE');
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d{1,8}$/.test(declared)||Number(declared)>4096))
   return denied(503,'SERVICE_UNAVAILABLE');
 if(!response.body)return denied(503,'SERVICE_UNAVAILABLE');
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  reader=response.body.getReader();
  const chunks:Uint8Array[]=[];let length=0;
  while(true){
   const {done,value}=await reader.read();if(done)break;
   length+=value.byteLength;
   if(length>4096){await reader.cancel();return denied(503,'SERVICE_UNAVAILABLE');}
   chunks.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!selfDto(parsed))return denied(503,'SERVICE_UNAVAILABLE');
  return new Response(JSON.stringify(parsed),{status:200,headers:headers()});
 }catch{return denied(503,'SERVICE_UNAVAILABLE');}
 finally{reader?.releaseLock();}
}
type MemberRoute='read'|'write'|'logout';
type DeletionRoute='delete-first'|'delete-second'|'delete-status';
const isDeleteRoute=(route:MemberRoute|DeletionRoute):route is DeletionRoute=>
 route==='delete-first'||route==='delete-second'||route==='delete-status';
const receiptKeys=[
 'request_id','status','first_confirmed_at','second_confirmed_at',
 'physical_erasure_completed','execution_authorized',
].sort().join('|');
const receiptId=/^m2del-[a-f0-9]{48}$/;
const safeClock=(v:unknown):v is number=>
 typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function validReceipt(raw:unknown,route:DeletionRoute):boolean{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const v=raw as Record<string,unknown>;
 if(Object.keys(v).sort().join('|')!==receiptKeys||
    typeof v.request_id!=='string'||!receiptId.test(v.request_id)||
    !safeClock(v.first_confirmed_at)||v.physical_erasure_completed!==false||
    v.execution_authorized!==false)return false;
 if(v.status==='awaiting_second_confirmation')
  return route!=='delete-second'&&v.second_confirmed_at===null;
 return v.status==='pending_processing'&&
  safeClock(v.second_confirmed_at)&&v.second_confirmed_at>=v.first_confirmed_at;
}
async function boundedJson(response:Response):Promise<unknown>{
 const ct=response.headers.get('content-type')??'';
 if(!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(ct))
  throw Error('M2_DELETE_UNTRUSTED_CONTENT_TYPE');
 const noStore=(response.headers.get('cache-control')??'')
  .toLowerCase().split(',').some(v=>v.trim()==='no-store');
 if(!noStore)throw Error('M2_DELETE_CACHEABLE');
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d{1,8}$/.test(declared)||Number(declared)>4096))
  throw Error('M2_DELETE_OVERSIZE');
 if(!response.body)throw Error('M2_DELETE_EMPTY_BODY');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;
   if(total>4096){
    await reader.cancel();
    throw Error('M2_DELETE_OVERSIZE');
   }
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
}
async function normalizeDeletion(response:Response,route:DeletionRoute):Promise<Response>{
 if(response.status===401)return denied(401,'IDENTITY_DENIED');
 if(response.status===403)return denied(403,'APP_SCOPE_DENIED');
 if(response.status===409)return denied(409,'REQUEST_NOT_CONFIRMED');
 if(response.status===415)return denied(415,'UNSUPPORTED_MEDIA_TYPE');
 if(response.status===400)return denied(400,'CONFIRMATION_DENIED');
 const expected=route==='delete-status'?200:202;
 if(response.status!==expected&&response.status!==404)
  return denied(503,'SERVICE_UNAVAILABLE');
 try{
  const value=await boundedJson(response);
  if(response.status===404){
   // SDK #293 treats ONLY exact non-cacheable NO_REQUEST as no application.
   // A router/HTML/NOT_FOUND 404 must NEVER trigger a first POST retry.
   if(!value||typeof value!=='object'||Array.isArray(value))
    return denied(503,'SERVICE_UNAVAILABLE');
   const v=value as Record<string,unknown>;
   if(Object.keys(v).join('|')!=='error'||!v.error||
     typeof v.error!=='object'||Array.isArray(v.error))
    return denied(503,'SERVICE_UNAVAILABLE');
   const e=v.error as Record<string,unknown>;
   return Object.keys(e).join('|')==='code'&&e.code==='NO_REQUEST'?
    denied(404,'NO_REQUEST'):denied(503,'SERVICE_UNAVAILABLE');
  }
  if(!validReceipt(value,route))return denied(503,'SERVICE_UNAVAILABLE');
  return new Response(JSON.stringify(value),{status:expected,headers:headers()});
 }catch{return denied(503,'SERVICE_UNAVAILABLE');}
}
function normalized(response:Response,route:MemberRoute|DeletionRoute):Promise<Response>|Response{
 if(!(response instanceof Response)||response.redirected)
  return denied(503,'SERVICE_UNAVAILABLE');
 if(isDeleteRoute(route))return normalizeDeletion(response,route);
 if(response.status===401)return denied(401,'IDENTITY_DENIED');
 if(response.status===403)return denied(403,'APP_SCOPE_DENIED');
 if(response.status===404)return denied(404,'NOT_FOUND');
 if(route==='write'&&response.status===409)
  return denied(409,'PROFILE_VERSION_CONFLICT');
 if(route==='write'&&response.status===428)
  return denied(428,'PRECONDITION_REQUIRED');
 if(route==='write'&&response.status===415)
  return denied(415,'UNSUPPORTED_MEDIA_TYPE');
 if(route==='logout'&&response.status===204&&response.body===null)
  return new Response(null,{status:204,headers:headers()});
 if(route==='logout'||response.status!==200)return denied(503,'SERVICE_UNAVAILABLE');
 return safeProfile(response);
}
export function createM1LocalMemberPlatformBridge(config:M1LocalMemberPlatformConfig){
 const scope=config.scope&&Object.freeze({...config.scope});
 if(scope?.brand_id!=='starry'||scope.app_id!=='starry-id'||
   !['development','staging'].includes(scope.environment)||
   !config.readPort||typeof config.readPort.handle!=='function'||
   !config.mutationPort||typeof config.mutationPort.handle!=='function'||
   (config.deletionPort!==undefined&&typeof config.deletionPort.handle!=='function'))
  throw Error('M1_MEMBER_BRIDGE_SCOPE_DENIED');
 let origin:URL;
 try{origin=new URL(config.expectedOrigin);}catch{throw Error('M1_MEMBER_BRIDGE_ORIGIN_DENIED');}
 if(origin.protocol!=='https:'||origin.username||origin.password||
   origin.pathname!=='/'||origin.search||origin.hash||
   origin.href!==origin.origin+'/')
  throw Error('M1_MEMBER_BRIDGE_ORIGIN_DENIED');
 const enabled=config.enabled===true;
 const expected=origin.origin;
 const read=config.readPort.handle.bind(config.readPort);
 const mutate=config.mutationPort.handle.bind(config.mutationPort);
 const deletion=config.deletionPort?.handle.bind(config.deletionPort);
 return Object.freeze({
  contract:M1_LOCAL_MEMBER_BRIDGE_CONTRACT,
  local_only:true as const,
  live_enabled:M1_LOCAL_MEMBER_BRIDGE_LIVE,
  public_worker_route_registered:false as const,
  async handle(request:unknown):Promise<Response>{
   if(!enabled||scope.environment!=='staging')
    return denied(503,'FEATURE_DISABLED');
   if(!(request instanceof Request))return denied(400,'REQUEST_DENIED');
   let url:URL;
   try{url=new URL(request.url);}catch{return denied(404,'NOT_FOUND');}
   if(url.origin!==expected||url.username||url.password||
     ![SELF,LOGOUT,DELETE_FIRST,DELETE_SECOND,DELETE_STATUS].includes(url.pathname)||
     (request.headers.has('host')&&request.headers.get('host')!==url.host)||
     (request.headers.has('origin')&&request.headers.get('origin')!==expected))
    return denied(404,'NOT_FOUND');
   if(url.search||url.hash)return denied(400,'REQUEST_DENIED');
   const route:MemberRoute|DeletionRoute=url.pathname===DELETE_STATUS?
    'delete-status':url.pathname===DELETE_FIRST?'delete-first':
    url.pathname===DELETE_SECOND?'delete-second':
    url.pathname===LOGOUT?'logout':
    request.method==='GET'?'read':'write';
   if(url.pathname===LOGOUT&&request.method!=='POST')
    return denied(405,'METHOD_NOT_ALLOWED','POST');
   if(url.pathname===SELF&&!['GET','PATCH'].includes(request.method))
    return denied(405,'METHOD_NOT_ALLOWED','GET, PATCH');
   if(route==='delete-status'&&request.method!=='GET')
    return denied(405,'METHOD_NOT_ALLOWED','GET');
   if((route==='delete-first'||route==='delete-second')&&request.method!=='POST')
    return denied(405,'METHOD_NOT_ALLOWED','POST');
   // A local M1-only bridge can never make deletion absence look like
   // NO_REQUEST. Missing trusted AI-1 deletion port fails closed as 503.
   if(isDeleteRoute(route)&&!deletion)return denied(503,'FEATURE_DISABLED');
   if(request.headers.has('cookie')||request.headers.has('proxy-authorization')||
     request.headers.has('x-forwarded-authorization')||
     request.headers.has('x-original-authorization')||
     request.headers.has('x-forwarded-user')||
     request.headers.has('x-forwarded-host'))
    return denied(401,'IDENTITY_DENIED');
   if(!bearer.test(request.headers.get('authorization')??''))
    return denied(401,'IDENTITY_DENIED');
   try{
    const response=await (isDeleteRoute(route)?deletion!(request):
     route==='read'?read(request):mutate(request));
    return await normalized(response,route);
   }catch{return denied(503,'SERVICE_UNAVAILABLE');}
  },
 });
}
