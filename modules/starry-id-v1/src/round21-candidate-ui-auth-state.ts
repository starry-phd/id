/**
 * AI-1 R21. OFFLINE-ONLY candidate consumer UI Auth state. No account, event,
 * session, OAuth identifier or PII may reach a screen. No signed-in/deleted
 * success state exists. R19 verifies actual committed Auth deletion/lease.
 * R20 identity-mapping review is NOT a production Auth/Store authority.
 */
import {createOfflineAuthCrossDomainDTO} from './round19-auth-cross-domain-dto.ts';
import {R20_HMAC_MEMBER_MAPPING_APPROVED} from './round20-auth-identity-boundary.ts';
import type {StarryDeletionEventScope} from './round15-deletion-source-contract.ts';
import type {D1Database} from './d1-ports.ts';

export const R21_LIVE_AUTH_UI_ENABLED=false as const;
export const R21_OFFICIAL_SIGNIN_APPROVED=false as const;
export const R21_GLOBAL_DELETION_PROOF_APPROVED=false as const;
export const R21_AUTH_UI_SCHEMA='starry.candidate-ui.auth-state.v0-offline' as const;
export type CandidateAuthScreen='SIGN_IN'|'HOME'|'ACCOUNT_SETTINGS'|'DELETE_ACCOUNT';
export type CandidateAuthState='guest'|'reauth_required'|'auth_unverified'|
 'deletion_pending'|'access_blocked';
type Mode='guest'|'session'|'deletion';
type Request=Readonly<{screen:CandidateAuthScreen;mode:Mode;
 scope:StarryDeletionEventScope;session_ref?:string;app_id?:string}>;
export type R21CandidateAuthUI=Readonly<{
 schema_version:typeof R21_AUTH_UI_SCHEMA;
 screen:CandidateAuthScreen;state:CandidateAuthState;reason_code:
  'GUEST_PLACEHOLDER'|'NOT_SIGNED_IN'|'SESSION_REVOKED'|
  'SESSION_NOT_OFFICIALLY_VERIFIED'|'LOCAL_DELETION_PENDING_GLOBAL_EVIDENCE'|
  'OFFLINE_DISABLED'|'INVALID_SCOPE_OR_REQUEST'|'POLICY_UNAVAILABLE'|
  'MISSING_OR_CONFLICTING_SOURCE'|'AUTH_READ_UNAVAILABLE';
 ui_only:true;candidate_only:true;personal_data_included:false;
 authenticated:false;global_deletion_confirmed:false;
 may_grant:false;may_ack_queue:false;may_publish:false;
 may_restore:false;live:false;
}>;
const SCREENS=['SIGN_IN','HOME','ACCOUNT_SETTINGS','DELETE_ACCOUNT'] as const;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const POLICY=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$/;
const safe=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function exact(v:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const o=v as object,p=Object.getPrototypeOf(o),keys=Reflect.ownKeys(o);
  if((p!==Object.prototype&&p!==null)||keys.length!==fields.length||
   keys.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const d=Object.getOwnPropertyDescriptors(o);
  const out:Record<string,unknown>=Object.create(null);
  for(const key of fields){
   if(!d[key]?.enumerable||!('value' in d[key]))return null;
   out[key]=d[key].value;
  }
  return out;
 }catch{return null;}
}
function parseScope(v:unknown):StarryDeletionEventScope|null{
 const s=exact(v,['brand_id','environment']);
 return s&&s.brand_id==='starry'&&
  (s.environment==='development'||s.environment==='staging')
  ?Object.freeze({brand_id:'starry',environment:s.environment}):null;
}
function parseRequest(v:unknown,scope:StarryDeletionEventScope):Request|null{
 const q=v&&typeof v==='object'&&!Array.isArray(v) ? v as object:null;
 if(!q)return null;
 const keys=Reflect.ownKeys(q);
 const fields=keys.length===3?['screen','mode','scope']:
  keys.length===5?['screen','mode','scope','session_ref','app_id']:[];
 const row=exact(v,fields);
 if(!row||!SCREENS.includes(row.screen as CandidateAuthScreen))return null;
 const s=parseScope(row.scope);
 if(!s||s.environment!==scope.environment)return null;
 if(row.mode==='guest'&&keys.length===3)
  return {screen:row.screen as CandidateAuthScreen,mode:'guest',scope};
 if(row.mode==='deletion'&&keys.length===3&&row.screen==='DELETE_ACCOUNT')
  return {screen:'DELETE_ACCOUNT',mode:'deletion',scope};
 if(row.mode==='session'&&keys.length===5&&
  typeof row.session_ref==='string'&&REF.test(row.session_ref)&&
  typeof row.app_id==='string'&&REF.test(row.app_id))
  return {screen:row.screen as CandidateAuthScreen,mode:'session',scope,
   session_ref:row.session_ref,app_id:row.app_id};
 return null;
}
const result=(screen:CandidateAuthScreen,state:CandidateAuthState,
 reason_code:R21CandidateAuthUI['reason_code']):R21CandidateAuthUI=>
 Object.freeze({schema_version:R21_AUTH_UI_SCHEMA,screen,state,reason_code,
 ui_only:true,candidate_only:true,personal_data_included:false,
 authenticated:false,global_deletion_confirmed:false,
 may_grant:false,may_ack_queue:false,may_publish:false,may_restore:false,live:false});
export const R21_OFFLINE_SESSION_SELECT=
 'SELECT s.session_id,s.app_id,s.environment,s.auth_version,s.expires_at,'+
 's.revoked_at,m.status AS member_status,m.auth_version AS member_auth_version '+
 'FROM starry_sessions s JOIN starry_members m ON m.s_user_id=s.s_user_id '+
 'WHERE s.session_id=? LIMIT 1';
type Session=Readonly<{session_id:unknown;app_id:unknown;environment:unknown;
 auth_version:unknown;expires_at:unknown;revoked_at:unknown;
 member_status:unknown;member_auth_version:unknown}>;
function sessionValid(s:Session|null,q:Request,now:number):'current'|'revoked'|'conflicting'{
 if(!s||s.session_id!==q.session_ref||s.app_id!==q.app_id||
  s.environment!==q.scope.environment||!safe(s.auth_version)||
  !safe(s.member_auth_version)||!safe(s.expires_at)||
  (s.revoked_at!==null&&!safe(s.revoked_at)))return 'conflicting';
 if(s.member_status!=='active')return 'conflicting';
 if(s.revoked_at!==null||s.expires_at<=now||
  s.auth_version!==s.member_auth_version)return 'revoked';
 return 'current';
}
function stable(a:Session|null,b:Session|null):boolean{
 return !!a&&!!b&&a.session_id===b.session_id&&a.app_id===b.app_id&&
 a.environment===b.environment&&a.auth_version===b.auth_version&&
 a.member_auth_version===b.member_auth_version&&a.expires_at===b.expires_at&&
 a.revoked_at===b.revoked_at&&a.member_status===b.member_status;
}
export function createOfflineCandidateAuthUI(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionEventScope;authDb:D1Database;
 lawfulSessionReadApprovedNow:()=>Promise<boolean>;
 lawfulDeletionProcessingApprovedNow:()=>Promise<boolean>;
 lawfulMinimalRetentionApprovedNow:()=>Promise<boolean>;
 readApprovedPolicyRevisionNow:()=>Promise<unknown>;
 readServerNow:()=>number;
}>) {
 const scope=parseScope(deps.scope);
 if(!scope||typeof deps.authDb?.prepare!=='function'||
  typeof deps.lawfulSessionReadApprovedNow!=='function'||
  typeof deps.lawfulDeletionProcessingApprovedNow!=='function'||
  typeof deps.lawfulMinimalRetentionApprovedNow!=='function'||
  typeof deps.readApprovedPolicyRevisionNow!=='function'||
  typeof deps.readServerNow!=='function')
  throw Error('R21_AUTH_UI_INVALID_SCOPE_OR_PORT');
 const source=createOfflineAuthCrossDomainDTO({
  enabled:deps.enabled===true,scope,db:deps.authDb,
  lawfulDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  lawfulMinimalRetentionApprovedNow:deps.lawfulMinimalRetentionApprovedNow,
  readApprovedPolicyRevisionNow:deps.readApprovedPolicyRevisionNow,
  readServerNow:deps.readServerNow
 });
 const enabled=deps.enabled===true;
 async function policy(deleting:boolean):Promise<string|null>{
  if(await deps.lawfulSessionReadApprovedNow()!==true)return null;
  if(deleting&&(await deps.lawfulDeletionProcessingApprovedNow()!==true||
   await deps.lawfulMinimalRetentionApprovedNow()!==true))return null;
  const revision=await deps.readApprovedPolicyRevisionNow();
  return typeof revision==='string'&&POLICY.test(revision)?revision:null;
 }
 return Object.freeze({
  async project(request:unknown,authDeletionClaim?:unknown):Promise<R21CandidateAuthUI>{
   // A malformed client request never echoes any supplied identifier.
   const q=parseRequest(request,scope);
   const screen=q?.screen??'SIGN_IN';
   if(!enabled)return result(screen,'access_blocked','OFFLINE_DISABLED');
   if(!q)return result(screen,'access_blocked','INVALID_SCOPE_OR_REQUEST');
   if(q.mode==='guest'){
    // Public candidate placeholder: zero auth/personal-data reads.
    if(q.screen==='SIGN_IN')
     return result(q.screen,'guest','GUEST_PLACEHOLDER');
    return result(q.screen,'reauth_required','NOT_SIGNED_IN');
   }
   try{
    // No protected Auth SQL until current legal/policy permission.
    const start=await policy(q.mode==='deletion');
    if(!start)return result(q.screen,'access_blocked','POLICY_UNAVAILABLE');
    const now=deps.readServerNow();
    if(!safe(now))return result(q.screen,'access_blocked','POLICY_UNAVAILABLE');
    if(q.mode==='deletion'){
     // Actual R19 sealed R16 claim + R18 committed source and deletion-time
     // all-app Session revocation. No official global completion ever follows.
     const first=await source.readForOfflineConsumer(authDeletionClaim,'saga',scope);
     if(!first)return result(q.screen,'access_blocked','MISSING_OR_CONFLICTING_SOURCE');
     if(await policy(true)!==start)
      return result(q.screen,'access_blocked','POLICY_UNAVAILABLE');
     const second=await source.readForOfflineConsumer(authDeletionClaim,'saga',scope);
     if(!second||first.event.event_id!==second.event.event_id||
      first.auth_version!==second.auth_version||
      first.source_attempt_no!==second.source_attempt_no||
      first.policy_revision!==second.policy_revision||
      deps.readServerNow()<now)
      return result(q.screen,'access_blocked','MISSING_OR_CONFLICTING_SOURCE');
     if(await policy(true)!==start||R20_HMAC_MEMBER_MAPPING_APPROVED!==false)
      return result(q.screen,'access_blocked','POLICY_UNAVAILABLE');
     return result(q.screen,'deletion_pending','LOCAL_DELETION_PENDING_GLOBAL_EVIDENCE');
    }
    const read=async()=>deps.authDb.prepare(R21_OFFLINE_SESSION_SELECT)
     .bind(q.session_ref!).first<Session>();
    const a=await read(),status=sessionValid(a,q,now);
    if(status==='conflicting')
     return result(q.screen,'access_blocked','MISSING_OR_CONFLICTING_SOURCE');
    if(await policy(false)!==start)
     return result(q.screen,'access_blocked','POLICY_UNAVAILABLE');
    const b=await read(),then=deps.readServerNow();
    if(!safe(then)||then<now||!stable(a,b))
     return result(q.screen,'access_blocked','MISSING_OR_CONFLICTING_SOURCE');
    if(await policy(false)!==start)
     return result(q.screen,'access_blocked','POLICY_UNAVAILABLE');
    if(sessionValid(b,q,then)==='revoked'||status==='revoked')
     return result(q.screen,'reauth_required','SESSION_REVOKED');
    if(sessionValid(b,q,then)!=='current')
     return result(q.screen,'access_blocked','MISSING_OR_CONFLICTING_SOURCE');
    // Existing local Session != official OIDC or an approved signed-in app.
    return result(q.screen,'auth_unverified','SESSION_NOT_OFFICIALLY_VERIFIED');
   }catch{return result(q.screen,'access_blocked','AUTH_READ_UNAVAILABLE');}
  },
  status:'CANDIDATE_UI_ONLY_NOT_AUTH_OR_DELETION_CONFIRMATION' as const
 });
}
