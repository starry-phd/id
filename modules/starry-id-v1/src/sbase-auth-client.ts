/**
 * SBASE-20261028 AI-1 | Starry AuthClient v0 offline-only, privacy-minimized.
 * A client may render a SAFE hint but NEVER establish an authenticated principal.
 * Authentic OIDC, current Session rights, token revocation and deletion are
 * exclusively server-owned. No fetch, credentials, D1, Store or native plugin.
 */
import type {R21CandidateAuthUI} from './round21-candidate-ui-auth-state.ts';
export const STARRY_AUTH_CLIENT_VERSION='0.1.0-candidate' as const;
export const STARRY_AUTH_CLIENT_SCHEMA='starry.auth-client.offline.v1' as const;
export const STARRY_AUTH_CLIENT_LIVE_ENABLED=false as const;
export const STARRY_AUTH_CLIENT_SERVER_AUTHORIZED=false as const;
export type AuthClientPlatform='ios'|'android'|'web';
export type AuthClientEnvironment='development'|'staging';
export type AuthClientScope=Readonly<{
 brand_id:'starry';app_id:string;environment:AuthClientEnvironment;
 platform:AuthClientPlatform;
}>;
export type AuthClientStatus='guest'|'reauth_required'|'session_unverified'|
 'deletion_pending'|'unavailable'|'blocked';
export type AuthClientFailure='OFFLINE_DISABLED'|'SCOPE_OR_INPUT_DENIED'|
 'SCOPES_NOT_CONFIGURED'|'SESSION_REVOKED'|'NO_OFFICIAL_AUTH_PROOF'|
 'NO_SIGNIN_PROVIDER'|'SERVER_REVOKE_REQUIRED'|'DELETION_NOT_GLOBAL'|
 'AUTH_SERVICE_UNAVAILABLE'|'UNTRUSTED_SERVER_RESPONSE';
export type AuthClientResult=Readonly<{
 schema_version:typeof STARRY_AUTH_CLIENT_SCHEMA;
 client_version:typeof STARRY_AUTH_CLIENT_VERSION;
 status:AuthClientStatus;reason:AuthClientFailure|null;
 scope:Readonly<{brand_id:'starry';app_id:string;environment:AuthClientEnvironment;
 platform:AuthClientPlatform}>;
 ui_only:true;private_access_authorized:false;
 authenticated:false;may_grant:false;may_write:false;may_ack_queue:false;
 may_restore:false;global_deletion_confirmed:false;live:false;
}>;
export type AuthClientReadRequest=Readonly<{
 scope:AuthClientScope;requested_scopes:readonly string[];
}>;
/** Service port is implemented by DEV-D and protected by server-side verification.
 * R21 candidate preview is not a signed identity or a portable token.
 */
export type AuthClientCandidateObservation=Readonly<{
 scope:AuthClientScope;observed_scopes:readonly string[];
 candidate_ui:R21CandidateAuthUI;
}>;
export type AuthClientPorts=Readonly<{
 readSessionCandidate:(context:AuthClientReadRequest)=>Promise<unknown>;
 readDeletionCandidate:(context:AuthClientReadRequest)=>Promise<unknown>;
}>;
const ID=/^[a-z0-9][a-z0-9._-]{1,63}$/;
const SCOPE=/^[a-z][a-z0-9:_-]{1,63}$/;
function own(raw:unknown,required:readonly string[]):Record<string,unknown>|null{
 try {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  const keys=Reflect.ownKeys(raw);
  if(keys.length!==required.length||keys.some(k=>typeof k!=='string'||!required.includes(k)))return null;
  const descriptors=Object.getOwnPropertyDescriptors(raw),out:Record<string,unknown>=Object.create(null);
  for(const key of required){
   if(!descriptors[key]?.enumerable||!('value' in descriptors[key]))return null;
   out[key]=descriptors[key].value;
  }
  return out;
 }catch{return null;}
}
function scopeOf(raw:unknown):AuthClientScope|null{
 const s=own(raw,['brand_id','app_id','environment','platform']);
 if(!s||s.brand_id!=='starry'||typeof s.app_id!=='string'||!ID.test(s.app_id)||
 (s.environment!=='development'&&s.environment!=='staging')||
 (s.platform!=='ios'&&s.platform!=='android'&&s.platform!=='web'))return null;
 return Object.freeze({brand_id:'starry',app_id:s.app_id,
  environment:s.environment,platform:s.platform});
}
function scopes(raw:unknown):string[]|null{
 if(!Array.isArray(raw)||raw.length>16||
  !raw.every(v=>typeof v==='string'&&SCOPE.test(v))||
  new Set(raw).size!==raw.length)return null;
 return [...raw];
}
const match=(a:AuthClientScope,b:AuthClientScope)=>
 a.brand_id===b.brand_id&&a.app_id===b.app_id&&
 a.environment===b.environment&&a.platform===b.platform;
const flags={
 ui_only:true as const,private_access_authorized:false as const,
 authenticated:false as const,may_grant:false as const,may_write:false as const,
 may_ack_queue:false as const,may_restore:false as const,
 global_deletion_confirmed:false as const,live:false as const
};
function result(scope:AuthClientScope,status:AuthClientStatus,reason:AuthClientFailure|null):
 AuthClientResult{
 return Object.freeze({schema_version:STARRY_AUTH_CLIENT_SCHEMA,
  client_version:STARRY_AUTH_CLIENT_VERSION,status,reason,
  scope:Object.freeze({...scope}),...flags});
}
const UIFIELDS=['schema_version','screen','state','reason_code',
 'ui_only','candidate_only','personal_data_included','authenticated',
 'global_deletion_confirmed','may_grant','may_ack_queue','may_publish',
 'may_restore','live'] as const;
function safeObservation(raw:unknown,expected:AuthClientScope,
 allowed:readonly string[],requested:readonly string[],
 screen:'HOME'|'DELETE_ACCOUNT'):R21CandidateAuthUI|null{
 const p=own(raw,['scope','observed_scopes','candidate_ui']);
 const actual=scopeOf(p?.scope),seen=scopes(p?.observed_scopes);
 const ui=own(p?.candidate_ui,UIFIELDS);
 if(!actual||!match(actual,expected)||!seen||
  seen.some(s=>!allowed.includes(s))||
  requested.some(s=>!seen.includes(s))||!ui||
  ui.schema_version!=='starry.candidate-ui.auth-state.v0-offline'||
  ui.screen!==screen||ui.ui_only!==true||ui.candidate_only!==true||
  ui.personal_data_included!==false||ui.authenticated!==false||
  ui.global_deletion_confirmed!==false||ui.may_grant!==false||
  ui.may_ack_queue!==false||ui.may_publish!==false||
  ui.may_restore!==false||ui.live!==false||
  !['guest','reauth_required','auth_unverified','deletion_pending','access_blocked'].includes(String(ui.state))||
  typeof ui.reason_code!=='string')return null;
 return ui as unknown as R21CandidateAuthUI;
}
export function createOfflineStarryAuthClient(deps:Readonly<{
 enabled?:boolean;serverOwnedScope:AuthClientScope;
 candidateAllowedScopes:readonly string[];ports:AuthClientPorts;
}>) {
 const ownedScope=scopeOf(deps.serverOwnedScope),allowed=scopes(deps.candidateAllowedScopes);
 if(!ownedScope||!allowed||typeof deps.ports?.readSessionCandidate!=='function'||
 typeof deps.ports?.readDeletionCandidate!=='function')
  throw Error('AUTH_CLIENT_CONFIGURATION_DENIED');
 const enabled=deps.enabled===true;
 const parse=(request:unknown):AuthClientReadRequest|null=>{
  const r=own(request,['scope','requested_scopes']);
  const s=scopeOf(r?.scope),ss=scopes(r?.requested_scopes);
  if(!s||!match(s,ownedScope)||!ss||ss.some(v=>!allowed.includes(v)))return null;
  return Object.freeze({scope:ownedScope,requested_scopes:Object.freeze(ss)});
 };
 const deny=(request:unknown):AuthClientResult|AuthClientReadRequest=>{
  if(!enabled)return result(ownedScope,'blocked','OFFLINE_DISABLED');
  const v=parse(request);
  return v??result(ownedScope,'blocked','SCOPE_OR_INPUT_DENIED');
 };
 const blocked=(r:AuthClientReadRequest|AuthClientResult):r is AuthClientResult =>
  'status' in r;
 return Object.freeze({
  version:STARRY_AUTH_CLIENT_VERSION,
  /** May be used as a public placeholder; never reads a private service. */
  guest(request:unknown):AuthClientResult{
   const r=deny(request);
   return blocked(r)?r:result(ownedScope,'guest',null);
  },
  /** This is a UI hint, NOT a logged-in result nor an access token. */
  async getSession(request:unknown):Promise<AuthClientResult>{
   const r=deny(request);
   if(blocked(r))return r;
   try{
    const observed=safeObservation(await deps.ports.readSessionCandidate(r),
     ownedScope,allowed,r.requested_scopes,'HOME');
    if(!observed)return result(ownedScope,'blocked','UNTRUSTED_SERVER_RESPONSE');
    if(observed.state==='reauth_required')
     return result(ownedScope,'reauth_required','SESSION_REVOKED');
    if(observed.state==='auth_unverified')
     return result(ownedScope,'session_unverified','NO_OFFICIAL_AUTH_PROOF');
    if(observed.state==='guest')return result(ownedScope,'guest',null);
    return result(ownedScope,'blocked','NO_OFFICIAL_AUTH_PROOF');
   }catch{return result(ownedScope,'unavailable','AUTH_SERVICE_UNAVAILABLE');}
  },
  /** Real OIDC PKCE + native secure storage requires a distinct approved adapter. */
  beginSignIn(request:unknown):AuthClientResult{
   const r=deny(request);
   return blocked(r)?r:result(ownedScope,'blocked','NO_SIGNIN_PROVIDER');
  },
  /** This cannot revoke a server Session. Show reauth until real revoke is verified. */
  signOut(request:unknown):AuthClientResult{
   const r=deny(request);
   return blocked(r)?r:result(ownedScope,'reauth_required','SERVER_REVOKE_REQUIRED');
  },
  /** Never convert committed Auth-local deletion into global deletion proof. */
  async getDeletionStatus(request:unknown):Promise<AuthClientResult>{
   const r=deny(request);
   if(blocked(r))return r;
   try{
    const observed=safeObservation(await deps.ports.readDeletionCandidate(r),
     ownedScope,allowed,r.requested_scopes,'DELETE_ACCOUNT');
    if(!observed)return result(ownedScope,'blocked','UNTRUSTED_SERVER_RESPONSE');
    if(observed.state==='deletion_pending')
     return result(ownedScope,'deletion_pending','DELETION_NOT_GLOBAL');
    return result(ownedScope,'blocked','NO_OFFICIAL_AUTH_PROOF');
   }catch{return result(ownedScope,'unavailable','AUTH_SERVICE_UNAVAILABLE');}
  }
 });
}
