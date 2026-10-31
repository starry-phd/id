/**
 * SOURCE-ONLY binding adapter for a future, separately approved Starry M1
 * Staging Worker. Never import into apps/api/src/index.ts or Wrangler.
 *
 * Distinct Starry-only D1, Access app/tester policy, official Google OAuth,
 * Worker Secrets, app associations, cost/rollback and independent review
 * must be established AND independently verified before any public routing.
 * An env toggle is never release authorization.
 */
import {createM1StagingSecureAuthComposition} from
 './m1-staging-secure-auth-composition.ts';
import {createM1StagingHttpBoundary} from './m1-staging-http-boundary.ts';
import {createM1GoogleJwksSource} from
 '../../../modules/starry-id-v1/src/m1-google-jwks-source.ts';

export const M1_STAGING_BOUND_RUNTIME_LIVE=false as const;
export const M1_STAGING_BOUND_RUNTIME_CONTRACT=
 'starry.ai0.m1.source-only-worker-bindings.v1' as const;

type Pair=Readonly<{kid:string;secretB64url:string}>;
type Env=Record<string,unknown>;
const safeText=(v:unknown,max=512):v is string=>
 typeof v==='string'&&v.length>0&&v.length<=max&&
 ![...v].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)&&v===v.trim();
const required=(env:Env,key:string,max=512):string=>{
 const value=env[key];
 if(!safeText(value,max))throw Error('M1_STAGING_BINDINGS_DENIED');
 return value;
};
const optionalPair=(env:Env,kid:string,secret:string):Pair|undefined=>{
 if(env[kid]===undefined&&env[secret]===undefined)return undefined;
 return Object.freeze({kid:required(env,kid,180),
  secretB64url:required(env,secret,43)});
};
const subjects=(value:unknown):readonly string[]=>{
 if(!safeText(value,4096))throw Error('M1_STAGING_BINDINGS_DENIED');
 let result:unknown;
 try{result=JSON.parse(value);}catch{throw Error('M1_STAGING_BINDINGS_DENIED');}
 if(!Array.isArray(result)||result.length<1||result.length>32||
    !result.every(v=>typeof v==='string'&&
      /^[A-Za-z0-9._@:-]{1,256}$/.test(v))||
    new Set(result).size!==result.length)
  throw Error('M1_STAGING_BINDINGS_DENIED');
 return Object.freeze([...result]);
};
const noCredentialUrl=(raw:string,path?:string):string=>{
 let url:URL;
 try{url=new URL(raw);}catch{throw Error('M1_STAGING_BINDINGS_DENIED');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||
    url.hash||url.search||url.href!==raw||
    (path!==undefined&&url.pathname!==path))
  throw Error('M1_STAGING_BINDINGS_DENIED');
 return raw;
};

/**
 * The caller is a future dedicated staging entry, NOT an HTTP request.
 * All secret fields must be real server-injected Worker Secrets, never
 * public vars, bundle constants, browser input or client-side storage.
 *
 * No synthetic admission port, injected clock, arbitrary token endpoint,
 * custom JWKS URL, second Auth database or caller-provided transport.
 */
export async function createM1StagingBoundRuntime(raw:unknown) {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw Error('M1_STAGING_BINDINGS_DENIED');
 const env=raw as Env;
 if(env.STARRY_ENVIRONMENT!=='staging'||env.STARRY_APP_ID!=='starry-id'||
    env.M1_STAGING_SOURCE_ASSEMBLY_ENABLED!=='true')
  throw Error('M1_STAGING_BINDINGS_DENIED');
 const db=env.AUTH_DB;
 if(!db||typeof db!=='object'||
    typeof (db as {prepare?:unknown}).prepare!=='function'||
    typeof (db as {batch?:unknown}).batch!=='function')
  throw Error('M1_STAGING_BINDINGS_DENIED');
 const expectedOrigin=noCredentialUrl(
  required(env,'M1_STAGING_HTTPS_ORIGIN'),
  '/');
 const appReturnUri=noCredentialUrl(
  required(env,'M1_STAGING_APP_RETURN_URI'),
  '/oauth/complete');
 if(new URL(expectedOrigin).origin===new URL(appReturnUri).origin)
  throw Error('M1_STAGING_BINDINGS_DENIED');
 const googleClientId=required(env,'M1_GOOGLE_CLIENT_ID',180);
 const googleClientSecret=required(env,'M1_GOOGLE_CLIENT_SECRET',1024);
 if(!/^[A-Za-z0-9._:-]{5,180}$/.test(googleClientId))
  throw Error('M1_STAGING_BINDINGS_DENIED');
 const allowedGoogleTestSubjects=subjects(env.M1_GOOGLE_TEST_SUBJECTS_JSON);
 const accessTeamDomain=noCredentialUrl(
  required(env,'M1_ACCESS_TEAM_DOMAIN'),
  '/');
 const accessAud=required(env,'M1_ACCESS_APP_AUD',128);
 const allowedAccessSubjects=subjects(env.M1_ACCESS_TEST_SUBJECTS_JSON);
 const keyMaterial=Object.freeze({
  sessionActive:Object.freeze({
   kid:required(env,'M1_SESSION_ACTIVE_KID',180),
   secretB64url:required(env,'M1_SESSION_ACTIVE_SECRET',43)}),
  pkceActive:Object.freeze({
   kid:required(env,'M1_PKCE_ACTIVE_KID',180),
   secretB64url:required(env,'M1_PKCE_ACTIVE_SECRET',43)}),
  sessionPrevious:optionalPair(env,'M1_SESSION_PREVIOUS_KID',
    'M1_SESSION_PREVIOUS_SECRET'),
  pkcePrevious:optionalPair(env,'M1_PKCE_PREVIOUS_KID',
    'M1_PKCE_PREVIOUS_SECRET'),
 });
 const now=()=>Math.floor(Date.now()/1000);
 // Both trust anchors are pinned by their existing verified validators.
 const googleJwksSource=createM1GoogleJwksSource({
  enabled:true,clientId:googleClientId,
  issuer:'https://accounts.google.com',now,
  transport:(url,init)=>fetch(url,init),
 });
 const auth=await createM1StagingSecureAuthComposition({
  enabled:true,
  serverScope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},
  expectedOrigin,
  redirectUri:expectedOrigin.replace(/\/$/,'')+
    '/v1/starry-id/oauth/google/callback',
  appReturnUri,authDb:db as Parameters<
    typeof createM1StagingSecureAuthComposition>[0]['authDb'],
  keyMaterial,
  googleProvider:{provider:'google',
    clientId:googleClientId,issuer:'https://accounts.google.com',jwks:[]},
  googleJwksSource,allowedGoogleTestSubjects,
  cloudflareAccessAdmission:{
   enabled:true,environment:'staging',teamDomain:accessTeamDomain,
   applicationAud:accessAud,allowedSubjects:allowedAccessSubjects,
   now,transport:(url,init)=>fetch(url,init),
  },
  readGoogleClientSecret:async()=>googleClientSecret,
  googleTransport:(url,init)=>fetch(url,init),
  now,
 });
 const route=createM1StagingHttpBoundary({
  enabled:true,appId:'starry-id',environment:'staging',
  expectedOrigin,appReturnUri,auth,
 });
 return Object.freeze({
  contract:M1_STAGING_BOUND_RUNTIME_CONTRACT,
  source_only:true as const,
  live_enabled:M1_STAGING_BOUND_RUNTIME_LIVE,
  public_worker_route_registered:false as const,
  handle:(request:Request)=>route.handle(request),
 });
}
