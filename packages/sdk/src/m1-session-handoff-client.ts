/**
 * AI-0/AI-4 M1 native-app Session handoff client.
 *
 * Source-only and opt-in. It accepts only the configured HTTPS Universal Link,
 * exchanges its 60-second opaque fragment code by POST, and keeps the returned
 * signed bearer in this closure's memory only. No SecureStore/AsyncStorage,
 * URL token, cookie, refresh token, logging or public SDK export.
 */
export const M1_SESSION_HANDOFF_CLIENT_LIVE=false as const;
export const M1_SESSION_HANDOFF_CLIENT_CONTRACT='starry.ai0.m1.mobile-session-handoff.v1' as const;
export const M1_SESSION_HANDOFF_EXCHANGE_PATH='/v1/starry-id/sessions/exchange' as const;
const CODE=/^[A-Za-z0-9_-]{43}$/;
const BEARER=/^v1\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{43}$/;
const MAX_RESPONSE_BYTES=1024;
export type M1SessionHandoffConfig=Readonly<{
 enabled?:boolean;
 appId:'starry-id';
 baseUrl:string;
 appReturnUri:string;
 fetchImpl?:typeof fetch;
 /** Unix seconds; injection exists only for deterministic tests. */
 now?:()=>number;
}>;
type SessionResponse=Readonly<{
 access_token:string;token_type:'Bearer';expires_at:number;
}>;
function originUrl(raw:string):URL{
 let url:URL;try{url=new URL(raw);}catch{throw Error('M1_HANDOFF_CONFIG_DENIED');}
 if(url.protocol!=='https:'||url.username||url.password||
   url.pathname!=='/'||url.search||url.hash)
  throw Error('M1_HANDOFF_CONFIG_DENIED');
 return url;
}
function appUrl(raw:string):URL{
 let url:URL;try{url=new URL(raw);}catch{throw Error('M1_HANDOFF_CONFIG_DENIED');}
 if(url.protocol!=='https:'||url.username||url.password||
   url.pathname==='/'||url.search||url.hash||url.href!==raw)
  throw Error('M1_HANDOFF_CONFIG_DENIED');
 return url;
}
/** Parse only the exact pinned Universal Link and one handoff fragment field. */
export function parseM1SessionHandoffReturnUrl(raw:string,expectedAppReturnUri:string):string{
 if(typeof raw!=='string'||raw.length<1||raw.length>2048)
  throw Error('M1_HANDOFF_RETURN_URL_DENIED');
 const expected=appUrl(expectedAppReturnUri);
 let actual:URL;try{actual=new URL(raw);}catch{throw Error('M1_HANDOFF_RETURN_URL_DENIED');}
 if(actual.protocol!=='https:'||actual.username||actual.password||
   actual.origin!==expected.origin||actual.pathname!==expected.pathname||
   actual.search||!actual.hash)
  throw Error('M1_HANDOFF_RETURN_URL_DENIED');
 const params=new URLSearchParams(actual.hash.slice(1));
 const entries=[...params.entries()];
 if(entries.length===1&&entries[0][0]==='error'&&entries[0][1]==='oauth_failed')
  throw Error('M1_HANDOFF_OAUTH_FAILED');
 if(entries.length!==1||entries[0][0]!=='handoff'||!CODE.test(entries[0][1]))
  throw Error('M1_HANDOFF_RETURN_URL_DENIED');
 return entries[0][1];
}
async function boundedJson(response:Response):Promise<unknown>{
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d{1,4}$/.test(declared)||Number(declared)>MAX_RESPONSE_BYTES))
  throw Error('M1_HANDOFF_RESPONSE_INVALID');
 if(!response.body)throw Error('M1_HANDOFF_RESPONSE_INVALID');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw Error('M1_HANDOFF_RESPONSE_INVALID');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
 catch{throw Error('M1_HANDOFF_RESPONSE_INVALID');}
}
function validateResponse(value:unknown,now:number):SessionResponse{
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Error('M1_HANDOFF_RESPONSE_INVALID');
 const x=value as Record<string,unknown>;
 if(Object.keys(x).sort().join('|')!==
   ['access_token','token_type','expires_at'].sort().join('|')||
   typeof x.access_token!=='string'||!BEARER.test(x.access_token)||
   x.token_type!=='Bearer'||typeof x.expires_at!=='number'||
   !Number.isSafeInteger(x.expires_at)||x.expires_at<=now)
  throw Error('M1_HANDOFF_RESPONSE_INVALID');
 return Object.freeze({access_token:x.access_token,token_type:'Bearer',
  expires_at:x.expires_at});
}
export function createM1SessionHandoffClient(config:M1SessionHandoffConfig){
 if(!config||config.appId!=='starry-id'||
   (config.enabled!==undefined&&typeof config.enabled!=='boolean')||
   (config.now!==undefined&&typeof config.now!=='function'))
  throw Error('M1_HANDOFF_CONFIG_DENIED');
 const origin=originUrl(config.baseUrl);
 const appReturn=appUrl(config.appReturnUri);
 const enabled=config.enabled===true;
 const endpoint=new URL(M1_SESSION_HANDOFF_EXCHANGE_PATH,origin).toString();
 const transport=config.fetchImpl??fetch;
 const now=config.now??(()=>Math.floor(Date.now()/1000));
 let current:SessionResponse|null=null;
 async function exchange(code:string):Promise<SessionResponse>{
  if(!enabled)throw Error('M1_HANDOFF_DISABLED');
  if(!CODE.test(code))throw Error('M1_HANDOFF_CODE_DENIED');
  let response:Response;
  try{
   response=await transport(endpoint,{
    method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
    referrerPolicy:'no-referrer',
    headers:{accept:'application/json','content-type':'application/json'},
    body:JSON.stringify({handoff_code:code}),
   });
  }catch{throw Error('M1_HANDOFF_UNAVAILABLE');}
  if(!response||typeof response!=='object'||
    !Number.isInteger(response.status)||response.status<100||response.status>599||
    typeof response.redirected!=='boolean'||typeof response.url!=='string'||
    !response.headers||typeof response.headers.get!=='function'||
    (response.body!==null&&typeof response.body?.getReader!=='function')||
    response.redirected||(response.url!==''&&response.url!==endpoint))
   throw Error('M1_HANDOFF_RESPONSE_INVALID');
  if(response.status===401)throw Error('M1_HANDOFF_INVALID');
  if(response.status!==200)throw Error('M1_HANDOFF_UNAVAILABLE');
  if(!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(
    response.headers.get('content-type')??'')||
    !(response.headers.get('cache-control')??'').toLowerCase()
      .split(',').some(x=>x.trim()==='no-store'))
   throw Error('M1_HANDOFF_RESPONSE_INVALID');
  const session=validateResponse(await boundedJson(response),now());
  return session;
 }
 return Object.freeze({
  contract:M1_SESSION_HANDOFF_CLIENT_CONTRACT,
  source_only:true as const,
  live_enabled:M1_SESSION_HANDOFF_CLIENT_LIVE,
  /** Only the exact configured Universal Link can reach the exchange endpoint. */
  async acceptReturnUrl(raw:string):Promise<Readonly<{expires_at:number}>>{
   if(!enabled)throw Error('M1_HANDOFF_DISABLED');
   const code=parseM1SessionHandoffReturnUrl(raw,appReturn.toString());
   // A new valid login attempt switches the in-memory owner. Clear the old
   // account before network I/O so a failed exchange cannot leave stale A live.
   current=null;
   const session=await exchange(code);
   current=session;
   return Object.freeze({expires_at:session.expires_at});
  },
  /** Auth-owned volatile credential supplier; expired tokens are cleared. */
  async getSessionBearer():Promise<string|null>{
   if(!enabled||!current)return null;
   if(current.expires_at<=now()){current=null;return null;}
   return current.access_token;
  },
  /** Call only after server logout or explicit account-switch/cancel handling. */
  clearSession():void{current=null;},
  sessionExpiresAt():number|null{
   if(!enabled||!current)return null;
   if(current.expires_at<=now()){current=null;return null;}
   return current.expires_at;
  },
 });
}
