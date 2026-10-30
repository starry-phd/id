/**
 * AI-4 M1: local-only HTTP composition of AI-1's authoritative M1 session core.
 *
 * NOT imported by apps/api/src/index.ts or published by Wrangler.
 * No OAuth endpoints, D1 binding, secrets or simulated member authority.
 * A real readSelf port MUST be injected from the AI-1 core in reviewed staging.
 */
import type {createM1LocalAuthSessionCore} from '../../../modules/starry-id-v1/src/m1-local-auth-session-core.ts';

type M1Core = Pick<ReturnType<typeof createM1LocalAuthSessionCore>, 'readSelf'>;
export const M1_HTTP_LIVE_ENABLED = false as const;
export const M1_HTTP_CONTRACT = 'starry.ai4.m1.local-self-http.v1' as const;
export const M1_SELF_PATH = '/v1/starry-id/members/me' as const;
export type M1HttpConfig = Readonly<{
  enabled?: boolean;
  scope: Readonly<{brand_id: 'starry'; app_id: string; environment: 'development' | 'staging'}>;
  expectedOrigin: string;
  core: M1Core;
}>;
const deny=(status:number,code:string,allow=false):Response=>new Response(JSON.stringify({error:{code}}),{
  status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','pragma':'no-cache','x-content-type-options':'nosniff',
    ...(allow?{allow:'GET'}:{}),
  },
});
function exactSelfDto(value:unknown):boolean {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const d=value as Record<string,unknown>;
  if(Object.keys(d).sort().join('|')!==
     ['s_user_id','display_name','directory_opt_in','display_name_public','profile_revision'].sort().join('|'))
    return false;
  return typeof d.s_user_id==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(d.s_user_id)&&
    (d.display_name===null||(typeof d.display_name==='string'&&
     d.display_name.length>0&&d.display_name.length<=80))&&
    typeof d.directory_opt_in==='boolean'&&
    typeof d.display_name_public==='boolean'&&
    typeof d.profile_revision==='number'&&Number.isSafeInteger(d.profile_revision)&&d.profile_revision>0&&
    d.profile_revision<Number.MAX_SAFE_INTEGER;
}
/** Not a route registrar; callers need explicit opt-in and a trusted core port. */
export function createM1LocalSelfHttp(config:M1HttpConfig){
  if(config.scope.brand_id!=='starry'||config.scope.app_id!=='starry-id'||
     !['development','staging'].includes(config.scope.environment)||
     !config.core||typeof config.core.readSelf!=='function')
    throw Error('M1_HTTP_SCOPE_DENIED');
  const origin=new URL(config.expectedOrigin);
  if(origin.protocol!=='https:'||origin.username||origin.password||
     origin.pathname!=='/'||origin.search||origin.hash||
     origin.toString()!==origin.origin+'/')
    throw Error('M1_HTTP_ORIGIN_DENIED');
  const enabled=config.enabled===true;
  const environment=config.scope.environment;
  const trustedOrigin=origin.origin;
  return Object.freeze({
    contract:M1_HTTP_CONTRACT,
    local_only:true as const,
    live_enabled:M1_HTTP_LIVE_ENABLED,
    public_worker_route_registered:false as const,
    async handle(request:Request):Promise<Response>{
      // Both enabled and staging are necessary. This is STILL a local-only
      // source artifact; neither condition authorizes a Cloudflare deployment.
      if(!enabled||environment!=='staging')return deny(503,'FEATURE_DISABLED');
      if(!(request instanceof Request))return deny(400,'REQUEST_DENIED');
      let url:URL;
      try{url=new URL(request.url);}catch{return deny(404,'NOT_FOUND');}
      if(url.origin!==trustedOrigin||url.pathname!==M1_SELF_PATH||
         url.username||url.password||
         (request.headers.has('host')&&request.headers.get('host')!==url.host)||
         (request.headers.has('origin')&&request.headers.get('origin')!==trustedOrigin))
        return deny(404,'NOT_FOUND');
      if(request.method!=='GET')return deny(405,'METHOD_NOT_ALLOWED',true);
      if(url.search||url.hash)return deny(400,'REQUEST_DENIED');
      if(request.headers.has('cookie')||request.headers.has('proxy-authorization')||
        request.headers.has('x-forwarded-authorization')||
        request.headers.has('x-original-authorization')||
        request.headers.has('x-forwarded-user'))
        return deny(401,'IDENTITY_DENIED');
      const bearer=request.headers.get('authorization');
      // Not a verifier! Merely reject obvious malformed credentials before
      // delegating to AI-1's existing HMAC + session/current-member fences.
      if(!bearer||!/^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(bearer))
        return deny(401,'IDENTITY_DENIED');
      try {
        const response=await config.core.readSelf(request);
        // Even an incorrectly wired port cannot make a non-5-field object public.
        if(response.status===200){
          const body:unknown=await response.json();
          if(!exactSelfDto(body))return deny(503,'SERVICE_UNAVAILABLE');
          return new Response(JSON.stringify(body),{status:200,headers:{
            'content-type':'application/json; charset=utf-8',
            'cache-control':'no-store','pragma':'no-cache','x-content-type-options':'nosniff',
          }});
        }
        if(response.status===401)return deny(401,'IDENTITY_DENIED');
        if(response.status===403)return deny(403,'APP_SCOPE_DENIED');
        if(response.status===404)return deny(404,'NOT_FOUND');
        return deny(503,'SERVICE_UNAVAILABLE');
      }catch{
        return deny(503,'SERVICE_UNAVAILABLE');
      }
    },
  });
}
