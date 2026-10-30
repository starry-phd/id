/**
 * AI-4 M2 — local-only, strictly typed ACCOUNT-DELETION REQUEST client.
 * This is NOT physical erasure, a login provider, or a public SDK export.
 * Never persist/refresh a session. Auth supplies a NEW volatile bearer per call.
 * No app wiring to a live API until AI-0 accepts a real Auth/Worker integration.
 */
export const M2_DELETION_CLIENT_LIVE=false as const;
export const M2_DELETION_CLIENT_CONTRACT='starry.ai4.m2.deletion-request-mobile.v1' as const;
export const M2_REQUEST_PATH='/v1/starry-id/members/me/deletion-requests' as const;
export const M2_CONFIRM_PATH='/v1/starry-id/members/me/deletion-requests/confirm' as const;
export const M2_STATUS_PATH='/v1/starry-id/members/me/deletion-requests/status' as const;
export const M2_FIRST_CONFIRMATION='REQUEST_MY_ACCOUNT_DELETION' as const;
export const M2_SECOND_CONFIRMATION='CONFIRM_MY_ACCOUNT_DELETION' as const;

export type M2DeletionStatus='awaiting_second_confirmation'|'pending_processing';
export type M2DeletionReceipt=Readonly<{
 request_id:string;
 status:M2DeletionStatus;
 first_confirmed_at:number;
 second_confirmed_at:number|null;
 physical_erasure_completed:false;
 execution_authorized:false;
}>;
export type M2DeletionClientErrorCode=
 'DISABLED'|'SESSION_REQUIRED'|'UNAUTHORIZED'|'UNAVAILABLE'|
 'INVALID_RESPONSE'|'NO_REQUEST'|'CONFLICT';
export class M2DeletionClientError extends Error{
 readonly code:M2DeletionClientErrorCode;
 constructor(code:M2DeletionClientErrorCode){
  super(code);
  this.name='M2DeletionClientError';
  this.code=code;
 }
}
export type M2DeletionPort=Readonly<{
 getStatus():Promise<M2DeletionReceipt|null>;
 requestDeletion():Promise<M2DeletionReceipt>;
 confirmDeletion(requestId:string):Promise<M2DeletionReceipt>;
}>;
export type M2DeletionClientConfig=Readonly<{
 enabled?:boolean;
 appId:'starry-id';
 environment:'development'|'staging';
 baseUrl:string;
 getSessionBearer:()=>Promise<string|null>;
 fetchImpl?:typeof fetch;
}>;
const idPattern=/^m2del-[a-f0-9]{48}$/;
const bearerPattern=/^v1\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{43}$/;
const maxBytes=4096;
function fault(code:M2DeletionClientErrorCode):never{
 throw new M2DeletionClientError(code);
}
function isTimestamp(n:unknown):n is number{
 return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
}
function parseReceipt(raw:unknown):M2DeletionReceipt{
 if(raw===null||typeof raw!=='object'||Array.isArray(raw))return fault('INVALID_RESPONSE');
 const v=raw as Record<string,unknown>;
 if(Object.keys(v).sort().join('|')!==[
  'request_id','status','first_confirmed_at','second_confirmed_at',
  'physical_erasure_completed','execution_authorized',
 ].sort().join('|')||
  typeof v.request_id!=='string'||!idPattern.test(v.request_id)||
  !isTimestamp(v.first_confirmed_at)||
  v.physical_erasure_completed!==false||v.execution_authorized!==false||
  !((v.status==='awaiting_second_confirmation'&&v.second_confirmed_at===null)||
    (v.status==='pending_processing'&&isTimestamp(v.second_confirmed_at)&&
     v.second_confirmed_at>=v.first_confirmed_at)))
  return fault('INVALID_RESPONSE');
 return Object.freeze(v) as M2DeletionReceipt;
}
async function boundedJson(response:Response):Promise<unknown>{
 const len=response.headers.get('content-length');
 if(len!==null&&(!/^\d{1,8}$/.test(len)||Number(len)>maxBytes))return fault('INVALID_RESPONSE');
 if(!response.body)return fault('INVALID_RESPONSE');
 let reader:ReadableStreamDefaultReader<Uint8Array>|null=null;
 const chunks:Uint8Array[]=[];let total=0;
 try{
  reader=response.body.getReader();
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>maxBytes){
    await reader.cancel();
    return fault('INVALID_RESPONSE');
   }
   chunks.push(value);
  }
 }catch(e){
  if(e instanceof M2DeletionClientError)throw e;
  return fault('INVALID_RESPONSE');
 }finally{reader?.releaseLock();}
 const buffer=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)) as unknown;}
 catch{return fault('INVALID_RESPONSE');}
}
function hasNoStore(response:Response):boolean{
 return (response.headers.get('cache-control')??'').toLowerCase()
   .split(',').some(v=>v.trim()==='no-store');
}
function validJsonHeader(response:Response):boolean{
 return /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i
   .test(response.headers.get('content-type')??'');
}
export function createM2DeletionRequestClient(config:M2DeletionClientConfig):M2DeletionPort{
 let url:URL;
 try{url=new URL(config.baseUrl);}catch{return fault('DISABLED');}
 const localDev=config.environment==='development'&&url.protocol==='http:'&&
   ['localhost','127.0.0.1'].includes(url.hostname);
 if(config.appId!=='starry-id'||
   !['development','staging'].includes(config.environment)||
   !(url.protocol==='https:'||localDev)||
   url.username||url.password||url.pathname!=='/'||url.search||url.hash||
   url.href!==url.origin+'/'||
   typeof config.getSessionBearer!=='function')return fault('DISABLED');
 const enabled=config.enabled===true;
 const transport=config.fetchImpl??fetch;
 const getBearer=config.getSessionBearer;
 async function call(path:string,method:'GET'|'POST',body?:unknown,missingOk=false):Promise<M2DeletionReceipt|null>{
  if(!enabled)return fault('DISABLED');
  let token:string|null;
  try{token=await getBearer();}catch{return fault('SESSION_REQUIRED');}
  if(!token||!bearerPattern.test(token))return fault('SESSION_REQUIRED');
  const endpoint=new URL(path,url).href;
  let response:Response;
  try{
   response=await transport(endpoint,{
    method,credentials:'omit',redirect:'error',cache:'no-store',
    headers:{
     accept:'application/json',
     authorization:'Bearer '+token,
     ...(method==='POST'?{'content-type':'application/json'}:{}),
    },
    ...(method==='POST'?{body:JSON.stringify(body)}:{}),
   });
  }catch{return fault('UNAVAILABLE');}
  // Network/proxy responses are untrusted, even in test-only composition.
  if(response.redirected||(response.url!==''&&response.url!==endpoint))
   return fault('INVALID_RESPONSE');
  if(response.status===401||response.status===403)return fault('UNAUTHORIZED');
  if(response.status===404){
   // 404 is NOT sufficient to imply absence; a proxy/HTML 404 may be a
   // routing outage. Only AI-1's exact non-cacheable NO_REQUEST DTO counts.
   if(!validJsonHeader(response)||!hasNoStore(response))return fault('INVALID_RESPONSE');
   let data:unknown;
   try{data=await boundedJson(response);}
   catch{return fault('INVALID_RESPONSE');}
   if(!data||typeof data!=='object'||Array.isArray(data))return fault('INVALID_RESPONSE');
   const outer=data as Record<string,unknown>;
   if(Object.keys(outer).length!==1||!('error' in outer)||
     !outer.error||typeof outer.error!=='object'||Array.isArray(outer.error))
     return fault('INVALID_RESPONSE');
   const inner=outer.error as Record<string,unknown>;
   if(Object.keys(inner).length!==1||inner.code!=='NO_REQUEST')
     return fault('INVALID_RESPONSE');
   if(missingOk)return null;
   return fault('NO_REQUEST');
  }
  if(response.status===409)return fault('CONFLICT');
  if(response.status!==(method==='GET'?200:202))return fault('UNAVAILABLE');
  if(!validJsonHeader(response)||!hasNoStore(response))return fault('INVALID_RESPONSE');
  let parsed:unknown;
  try{parsed=await boundedJson(response);}
  catch(e){if(e instanceof M2DeletionClientError)throw e;return fault('INVALID_RESPONSE');}
  return parseReceipt(parsed);
 }
 return Object.freeze({
  async getStatus(){return call(M2_STATUS_PATH,'GET',undefined,true);},
  async requestDeletion(){
   const value=await call(M2_REQUEST_PATH,'POST',{confirmation:M2_FIRST_CONFIRMATION});
   if(!value)return fault('INVALID_RESPONSE');
   return value;
  },
  async confirmDeletion(requestId:string){
   if(!idPattern.test(requestId))return fault('NO_REQUEST');
   const value=await call(M2_CONFIRM_PATH,'POST',{
    confirmation:M2_SECOND_CONFIRMATION,request_id:requestId,
   });
   if(!value||value.request_id!==requestId)return fault('INVALID_RESPONSE');
   return value;
  },
 });
}
