/**
 * M1 Starry-only STAGING HTTP ROUTE BOUNDARY - SOURCE-ONLY, DEFAULT OFF.
 *
 * This is the final transport dispatch seam for the ONE existing signed
 * Access -> Google OIDC -> original Session -> member/CAS/logout flow.
 * It must NOT be imported into apps/api/src/index.ts or added to Wrangler's
 * entrypoint until Starry-only remote D1, Access, Google, Secrets, App Links,
 * independent review, cost/rollback and release/staging gates are proven.
 *
 * A green local dispatch test NEVER authorizes real cloud routing/deploy.
 */
import type {createM1StagingSecureAuthComposition} from
 './m1-staging-secure-auth-composition.ts';

export const M1_STAGING_HTTP_ROUTE_LIVE=false as const;
export const M1_STAGING_HTTP_ROUTE_CONTRACT=
 'starry.ai0.m1.staging-http-boundary.v1' as const;

type SingleAuth=Pick<Awaited<ReturnType<
 typeof createM1StagingSecureAuthComposition>>,
 'contract'|'source_only'|'public_worker_route_registered'|
 'live_enabled'|'handleOAuthStart'|'handleOAuthCallback'|
 'handleSessionExchange'|'handleMember'>;

export type M1StagingHttpBoundaryConfig=Readonly<{
 enabled?:boolean;
 appId:'starry-id';
 environment:'staging';
 /** Exact verified HTTPS Staging Worker origin; not a request header. */
 expectedOrigin:string;
 /** Exact verified HTTPS app Universal Link, never supplied by the browser. */
 appReturnUri:string;
 /** Only #322's one approved Auth composition, not arbitrary DIY ports. */
 auth?:SingleAuth;
}>;

const START='/v1/starry-id/oauth/google/start';
const CALLBACK='/v1/starry-id/oauth/google/callback';
const EXCHANGE='/v1/starry-id/sessions/exchange';
const SELF='/v1/starry-id/members/me';
const LOGOUT='/v1/starry-id/sessions/logout';
const FIRST='/v1/starry-id/members/me/deletion-requests';
const CONFIRM='/v1/starry-id/members/me/deletion-requests/confirm';
const STATUS='/v1/starry-id/members/me/deletion-requests/status';
const allowed=new Map<string,ReadonlySet<string>>([
 [START,new Set(['GET'])],[CALLBACK,new Set(['GET'])],
 [EXCHANGE,new Set(['POST'])],[SELF,new Set(['GET','PATCH'])],
 [LOGOUT,new Set(['POST'])],[FIRST,new Set(['POST'])],
 [CONFIRM,new Set(['POST'])],[STATUS,new Set(['GET'])],
]);
const headers=()=>new Headers({
 'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store','pragma':'no-cache',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
 'cross-origin-resource-policy':'same-origin',
 'content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
});
function rejected(status:number,code:string,methods?:string):Response{
 const h=headers();
 if(methods)h.set('allow',methods);
 return new Response(JSON.stringify({error:{code}}),{status,headers:h});
}
function trusted(raw:string,originOnly:boolean):URL{
 let v:URL;
 try{v=new URL(raw);}catch{throw Error('M1_STAGING_HTTP_CONFIGURATION_DENIED');}
 if(v.protocol!=='https:'||v.username||v.password||v.port||
    v.search||v.hash||
    (originOnly&&(v.pathname!=='/'||v.href!==v.origin+'/'))||
    (!originOnly&&(v.pathname==='/'||v.href!==raw)))
  throw Error('M1_STAGING_HTTP_CONFIGURATION_DENIED');
 return v;
}
function validRedirect(response:Response,path:string,appUri:URL):boolean{
 if(response.status!==303)return true;
 if(path!==START&&path!==CALLBACK)return false;
 const location=response.headers.get('location');
 if(!location||location.length>4096)return false;
 let target:URL;
 try{target=new URL(location);}catch{return false;}
 if(target.protocol!=='https:'||target.username||target.password||
    target.port||target.href!==location)return false;
 if(path===START){
  return target.origin==='https://accounts.google.com'&&
   target.pathname==='/o/oauth2/v2/auth'&&!target.hash&&
   target.searchParams.get('code_challenge_method')==='S256'&&
   target.searchParams.has('state');
 }
 if(target.origin!==appUri.origin||target.pathname!==appUri.pathname||
    target.search)return false;
 const fragment=target.hash.slice(1);
 return /^handoff=[A-Za-z0-9_-]{43}$/.test(fragment)||
  fragment==='error=oauth_failed';
}
/**
 * This router's opt-in is only a source test seam. It is NEVER sufficient
 * deployment consent and is not exported from the published Worker entry.
 */
export function createM1StagingHttpBoundary(config:M1StagingHttpBoundaryConfig){
 if(!config||config.appId!=='starry-id'||config.environment!=='staging'||
    (config.enabled!==undefined&&typeof config.enabled!=='boolean'))
  throw Error('M1_STAGING_HTTP_CONFIGURATION_DENIED');
 const origin=trusted(config.expectedOrigin,true);
 const app=trusted(config.appReturnUri,false);
 if(app.origin===origin.origin)
  throw Error('M1_STAGING_HTTP_CONFIGURATION_DENIED');
 const enabled=config.enabled===true;
 const auth=config.auth;
 if(enabled&&(!auth||
    auth.contract!=='starry.ai0.m1.staging-access-keyring-single-auth.v1'||
    auth.source_only!==true||
    auth.public_worker_route_registered!==false||
    auth.live_enabled!==false||
    typeof auth.handleOAuthStart!=='function'||
    typeof auth.handleOAuthCallback!=='function'||
    typeof auth.handleSessionExchange!=='function'||
    typeof auth.handleMember!=='function'))
  throw Error('M1_STAGING_HTTP_AUTH_BOUNDARY_DENIED');
 return Object.freeze({
  contract:M1_STAGING_HTTP_ROUTE_CONTRACT,
  source_only:true as const,
  live_enabled:M1_STAGING_HTTP_ROUTE_LIVE,
  public_worker_route_registered:false as const,
  async handle(request:unknown):Promise<Response>{
   if(!enabled||!auth)return rejected(503,'FEATURE_DISABLED');
   if(!(request instanceof Request))return rejected(400,'REQUEST_DENIED');
   let url:URL;try{url=new URL(request.url);}catch{return rejected(404,'NOT_FOUND');}
   if(url.origin!==origin.origin||url.username||url.password||
      (request.headers.has('host')&&request.headers.get('host')!==url.host)||
      (request.headers.has('x-forwarded-host'))||
      (request.headers.has('forwarded')))
    return rejected(404,'NOT_FOUND');
   const methods=allowed.get(url.pathname);
   if(!methods)return rejected(404,'NOT_FOUND');
   // Malformed or credential-bearing URLs fail before method probing.
   if(url.hash||url.pathname!==CALLBACK&&url.search)
    return rejected(400,'REQUEST_DENIED');
   if(!methods.has(request.method))
    return rejected(405,'METHOD_NOT_ALLOWED',[...methods].join(', '));
   try{
    const response=url.pathname===START?await auth.handleOAuthStart(request):
     url.pathname===CALLBACK?await auth.handleOAuthCallback(request):
     url.pathname===EXCHANGE?await auth.handleSessionExchange(request):
     await auth.handleMember(request);
    if(!(response instanceof Response)||response.redirected||
       !(response.headers.get('cache-control')??'')
        .toLowerCase().split(',').some(v=>v.trim()==='no-store')||
       response.status>=300&&response.status<400&&response.status!==303||
       !validRedirect(response,url.pathname,app))
      return rejected(503,'SERVICE_UNAVAILABLE');
    return response;
   }catch{
    return rejected(503,'SERVICE_UNAVAILABLE');
   }
  },
 });
}
