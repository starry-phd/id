/**
 * Starry M1 Google login START over HTTP, SOURCE-ONLY and default OFF.
 *
 * The browser cannot call the existing server-only beginGoogleLogin directly.
 * A trusted, server-side admission decision must be TRUE before generating an
 * OAuth attempt or touching D1. This is NOT an Access implementation or public
 * Worker registration; admission verification and deploy gates remain external.
 */
export const M1_GOOGLE_START_HTTP_LIVE=false as const;
export const M1_GOOGLE_START_PATH='/v1/starry-id/oauth/google/start' as const;
const GOOGLE_CALLBACK='/v1/starry-id/oauth/google/callback';
type Config=Readonly<{
 enabled?:boolean;
 environment:'staging';
 expectedOrigin:string;
 callbackUri:string;
 googleClientId:string;
 /** Must be verified by trusted infrastructure, not user email or a query token. */
 admitTestRequest:(request:Request)=>Promise<boolean>;
 beginGoogleLogin:()=>Promise<string|null>;
}>;
const noStore=()=>new Headers({
 'cache-control':'no-store','pragma':'no-cache',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
 'cross-origin-resource-policy':'same-origin',
 'content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
 'x-frame-options':'DENY',
});
function denied(status:number,code:string,allow?:string):Response{
 const headers=noStore();headers.set('content-type','application/json; charset=utf-8');
 if(allow)headers.set('allow',allow);
 return new Response(JSON.stringify({error:{code}}),{status,headers});
}
function trustedOrigin(raw:string):URL{
 let url:URL;try{url=new URL(raw);}catch{throw Error('M1_START_CONFIGURATION_DENIED');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||
   url.search||url.hash||url.href!==url.origin+'/')
  throw Error('M1_START_CONFIGURATION_DENIED');
 return url;
}
function trustedGoogleUrl(value:unknown,clientId:string,callbackUri:string):URL|null{
 if(typeof value!=='string'||value.length>4096)return null;
 let url:URL;try{url=new URL(value);}catch{return null;}
 if(url.href!==value||url.origin!=='https://accounts.google.com'||
   url.pathname!=='/o/oauth2/v2/auth'||url.username||url.password||
   url.hash||url.port)return null;
 const expected=new Set(['response_type','client_id','redirect_uri','scope',
  'state','nonce','code_challenge','code_challenge_method','access_type']);
 const seen=new Set<string>();
 for(const [key] of url.searchParams){
  if(!expected.has(key)||seen.has(key))return null;
  seen.add(key);
 }
 if(seen.size!==expected.size||
   url.searchParams.get('response_type')!=='code'||
   url.searchParams.get('client_id')!==clientId||
   url.searchParams.get('redirect_uri')!==callbackUri||
   url.searchParams.get('scope')!=='openid'||
   url.searchParams.get('code_challenge_method')!=='S256'||
   url.searchParams.get('access_type')!=='online'||
   !/^[A-Za-z0-9_-]{32,256}$/.test(url.searchParams.get('state')??'')||
   !/^[A-Za-z0-9_-]{16,256}$/.test(url.searchParams.get('nonce')??'')||
   !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge')??''))
  return null;
 return url;
}
export function createM1GoogleStartHttp(config:Config){
 if(!config||config.environment!=='staging'||
   (config.enabled!==undefined&&typeof config.enabled!=='boolean')||
   typeof config.admitTestRequest!=='function'||
   typeof config.beginGoogleLogin!=='function'||
   typeof config.googleClientId!=='string'||
   !/^[A-Za-z0-9._-]{5,180}$/.test(config.googleClientId))
  throw Error('M1_START_CONFIGURATION_DENIED');
 const origin=trustedOrigin(config.expectedOrigin);
 let callback:URL;
 try{callback=new URL(config.callbackUri);}catch{throw Error('M1_START_CONFIGURATION_DENIED');}
 if(callback.href!==config.callbackUri||callback.origin!==origin.origin||
    callback.pathname!==GOOGLE_CALLBACK||callback.search||callback.hash||
    callback.username||callback.password)
  throw Error('M1_START_CONFIGURATION_DENIED');
 const enabled=config.enabled===true;
 const admit=config.admitTestRequest;
 const begin=config.beginGoogleLogin;
 const clientId=config.googleClientId;
 const callbackUri=callback.href;
 return Object.freeze({
  contract:'starry.ai0.m1.google-start-admitted-http.v1' as const,
  source_only:true as const,
  live_enabled:M1_GOOGLE_START_HTTP_LIVE,
  public_worker_route_registered:false as const,
  async handle(request:Request):Promise<Response>{
   if(!enabled)return denied(503,'FEATURE_DISABLED');
   if(!(request instanceof Request))return denied(400,'START_DENIED');
   if(request.method!=='GET')return denied(405,'METHOD_NOT_ALLOWED','GET');
   let url:URL;try{url=new URL(request.url);}catch{return denied(400,'START_DENIED');}
   if(url.origin!==origin.origin||url.pathname!==M1_GOOGLE_START_PATH||
     url.search||url.hash||(request.headers.has('host')&&
       request.headers.get('host')!==url.host))
    return denied(404,'NOT_FOUND');
   // A deep-link/browser navigation is allowed, a cross-site embed is not.
   const site=request.headers.get('sec-fetch-site');
   if(site!==null&&site!=='none'&&site!=='same-origin')
    return denied(403,'START_DENIED');
   if((request.headers.has('origin')&&request.headers.get('origin')!==origin.origin)||
     ['authorization','proxy-authorization','x-forwarded-authorization',
      'x-forwarded-host','forwarded'].some(h=>request.headers.has(h)))
    return denied(403,'START_DENIED');
   // The callback verifies trusted Access/alternative admission BEFORE any
   // attempt creation. A deny, exception or non-true value must fail closed.
   let admitted:boolean;
   try{admitted=await admit(request);}catch{return denied(503,'SERVICE_UNAVAILABLE');}
   if(admitted!==true)return denied(403,'TESTER_ACCESS_DENIED');
   let authorize:unknown;
   try{authorize=await begin();}catch{return denied(503,'SERVICE_UNAVAILABLE');}
   const target=trustedGoogleUrl(authorize,clientId,callbackUri);
   if(!target)return denied(503,'SERVICE_UNAVAILABLE');
   const headers=noStore();headers.set('location',target.href);
   return new Response(null,{status:303,headers});
  },
 });
}
