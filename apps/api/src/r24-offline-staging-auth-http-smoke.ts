/**
 * AI-4 R24 / G08 controlled staging HTTP composition proof.
 *
 * NOT registered in apps/api/src/index.ts. No Worker route, Cloudflare D1,
 * Store, Queue or provider key is created. This is a private offline harness
 * consuming AI-1's REAL R23 HMAC + prepared-D1-read request boundary.
 * The deliberately synthetic .invalid origin can NEVER be a public service.
 */
import {isTrustedPrincipal} from '../../../modules/starry-id-v1/src/index.ts';
import type {TrustedPrincipal,TrustedScope} from '../../../modules/starry-id-v1/src/index.ts';
import {R23_HTTP_AUTH_CONTRACT} from '../../../modules/starry-id-v1/src/r23-signed-session-d1-request-boundary.ts';

export const R24_G08_LIVE_ROUTE_ENABLED=false as const;
export const R24_G08_PRODUCTION_ENABLED=false as const;
export const R24_G08_STAGING_DEPLOY_AUTHORIZED=false as const;
export const R24_G08_ROUTE='/__r24_offline_only/session-verification' as const;
export const R24_G08_CONTRACT='starry.g08.offline-http-smoke.v0' as const;
const RESPONSE_HEADERS=Object.freeze({
 'cache-control':'no-store, private',
 'x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer',
 'content-security-policy':"default-src 'none'",
 'vary':'authorization',
 'x-frame-options':'DENY'
});
type BoundaryPort=Readonly<{
 contract:typeof R23_HTTP_AUTH_CONTRACT;
 authenticate:(request:unknown,serverNow:unknown)=>Promise<TrustedPrincipal|null>;
}>;
export type R24ProbeConfig=Readonly<{
 enabledForOfflineHarness:boolean;
 trustedScope:TrustedScope;
 syntheticOrigin:string;
 serverNow:()=>number;
 boundary:BoundaryPort;
}>;
const response=(status:number,code?:string):Response=>{
 const headers=new Headers(RESPONSE_HEADERS);
 if(status===204)return new Response(null,{status,headers});
 headers.set('content-type','application/json; charset=utf-8');
 return new Response(JSON.stringify({error:{code:code??'CANDIDATE_AUTH_NOT_VERIFIED'}}),
  {status,headers});
};
function validateOrigin(raw:string):string{
 const u=new URL(raw);
 if(u.protocol!=='https:'||!u.hostname.endsWith('.invalid')||
  u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/'||
  u.origin+'/'!==u.href)throw Error('R24_SYNTHETIC_ORIGIN_REQUIRED');
 return u.origin;
}
/**
 * The response proves only a local signed Session + member snapshot read.
 * A 204 does NOT authorize product routes or demonstrate Cloudflare staging.
 * The production Worker entrypoint never imports this module.
 */
export function createR24OfflineStagingSessionProbe(config:R24ProbeConfig){
 if(!config||config.enabledForOfflineHarness!==true||
  !config.trustedScope||config.trustedScope.brand_id!=='starry'||
  config.trustedScope.app_id!=='starry-id'||
  !['development','staging'].includes(config.trustedScope.environment)||
  typeof config.serverNow!=='function'||
  !config.boundary||config.boundary.contract!==R23_HTTP_AUTH_CONTRACT||
  typeof config.boundary.authenticate!=='function')
  throw Error('R24_OFFLINE_BOUNDARY_REQUIRED');
 const origin=validateOrigin(config.syntheticOrigin);
 const scope=Object.freeze({...config.trustedScope});
 return Object.freeze({
  contract:R24_G08_CONTRACT,live:false as const,publishable:false as const,
  may_grant_rights:false as const,may_ack_queue:false as const,
  may_read_real_d1:false as const,may_deploy:false as const,
  async handle(input:unknown):Promise<Response>{
   if(!(input instanceof Request))return response(404,'NOT_FOUND');
   try{
    const u=new URL(input.url);
    if(u.origin!==origin||u.pathname!==R24_G08_ROUTE||u.search||u.hash)
     return response(404,'NOT_FOUND');
    if(input.method!=='GET')return response(405,'METHOD_NOT_ALLOWED');
    if(input.headers.has('cookie')||input.headers.has('proxy-authorization')||
     input.headers.has('x-forwarded-authorization'))
     return response(401);
    const now=config.serverNow();
    if(!Number.isSafeInteger(now)||now<0)return response(503,'OFFLINE_CLOCK_UNAVAILABLE');
    // Never serialize an opaque, sealed identity; AI-1 requires fresh SQL
    // verification for every request, including authorization revocation.
    const principal=await config.boundary.authenticate(input,now);
    if(!isTrustedPrincipal(principal)||principal.brand_id!==scope.brand_id||
     principal.app_id!==scope.app_id||principal.environment!==scope.environment||
     principal.expires_at<=now||principal.checked_at!==now)
     return response(401);
    return response(204);
   }catch{return response(503,'OFFLINE_BACKEND_UNAVAILABLE');}
  }
 });
}
