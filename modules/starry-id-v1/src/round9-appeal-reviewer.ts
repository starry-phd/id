/** AI-1 R9: Q98/Q114/Q115 offline Starry-only reviewer authorization.
 * Backend-only inputs must be real authority ports. No Worker route, raw
 * anonymous appeal credentials/attachments, erasure, role appointment or purge.
 */
import {isTrustedPrincipal} from './index.ts';
import type {TrustedPrincipal,TrustedScope,Member,Session} from './index.ts';
import type {D1Database} from './d1-ports.ts';
export type ReviewerPurpose='appeal:review_status'|'privacy:review_retention';
export type MinimalCaseStatus='received'|'reviewing'|'closed';
export type ReviewerReceipt=Readonly<{
 case_ref:string;purpose:ReviewerPurpose;
 status:MinimalCaseStatus;updated_ms:number;checked_at:number;
}>;
const issued=new WeakSet<object>();
export function isTrustedReviewerReceipt(value:unknown):value is ReviewerReceipt {
 return !!value&&typeof value==='object'&&issued.has(value);
}
const safeTime=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const safeId=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(s);
const safeCase=(s:unknown):s is string=>typeof s==='string'&&/^case_[a-f0-9]{64}$/.test(s);
const PURPOSES:readonly ReviewerPurpose[]=['appeal:review_status','privacy:review_retention'];
type GrantRow=Readonly<{
 permission:string;expires_at:number;revoked_at:number|null;auth_version:number;
 role:string;role_revoked_at:number|null;member_version:number;member_status:string;
}>;
type CaseStatus=Readonly<{case_ref:string;status:string;updated_ms:number}>;
type AuditReceipt=Readonly<{persisted:true;event_ref:string}>;
export type ReviewerBackend=Readonly<{
 db:D1Database;
 readCurrentMember:(id:string)=>Promise<Member|null>;
 readCurrentSession:(id:string)=>Promise<Session|null>;
 // These AI-3 ports MUST be backed by authoritative server state, never HTTP flags.
 privacyCanReview:(purpose:ReviewerPurpose,caseRef:string,now:number)=>Promise<boolean>;
 abuseLimit:(actorId:string,caseRef:string)=>Promise<boolean>;
 readMinimalCase:(caseRef:string,scope:TrustedScope)=>Promise<CaseStatus|null>;
 appendAuditAccess:(event:Readonly<{
  actor_id:string;case_ref:string;purpose:ReviewerPurpose;
  app_id:string;environment:'development'|'staging';now:number;
 }>)=>Promise<AuditReceipt|null>;
}>;
export function createOfflineReviewerAuthority(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;backend:ReviewerBackend;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!safeId(scope.app_id)||
   !['development','staging'].includes(scope.environment))
   throw Error('REVIEW_SCOPE_DENIED');
 const enabled=deps.enabled===true;
 return Object.freeze({
  async review(p:unknown,purpose:ReviewerPurpose,caseRef:string,now:number):
   Promise<ReviewerReceipt|null>{
   if(!enabled||!isTrustedPrincipal(p)||!PURPOSES.includes(purpose)||
     !safeCase(caseRef)||!safeTime(now))return null;
   const actor=p as TrustedPrincipal;
   if(actor.brand_id!=='starry'||actor.app_id!==scope.app_id||
     actor.environment!==scope.environment||actor.member_status!=='active'||
     !safeId(actor.s_user_id)||!safeId(actor.session_id)||
     !safeTime(actor.checked_at)||!safeTime(actor.expires_at)||
     actor.expires_at<=now||actor.checked_at>now||now-actor.checked_at>60)return null;
   try{
    const current=await deps.backend.readCurrentMember(actor.s_user_id);
    if(!current||current.s_user_id!==actor.s_user_id||
      current.status!=='active'||current.auth_version!==actor.auth_version)return null;
    const session=await deps.backend.readCurrentSession(actor.session_id);
    if(!session||session.session_id!==actor.session_id||
      session.s_user_id!==actor.s_user_id||session.app_id!==scope.app_id||
      session.environment!==scope.environment||
      session.auth_version!==actor.auth_version||
      session.revoked_at!==null||!safeTime(session.expires_at)||
      session.expires_at<=now||
      !['passkey','totp'].includes(session.step_up_method??'')||
      !safeTime(session.step_up_verified_at)||!safeTime(session.step_up_expires_at)||
      session.step_up_verified_at>now||now-session.step_up_verified_at>300||
      session.step_up_expires_at<=now)return null;
    // Explicit capability required for supreme AND delegated; role alone denied.
    const grant=await deps.backend.db.prepare(
      "SELECT g.permission,g.expires_at,g.revoked_at,g.auth_version,"+
      "a.role,a.revoked_at AS role_revoked_at,"+
      "m.auth_version AS member_version,m.status AS member_status "+
      "FROM starry_privacy_review_grants g "+
      "JOIN starry_members m ON m.s_user_id=g.s_user_id "+
      "JOIN starry_admin_roles a ON a.s_user_id=g.s_user_id "+
      "AND a.environment=g.environment "+
      "WHERE g.s_user_id=? AND g.app_id=? AND g.environment=? "+
      "AND g.permission=? LIMIT 1"
    ).bind(actor.s_user_id,scope.app_id,scope.environment,purpose).first<GrantRow>();
    if(!grant||grant.permission!==purpose||
      !['supreme','delegated'].includes(grant.role)||
      grant.role_revoked_at!==null||grant.revoked_at!==null||
      grant.member_status!=='active'||
      grant.auth_version!==actor.auth_version||
      grant.member_version!==actor.auth_version||
      !safeTime(grant.expires_at)||grant.expires_at<=now)return null;
    if(await deps.backend.abuseLimit(actor.s_user_id,caseRef)!==true)return null;
    if(await deps.backend.privacyCanReview(purpose,caseRef,now)!==true)return null;
    const info=await deps.backend.readMinimalCase(caseRef,scope);
    if(!info||info.case_ref!==caseRef||
      !['received','reviewing','closed'].includes(info.status)||
      !safeTime(info.updated_ms)||info.updated_ms>now*1000)return null;
    // No case status escapes without an append-only, durable audit receipt.
    const audit=await deps.backend.appendAuditAccess(Object.freeze({
      actor_id:actor.s_user_id,case_ref:caseRef,purpose,
      app_id:scope.app_id,
      environment:scope.environment as 'development'|'staging',now,
    }));
    if(!audit||audit.persisted!==true||!safeId(audit.event_ref))return null;
    const receipt=Object.freeze({
      case_ref:caseRef,purpose,status:info.status as MinimalCaseStatus,
      updated_ms:info.updated_ms,checked_at:now,
    });
    issued.add(receipt);
    return receipt;
   }catch{return null;}
  },
 });
}
