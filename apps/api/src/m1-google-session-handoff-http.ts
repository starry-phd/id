/**
 * AI-0/AI-4 M1 app Session handoff HTTP boundary.
 *
 * SOURCE-ONLY: this handler is NOT registered by apps/api/src/index.ts.
 * Google returns only a short-lived one-time code to a pinned app return URI
 * fragment; the native app exchanges it by POST and receives a short-lived
 * bearer once. The bearer is never placed in a URL, cookie, redirect or log.
 */
export const M1_SESSION_HANDOFF_HTTP_LIVE_ENABLED=false as const;
export const M1_SESSION_HANDOFF_EXCHANGE_PATH='/v1/starry-id/sessions/exchange' as const;
const CALLBACK_PATH='/v1/starry-id/oauth/google/callback';
const CODE=/^[A-Za-z0-9_-]{43}$/;
const BEARER=/^v1\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{43}$/;
type HandoffIssued=Readonly<{
 status:'handoff_issued';handoff_code:string;expires_at:number;
}>;
type RedeemedSession=Readonly<{
 status:'issued';bearer:string;s_user_id:string;expires_at:number;
}>;
type Config=Readonly<{
 enabled?:boolean;
 expectedOrigin:string;
 redirectUri:string;
 /** Owner-verified HTTPS Universal Link; exact server configuration, never callback input. */
 appReturnUri:string;
 completeGoogleLoginForApp:(input:unknown)=>Promise<HandoffIssued|null>;
 redeemSessionHandoff:(input:unknown)=>Promise<RedeemedSession|null>;
}>;
const baseHeaders=()=>new Headers({
 'cache-control':'no-store',
 'pragma':'no-cache',
 'content-type':'application/json; charset=utf-8',
 'x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer',
 'cross-origin-resource-policy':'same-origin',
});
function denied(status:number,code:string,allow?:string):Response{
 const headers=baseHeaders();if(allow)headers.set('allow',allow);
 return new Response(JSON.stringify({error:{code}}),{status,headers});
}
function redirect(target:URL):Response{
 const headers=new Headers({
  location:target.toString(),
  'cache-control':'no-store',
  pragma:'no-cache',
  'referrer-policy':'no-referrer',
  'x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-frame-options':'DENY',
 });
 return new Response(null,{status:303,headers});
}
function trustedUrl(raw:string,kind:'origin'|'callback'|'app'):URL{
 let value:URL;
 try{value=new URL(raw);}catch{throw Error('M1_HANDOFF_URL_DENIED');}
 if(value.protocol!=='https:'||value.username||value.password||
   value.search||value.hash)
  throw Error('M1_HANDOFF_URL_DENIED');
 if(kind==='origin'){
  if(value.pathname!=='/'||(raw!==value.origin&&raw!==value.origin+'/'))
   throw Error('M1_HANDOFF_URL_DENIED');
  return value;
 }
 if(value.href!==raw)throw Error('M1_HANDOFF_URL_DENIED');
 if(kind==='callback'&&value.pathname!==CALLBACK_PATH)
  throw Error('M1_HANDOFF_URL_DENIED');
 if(kind==='app'&&value.pathname==='/')
  throw Error('M1_HANDOFF_URL_DENIED');
 return value;
}
function forbiddenCredentialHeaders(request:Request):boolean{
 return ['authorization','proxy-authorization','x-forwarded-authorization',
  'x-forwarded-user','x-forwarded-host','forwarded'].some(name=>request.headers.has(name));
}
async function boundedBody(request:Request):Promise<Uint8Array|null>{
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d{1,4}$/.test(declared)||Number(declared)>1024))return null;
 if(!request.body)return null;
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>1024){await reader.cancel();return null;}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
 return result;
}
function parseHandoffBody(raw:Uint8Array):string|null{
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  const match=/^\s*\{\s*"handoff_code"\s*:\s*"([A-Za-z0-9_-]{43})"\s*\}\s*$/.exec(text);
  return match&&CODE.test(match[1])?match[1]:null;
 }catch{return null;}
}
export function createM1GoogleSessionHandoffHttp(config:Config){
 if(!config||typeof config.completeGoogleLoginForApp!=='function'||
   typeof config.redeemSessionHandoff!=='function'||
   typeof config.enabled!=='undefined'&&typeof config.enabled!=='boolean')
  throw Error('M1_HANDOFF_CONFIGURATION_DENIED');
 const origin=trustedUrl(config.expectedOrigin,'origin');
 const callback=trustedUrl(config.redirectUri,'callback');
 const appReturn=trustedUrl(config.appReturnUri,'app');
 if(callback.origin!==origin.origin)
  throw Error('M1_HANDOFF_URL_DENIED');
 const enabled=config.enabled===true;
 async function handleOAuthCallback(request:Request):Promise<Response>{
  if(!enabled)return denied(503,'FEATURE_DISABLED');
  if(!(request instanceof Request))return denied(400,'CALLBACK_DENIED');
  if(request.method!=='GET')return denied(405,'METHOD_NOT_ALLOWED','GET');
  if(request.body!==null||forbiddenCredentialHeaders(request))
   return denied(400,'CALLBACK_DENIED');
  let url:URL;
  try{url=new URL(request.url);}catch{return denied(400,'CALLBACK_DENIED');}
  if(url.origin!==origin.origin||url.pathname!==callback.pathname||
    (request.headers.has('host')&&request.headers.get('host')!==url.host))
   return denied(404,'NOT_FOUND');
  const allowed=new Set(['code','state','scope','authuser','prompt','hd','iss',
   'error','error_description','error_uri']);
  const seen=new Set<string>();
  for(const [key,value] of url.searchParams){
   if(!allowed.has(key)||seen.has(key)||value.length>2048)
    return denied(400,'CALLBACK_DENIED');
   seen.add(key);
  }
  const oauthError=url.searchParams.get('error');
  const callbackIssuer=url.searchParams.get('iss');
  if(callbackIssuer!==null&&callbackIssuer!=='https://accounts.google.com')
   return denied(400,'CALLBACK_DENIED');
  if(oauthError!==null){
   // Google echoes the original OAuth state on user denial/error too.
   // This is a FAILURE-only redirect, never an Auth success/state consume.
   // Validate the syntax without trusting/echoing state or provider details.
   const errorState=url.searchParams.get('state');
   if(!oauthError||url.searchParams.has('code')||
     (errorState!==null&&!/^[A-Za-z0-9_-]{32,256}$/.test(errorState)))
    return denied(400,'CALLBACK_DENIED');
   const target=new URL(appReturn.toString());
   target.hash='error=oauth_failed';
   return redirect(target);
  }
  const code=url.searchParams.get('code');
  const state=url.searchParams.get('state');
  if(!code||code.length>2048||!/^[\x21-\x7e]+$/.test(code)||
    !state||!/^[A-Za-z0-9_-]{32,256}$/.test(state))
   return denied(400,'CALLBACK_DENIED');
  try{
   const issued=await config.completeGoogleLoginForApp({code,state});
   if(!issued||issued.status!=='handoff_issued'||!CODE.test(issued.handoff_code)||
     !Number.isSafeInteger(issued.expires_at))
    return denied(401,'OAUTH_CALLBACK_DENIED');
   const target=new URL(appReturn.toString());
   target.hash='handoff='+encodeURIComponent(issued.handoff_code);
   return redirect(target);
  }catch{return denied(503,'SERVICE_UNAVAILABLE');}
 }
 async function handleSessionExchange(request:Request):Promise<Response>{
  if(!enabled)return denied(503,'FEATURE_DISABLED');
  if(!(request instanceof Request))return denied(400,'HANDOFF_DENIED');
  if(request.method!=='POST')return denied(405,'METHOD_NOT_ALLOWED','POST');
  if(forbiddenCredentialHeaders(request)||request.headers.has('cookie'))
   return denied(400,'HANDOFF_DENIED');
  const requestOrigin=request.headers.get('origin');
  if(requestOrigin!==null&&requestOrigin!==appReturn.origin)
   return denied(403,'APP_ORIGIN_DENIED');
  let url:URL;
  try{url=new URL(request.url);}catch{return denied(400,'HANDOFF_DENIED');}
  if(url.origin!==origin.origin||url.pathname!==M1_SESSION_HANDOFF_EXCHANGE_PATH||
    url.search||url.hash||
    (request.headers.has('host')&&request.headers.get('host')!==url.host))
   return denied(404,'NOT_FOUND');
  if(!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(
    request.headers.get('content-type')??''))
   return denied(415,'UNSUPPORTED_MEDIA_TYPE');
  let raw:Uint8Array|null;
  try{raw=await boundedBody(request);}catch{return denied(400,'HANDOFF_DENIED');}
  if(!raw)return denied(400,'HANDOFF_DENIED');
  const code=parseHandoffBody(raw);
  if(!code)return denied(400,'HANDOFF_DENIED');
  try{
   const session=await config.redeemSessionHandoff(code);
   if(!session||session.status!=='issued'||!BEARER.test(session.bearer)||
     !Number.isSafeInteger(session.expires_at))
    return denied(401,'HANDOFF_INVALID');
   // Do not disclose the member id, provider subject, refresh digest or key id.
   return new Response(JSON.stringify({
    access_token:session.bearer,token_type:'Bearer',expires_at:session.expires_at,
   }),{status:200,headers:baseHeaders()});
  }catch{return denied(503,'SERVICE_UNAVAILABLE');}
 }
 return Object.freeze({
  contract:'starry.ai0.m1.one-time-session-handoff-http.v1' as const,
  live_enabled:M1_SESSION_HANDOFF_HTTP_LIVE_ENABLED,
  local_only:true as const,
  public_worker_route_registered:false as const,
  handleOAuthCallback,
  handleSessionExchange,
 });
}
