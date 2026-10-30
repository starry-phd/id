/**
 * AI-4: local-only and default-OFF transport router for AI-1-owned ports.
 * Does NOT issue/verify sessions, own D1, register the public Worker or
 * authorize staging. Both injected ports MUST be AI-1's reviewed handlers.
 */
import type {createM1LocalSelfHttp} from './m1-local-self-http.ts';
import type {createM2LocalSelfMutationHandler} from
  '../../../modules/starry-id-v1/src/m2-local-self-mutation.ts';

type ReadPort=Pick<ReturnType<typeof createM1LocalSelfHttp>,'handle'>;
type MutationPort=Pick<ReturnType<typeof createM2LocalSelfMutationHandler>,'handle'>;
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
}>;
export const M1_LOCAL_MEMBER_BRIDGE_LIVE=false as const;
export const M1_LOCAL_MEMBER_BRIDGE_CONTRACT='starry.ai4.m1.local-member-bridge.v1' as const;
const SELF='/v1/starry-id/members/me';
const LOGOUT='/v1/starry-id/sessions/logout';
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
function normalized(response:Response,route:'read'|'write'|'logout'):Promise<Response>|Response{
 if(!(response instanceof Response)||response.redirected)
  return denied(503,'SERVICE_UNAVAILABLE');
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
   !config.mutationPort||typeof config.mutationPort.handle!=='function')
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
     (url.pathname!==SELF&&url.pathname!==LOGOUT)||
     (request.headers.has('host')&&request.headers.get('host')!==url.host)||
     (request.headers.has('origin')&&request.headers.get('origin')!==expected))
    return denied(404,'NOT_FOUND');
   if(url.search||url.hash)return denied(400,'REQUEST_DENIED');
   const route=url.pathname===LOGOUT?'logout':
     request.method==='GET'?'read':'write';
   if(url.pathname===LOGOUT&&request.method!=='POST')
    return denied(405,'METHOD_NOT_ALLOWED','POST');
   if(url.pathname===SELF&&!['GET','PATCH'].includes(request.method))
    return denied(405,'METHOD_NOT_ALLOWED','GET, PATCH');
   if(request.headers.has('cookie')||request.headers.has('proxy-authorization')||
     request.headers.has('x-forwarded-authorization')||
     request.headers.has('x-original-authorization')||
     request.headers.has('x-forwarded-user')||
     request.headers.has('x-forwarded-host'))
    return denied(401,'IDENTITY_DENIED');
   if(!bearer.test(request.headers.get('authorization')??''))
    return denied(401,'IDENTITY_DENIED');
   try{
    const response=await (route==='read'?read(request):mutate(request));
    return await normalized(response,route);
   }catch{return denied(503,'SERVICE_UNAVAILABLE');}
  },
 });
}
