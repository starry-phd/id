/** AI-1 Starry-only policy kernel v0.1. DESIGN ONLY, NOT DEPLOYED.
 * VerifiedPrincipal MUST originate from cryptographic OIDC/JWKS or signed-session
 * verification; scope/session/member/grant MUST originate from trusted backend.
 */
export type Environment='development'|'staging'|'production';
export type Action='read'|'write'|'approve'|'refund'|'deploy'|'export'|'restore';
export type Resource='member'|'session'|'admin'|'billing'|'battery'|'system';
export type Reason='AUTH_REQUIRED'|'SCOPE_DENIED'|'SESSION_REVOKED'|'MEMBER_INACTIVE'|'ADMIN_DENIED'|'STEP_UP_REQUIRED'|'PROFILE_PRIVATE';
export type Decision={allowed:true}|{allowed:false,reason:Reason};
export type TrustedScope={brand_id:'starry',app_id:string,environment:Environment};
export type VerifiedPrincipal={brand_id:string,app_id:string,environment:string,s_user_id:string,session_id:string,auth_version:number,expires_at:number};
export type Member={s_user_id:string,status:'active'|'suspended'|'deleted',auth_version:number};
export type Session={s_user_id:string,session_id:string,app_id:string,environment:string,auth_version:number,expires_at:number,revoked_at:number|null,step_up_until:number|null};
export type Grant={s_user_id:string,brand_id:string,app_id:string,environment:string,resource:Resource,action:Action,expires_at:number,revoked_at:number|null};
export type Operation={resource:Resource,action:Action};
const deny=(reason:Reason):Decision=>({allowed:false,reason});
const valid=(s:unknown)=>typeof s==='string'&&s.length>0&&s.trim()===s;
const timestamp=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export function authorizeSession(scope:TrustedScope,p:VerifiedPrincipal|null,s:Session|null,m:Member|null,now:number):Decision {
  if(!p)return deny('AUTH_REQUIRED');
  if(scope.brand_id!=='starry'||!valid(scope.app_id)||!['development','staging','production'].includes(scope.environment)
    ||p.brand_id!=='starry'||p.app_id!==scope.app_id||p.environment!==scope.environment
    ||!valid(p.s_user_id)||!valid(p.session_id))return deny('SCOPE_DENIED');
  if(!timestamp(now)||!timestamp(p.expires_at)||!s||!m||!timestamp(s.expires_at)
    ||p.expires_at<=now||s.expires_at<=now||s.revoked_at!==null
    ||s.session_id!==p.session_id||s.s_user_id!==p.s_user_id||m.s_user_id!==p.s_user_id
    ||s.app_id!==scope.app_id||s.environment!==scope.environment
    ||!Number.isSafeInteger(p.auth_version)||p.auth_version!==m.auth_version||s.auth_version!==m.auth_version)
    return deny('SESSION_REVOKED');
  return m.status==='active'?{allowed:true}:deny('MEMBER_INACTIVE');
}
export function authorizeAdmin(scope:TrustedScope,p:VerifiedPrincipal|null,s:Session|null,m:Member|null,g:Grant|null,o:Operation,now:number):Decision {
  const base=authorizeSession(scope,p,s,m,now);
  if(!base.allowed)return base;
  if(!p||!s||!g||!valid(o.resource)||!valid(o.action)
    ||g.s_user_id!==p.s_user_id||g.brand_id!=='starry'||g.app_id!==scope.app_id
    ||g.environment!==scope.environment||g.resource!==o.resource||g.action!==o.action
    ||g.revoked_at!==null||!timestamp(g.expires_at)||g.expires_at<=now)return deny('ADMIN_DENIED');
  if(o.action!=='read'&&(!timestamp(s.step_up_until)||s.step_up_until<=now))return deny('STEP_UP_REQUIRED');
  return {allowed:true};
}
export type PublicProfile={status:'active'|'suspended'|'deleted',directory_opt_in:boolean,display_name_public:boolean};
export function authorizePublicProfile(p:PublicProfile|null):Decision {
  return p&&p.status==='active'&&p.directory_opt_in&&p.display_name_public?{allowed:true}:deny('PROFILE_PRIVATE');
}
/** Claim binding AFTER signature/JWKS verification; this DOES NOT verify cryptography. */
export type VerifiedOidcClaims={issuer:string,audience:readonly string[],subject:string,nonce:string,expires_at:number,issued_at:number};
export type ExpectedOidc={issuer:string,client_id:string,nonce:string,now:number};
export function hasExpectedOidcBinding(c:VerifiedOidcClaims,e:ExpectedOidc):boolean {
  return valid(e.issuer)&&valid(e.client_id)&&valid(e.nonce)&&timestamp(e.now)&&valid(c.subject)
    &&c.issuer===e.issuer&&Array.isArray(c.audience)&&c.audience.includes(e.client_id)
    &&c.nonce===e.nonce&&timestamp(c.expires_at)&&c.expires_at>e.now
    &&timestamp(c.issued_at)&&c.issued_at<=e.now;
}
export const CROSS_BRAND_MEMBER_SYNC_ENABLED=false as const;
export function disabledCrossBrandSync():never {throw new Error('FEATURE_DISABLED');}
