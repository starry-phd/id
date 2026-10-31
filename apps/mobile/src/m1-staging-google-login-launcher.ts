/**
 * Source-only Starry ID mobile Google browser login launcher.
 *
 * It starts the one original Auth Session flow via the pinned staging HTTPS
 * START endpoint, then accepts only the pinned HTTPS Universal Link handoff.
 * A platform browser (e.g. Expo WebBrowser) must be explicitly injected by
 * reviewed app code. No native UI, domain association, or public route is
 * enabled here; no bearer is returned to a screen or persisted.
 */
import {parseM1SessionHandoffReturnUrl} from
 '../../../packages/sdk/src/m1-session-handoff-client.ts';
export const M1_MOBILE_BROWSER_LOGIN_LIVE=false as const;
export const M1_MOBILE_BROWSER_LOGIN_START_PATH=
 '/v1/starry-id/oauth/google/start' as const;
export type M1LoginBrowserResult=Readonly<{
 type:'success'|'cancel'|'dismiss'|'error';url?:string;
}>;
type Config=Readonly<{
 enabled?:boolean;
 appId:'starry-id';
 environment:'staging';
 baseUrl:string;
 appReturnUri:string;
 /** Trusted native browser adapter only; never an HTTP request parameter. */
 openLoginBrowser?:(startUri:string,returnUri:string)=>Promise<M1LoginBrowserResult>;
 acceptReturnUrl:(uri:string)=>Promise<Readonly<{expires_at:number}>>;
 clearSession:()=>void;
}>;
function trustedBase(raw:string):URL{
 let url:URL;try{url=new URL(raw);}catch{throw Error('M1_LOGIN_CONFIG_DENIED');}
 if(url.protocol!=='https:'||url.username||url.password||
   url.pathname!=='/'||url.search||url.hash)
  throw Error('M1_LOGIN_CONFIG_DENIED');
 return url;
}
function trustedReturn(raw:string):URL{
 let url:URL;try{url=new URL(raw);}catch{throw Error('M1_LOGIN_CONFIG_DENIED');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||
   url.hash||url.pathname==='/'||url.href!==raw)
  throw Error('M1_LOGIN_CONFIG_DENIED');
 return url;
}
export function createM1MobileBrowserLoginLauncher(config:Config){
 if(!config||config.appId!=='starry-id'||config.environment!=='staging'||
   (config.enabled!==undefined&&typeof config.enabled!=='boolean')||
   (config.openLoginBrowser!==undefined&&typeof config.openLoginBrowser!=='function')||
   typeof config.acceptReturnUrl!=='function'||typeof config.clearSession!=='function')
  throw Error('M1_LOGIN_CONFIG_DENIED');
 const origin=trustedBase(config.baseUrl);
 const returnUri=trustedReturn(config.appReturnUri).href;
 const startUri=new URL(M1_MOBILE_BROWSER_LOGIN_START_PATH,origin).href;
 const enabled=config.enabled===true&&typeof config.openLoginBrowser==='function';
 const openBrowser=config.openLoginBrowser;
 const accept=config.acceptReturnUrl;
 const clear=config.clearSession;
 let epoch=0;
 let pending=false;
 return Object.freeze({
  contract:'starry.ai0.m1.mobile-browser-google-login.v1' as const,
  source_only:true as const,
  live_enabled:M1_MOBILE_BROWSER_LOGIN_LIVE,
  start_uri:startUri,
  /** Explicit cancellation, account switch or successful server logout. */
  cancelPendingLogin():void{
   epoch++;
   pending=false;
   clear();
  },
  async startGoogleLogin():Promise<
    Readonly<{status:'cancelled'}|{status:'authenticated';expires_at:number}>>{
   if(!enabled||!openBrowser)throw Error('M1_LOGIN_DISABLED');
   if(pending)throw Error('M1_LOGIN_ALREADY_PENDING');
   const own=++epoch;pending=true;
   // Never let a stale member A remain authorized while member B signs in.
   // This is a local credential clear, not a claim of server-side logout.
   try{clear();}catch{
    pending=false;throw Error('M1_LOGIN_CLEAR_FAILED');
   }
   try{
    let response:M1LoginBrowserResult;
    try{response=await openBrowser(startUri,returnUri);}
    catch{throw Error('M1_LOGIN_BROWSER_UNAVAILABLE');}
    if(own!==epoch)throw Error('M1_LOGIN_SUPERSEDED');
    let type:string;let url:unknown;
    try{
     if(!response||typeof response!=='object')throw Error('invalid');
     type=response.type;url=response.url;
    }catch{throw Error('M1_LOGIN_RETURN_DENIED');}
    if(type==='cancel'||type==='dismiss')
     return Object.freeze({status:'cancelled' as const});
    if(type!=='success'||typeof url!=='string')
     throw Error('M1_LOGIN_RETURN_DENIED');
    // Refuse malicious browser redirects BEFORE consuming a one-time code.
    try{parseM1SessionHandoffReturnUrl(url,returnUri);}
    catch{throw Error('M1_LOGIN_RETURN_DENIED');}
    let session:Readonly<{expires_at:number}>;
    try{session=await accept(url);}
    catch{
     if(own!==epoch)throw Error('M1_LOGIN_SUPERSEDED');
     throw Error('M1_LOGIN_EXCHANGE_FAILED');
    }
    if(own!==epoch)throw Error('M1_LOGIN_SUPERSEDED');
    if(!session||!Number.isSafeInteger(session.expires_at))
     throw Error('M1_LOGIN_EXCHANGE_FAILED');
    return Object.freeze({status:'authenticated' as const,expires_at:session.expires_at});
   }finally{
    if(own===epoch)pending=false;
   }
  },
 });
}
