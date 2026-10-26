/** AI-1 Q98=B/Q122=B: one protected Starry supreme manager plus delegated
 * admins. Read-only authorization candidate; cannot appoint/transfer roles.
 */
import type {TrustedPrincipal,TrustedScope,Session} from './index.ts';
import {isTrustedPrincipal} from './index.ts';
import type {D1Database} from './d1-ports.ts';
const id=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(s);
const epoch=(s:unknown):s is number=>typeof s==='number'&&Number.isSafeInteger(s)&&s>=0;
export type StarryAdminCapability='member:suspend'|'member:restore'|'member:delete'|'battery:adjust';
export function createOfflineStarryAdminAuthority(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;db:D1Database;
 readCurrentSession:(id:string)=>Promise<Session|null>;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!id(scope.app_id)||
  !['development','staging'].includes(scope.environment))throw Error('ADMIN_AUTH_SCOPE_DENIED');
 const active=deps.enabled===true;
 return Object.freeze({
  async permit(principal:unknown,action:StarryAdminCapability,now:number):Promise<boolean>{
   if(!active||!isTrustedPrincipal(principal)||!epoch(now)||
     !['member:suspend','member:restore','member:delete','battery:adjust'].includes(action))return false;
   const p=principal as TrustedPrincipal;
   if(p.brand_id!=='starry'||p.app_id!==scope.app_id||p.environment!==scope.environment||
     p.member_status!=='active'||!id(p.session_id)||!id(p.s_user_id)||
     now<p.checked_at||now-p.checked_at>60||now>=p.expires_at)return false;
   try{
    // Role is server-owned, bound to same active account and auth_version.
    const role=await deps.db.prepare(
     "SELECT a.role,a.revoked_at,m.auth_version AS version FROM starry_admin_roles a "+
     "JOIN starry_members m ON m.s_user_id=a.s_user_id "+
     "WHERE a.s_user_id=? AND a.environment=? AND m.status='active' LIMIT 1"
    ).bind(p.s_user_id,scope.environment).first<{
     role:'supreme'|'delegated';revoked_at:number|null;version:number;
    }>();
    if(!role||role.revoked_at!==null||role.version!==p.auth_version||
       !['supreme','delegated'].includes(role.role))return false;
    // Destructive privileges cannot be delegated implicitly.
    // Delegated role alone is NOT an approved capability grant. Fail closed until
    // AI-0 approves fine-grained capability bindings and least-privilege checks.
    if(role.role==='delegated')return false;
    const session=await deps.readCurrentSession(p.session_id);
    if(!session||session.session_id!==p.session_id||session.s_user_id!==p.s_user_id||
     session.app_id!==scope.app_id||session.environment!==scope.environment||
     session.auth_version!==p.auth_version||session.revoked_at!==null||
     !epoch(session.expires_at)||session.expires_at<=now||
     !['passkey','totp'].includes(session.step_up_method??'')||
     !epoch(session.step_up_verified_at)||!epoch(session.step_up_expires_at)||
     session.step_up_verified_at>now||now-session.step_up_verified_at>300||
     session.step_up_expires_at<=now)return false;
    return true;
   }catch{return false;}
  },
 });
}
