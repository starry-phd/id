/** R22 AI-1 Echo Starry offline-only new-Auth candidate.
 * Old Web SSO tickets, cookies, localStorage and Google redirects are NOT trusted.
 * Membership schema below is a disposable SQLite test fixture, not migration.
 */
import {createOfflineCandidateAuthUI} from './round21-candidate-ui-auth-state.ts';
import type {StarryDeletionEventScope} from './round15-deletion-source-contract.ts';
import type {D1Database} from './d1-ports.ts';
export const R22_ECHO_LIVE_AUTH_ENABLED=false as const;
export const R22_ECHO_OFFICIAL_MEMBERSHIP_APPROVED=false as const;
export const R22_ECHO_OIDC_APPROVED=false as const;
export const R22_ECHO_CANDIDATE_APP_ID='echostars' as const;
export const R22_ECHO_SCHEMA='starry.echo.auth-candidate.v0-offline' as const;
type State='guest'|'reauth_required'|'auth_unverified'|'deletion_pending'|'access_blocked';
type Membership='not_checked'|'missing'|'unverified'|'suspended';
type Reason='DISABLED'|'INVALID_NEW_SCOPE'|'LEGACY_WEB_NOT_TRUSTED'|'GUEST_PREVIEW'|
 'LOGOUT_PREVIEW_ONLY'|'REAUTH_REQUIRED'|'MEMBERSHIP_MISSING'|
 'MEMBERSHIP_UNVERIFIED'|'MEMBERSHIP_SUSPENDED'|'MEMBERSHIP_DRIFT'|
 'DELETION_PENDING_GLOBAL_PROOF'|'SOURCE_OR_POLICY_UNAVAILABLE';
export type EchoStarryCandidateSession=Readonly<{
 schema_version:typeof R22_ECHO_SCHEMA;app:'echo_starry_candidate';
 state:State;membership:Membership;reason:Reason;
 ui_only:true;authenticated:false;privilege_authorized:false;
 global_deletion_confirmed:false;legacy_identity_accepted:false;
 may_grant:false;may_ack_queue:false;may_publish:false;
 may_restore:false;may_open_paid_access:false;live:false;
}>;
const output=(state:State,reason:Reason,membership:Membership='not_checked'):
 EchoStarryCandidateSession=>Object.freeze({
 schema_version:R22_ECHO_SCHEMA,app:'echo_starry_candidate' as const,
 state,reason,membership,ui_only:true as const,authenticated:false as const,
 privilege_authorized:false as const,global_deletion_confirmed:false as const,
 legacy_identity_accepted:false as const,may_grant:false as const,
 may_ack_queue:false as const,may_publish:false as const,
 may_restore:false as const,may_open_paid_access:false as const,live:false as const
});
export const R22_ECHO_MEMBERSHIP_SQL=
 'SELECT a.app_id,a.environment,a.membership_status,a.member_auth_version,'+
 'm.auth_version AS current_auth_version FROM echo_r22_membership_fixture a '+
 'JOIN starry_sessions s ON s.s_user_id=a.s_user_id '+
 'AND s.app_id=a.app_id AND s.environment=a.environment '+
 'JOIN starry_members m ON m.s_user_id=a.s_user_id '+
 'WHERE s.session_id=? AND a.app_id=? AND a.environment=? LIMIT 1';
type Row=Readonly<{app_id:unknown;environment:unknown;membership_status:unknown;
 member_auth_version:unknown;current_auth_version:unknown}>;
const positive=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=1;
const valid=(r:Row|null,scope:StarryDeletionEventScope)=>
 !!r&&r.app_id===R22_ECHO_CANDIDATE_APP_ID&&r.environment===scope.environment&&
 positive(r.member_auth_version)&&r.current_auth_version===r.member_auth_version&&
 (r.membership_status==='active'||r.membership_status==='suspended');
const same=(a:Row|null,b:Row|null)=>!!a&&!!b&&
 a.app_id===b.app_id&&a.environment===b.environment&&
 a.membership_status===b.membership_status&&
 a.member_auth_version===b.member_auth_version&&
 a.current_auth_version===b.current_auth_version;
function shape(raw:unknown):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw),ks=Reflect.ownKeys(raw);
  if((p!==Object.prototype&&p!==null)||ks.some(k=>typeof k!=='string'))return null;
  const out:Record<string,unknown>=Object.create(null);
  for(const k of ks){
   const d=Object.getOwnPropertyDescriptor(raw,k);
   if(!d?.enumerable||!('value' in d))return null;
   out[k as string]=d.value;
  }
  return out;
 }catch{return null;}
}
export function createOfflineEchoStarryCandidateSession(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionEventScope;db:D1Database;
 lawfulSessionReadApprovedNow:()=>Promise<boolean>;
 lawfulDeletionProcessingApprovedNow:()=>Promise<boolean>;
 lawfulMinimalRetentionApprovedNow:()=>Promise<boolean>;
 readApprovedPolicyRevisionNow:()=>Promise<unknown>;
 readServerNow:()=>number;
}>) {
 const r21=createOfflineCandidateAuthUI({enabled:deps.enabled===true,
  scope:deps.scope,authDb:deps.db,
  lawfulSessionReadApprovedNow:deps.lawfulSessionReadApprovedNow,
  lawfulDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  lawfulMinimalRetentionApprovedNow:deps.lawfulMinimalRetentionApprovedNow,
  readApprovedPolicyRevisionNow:deps.readApprovedPolicyRevisionNow,
  readServerNow:deps.readServerNow});
 const scope=Object.freeze({...deps.scope});
 return Object.freeze({
  async inspect(input:unknown,claim?:unknown):Promise<EchoStarryCandidateSession>{
   if(deps.enabled!==true)return output('access_blocked','DISABLED');
   const x=shape(input),s=shape(x?.scope);
   const keys=x?Reflect.ownKeys(x):[];
   if(!x||!s||Reflect.ownKeys(s).length!==2||
    s.brand_id!=='starry'||s.environment!==scope.environment||
    x.app_id!==R22_ECHO_CANDIDATE_APP_ID||
    x.origin!=='new_starry_id_candidate'||
    keys.some(k=>!['scope','app_id','origin','mode','session_ref'].includes(String(k))))
    return output('access_blocked','LEGACY_WEB_NOT_TRUSTED');
   const mode=x.mode;
   if(!['guest','session','logout','deletion'].includes(String(mode)))
    return output('access_blocked','INVALID_NEW_SCOPE');
   const hasSession=mode==='session';
   if((hasSession&&keys.length!==5)||(!hasSession&&keys.length!==4)||
    (hasSession&&(typeof x.session_ref!=='string'||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(x.session_ref))))
    return output('access_blocked','LEGACY_WEB_NOT_TRUSTED');
   try{
    if(mode==='guest'){
     const state=await r21.project({screen:'SIGN_IN',mode:'guest',scope});
     return state.state==='guest'?output('guest','GUEST_PREVIEW'):
      output('access_blocked','SOURCE_OR_POLICY_UNAVAILABLE');
    }
    if(mode==='logout'){
     // UI preview only. Actual Server Session is NOT revoked.
     return output('reauth_required','LOGOUT_PREVIEW_ONLY');
    }
    if(mode==='deletion'){
     const state=await r21.project({screen:'DELETE_ACCOUNT',mode:'deletion',scope},claim);
     return state.state==='deletion_pending'?
      output('deletion_pending','DELETION_PENDING_GLOBAL_PROOF'):
      output('access_blocked','SOURCE_OR_POLICY_UNAVAILABLE');
    }
    const rq={screen:'HOME' as const,mode:'session' as const,scope,
     session_ref:x.session_ref as string,app_id:R22_ECHO_CANDIDATE_APP_ID};
    const firstAuth=await r21.project(rq);
    if(firstAuth.state==='reauth_required')
     return output('reauth_required','REAUTH_REQUIRED');
    if(firstAuth.state!=='auth_unverified')
     return output('access_blocked','SOURCE_OR_POLICY_UNAVAILABLE');
    if(await deps.lawfulSessionReadApprovedNow()!==true)
     return output('access_blocked','SOURCE_OR_POLICY_UNAVAILABLE');
    const read=async()=>deps.db.prepare(R22_ECHO_MEMBERSHIP_SQL)
     .bind(x.session_ref as string,R22_ECHO_CANDIDATE_APP_ID,scope.environment)
     .first<Row>();
    const a=await read();
    if(!a)return output('access_blocked','MEMBERSHIP_MISSING','missing');
    if(!valid(a,scope))return output('access_blocked','MEMBERSHIP_UNVERIFIED');
    const secondAuth=await r21.project(rq);
    if(secondAuth.state!=='auth_unverified')
     return output('access_blocked','SOURCE_OR_POLICY_UNAVAILABLE');
    if(await deps.lawfulSessionReadApprovedNow()!==true)
     return output('access_blocked','SOURCE_OR_POLICY_UNAVAILABLE');
    const b=await read();
    if(!same(a,b)||!valid(b,scope))
     return output('access_blocked','MEMBERSHIP_DRIFT');
    if(b?.membership_status==='suspended')
     return output('access_blocked','MEMBERSHIP_SUSPENDED','suspended');
    // Local matching membership ≠ officially registered Echo app privilege.
    return output('auth_unverified','MEMBERSHIP_UNVERIFIED','unverified');
   }catch{return output('access_blocked','SOURCE_OR_POLICY_UNAVAILABLE');}
  },
  status:'NEW_STARRY_ID_ECHO_OFFLINE_CANDIDATE_NOT_LEGACY_WEB_SSO' as const
 });
}
