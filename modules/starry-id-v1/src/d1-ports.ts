/** AI-1 Round 3: Cloudflare D1-shaped prepared statement interfaces.
 * Design-only, no real database binding or migration execution.
 * All queries are fixed SQL; identifiers come only from verified server principal.
 * AI-4 owns actual Cloudflare binding / Worker composition and failure semantics.
 */
import type {Member,Session,Provider,TrustedScope} from './index.ts';
import type {StoredStoreBinding,TrustedStoreScope} from './billing-bridge.ts';
export type D1Result<T=unknown>=Readonly<{
  results?:T[];meta?:Readonly<{changes?:number}>;success?:boolean;
}>;
export type D1Prepared=Readonly<{
  bind:(...params:(string|number|null)[])=>D1Prepared;
  first:<T=Record<string,unknown>>()=>Promise<T|null>;
  run:()=>Promise<D1Result>;
}>;
export type D1Database=Readonly<{
  prepare:(sql:string)=>D1Prepared;
}>;
function positive(v:unknown):v is number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;}
function safeId(v:unknown):v is string{return typeof v==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v);}
function epoch(v:unknown):v is number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;}
function bool01(v:unknown):boolean|undefined{return v===1?true:v===0?false:undefined;}
/** Explicit shape normalization: D1 SQLite INTEGER booleans are NOT JS booleans. */
export function createStarryD1Port(db:D1Database,serverScope:TrustedScope) {
 const scope=Object.freeze({...serverScope});
 if(scope.brand_id!=='starry'||!safeId(scope.app_id)||!['development','staging','production'].includes(scope.environment))
   throw Error('D1_SCOPE_DENIED');
 return Object.freeze({
  async readMember(sUserId:string):Promise<Member|null>{
    if(!safeId(sUserId))return null;
    const r=await db.prepare('SELECT s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public FROM starry_members WHERE s_user_id=?').bind(sUserId).first<{
      s_user_id:string;status:string;auth_version:number;profile_revision:number;display_name:string|null;
      directory_opt_in:number;display_name_public:number;
    }>();
    if(!r||r.s_user_id!==sUserId||!['active','suspended','deleted'].includes(r.status)||
      !positive(r.auth_version)||!positive(r.profile_revision)||
      (r.display_name!==null&&typeof r.display_name!=='string'))return null;
    const directory=bool01(r.directory_opt_in),name=bool01(r.display_name_public);
    if(directory===undefined||name===undefined)return null;
    return Object.freeze({...r,status:r.status as Member['status'],
      directory_opt_in:directory,display_name_public:name});
  },
  async readSession(sessionId:string):Promise<Session|null>{
    if(!safeId(sessionId))return null;
    const r=await db.prepare('SELECT session_id,s_user_id,auth_version,app_id,environment,expires_at,revoked_at,step_up_method,step_up_verified_at,step_up_expires_at FROM starry_sessions WHERE session_id=? AND app_id=? AND environment=?')
      .bind(sessionId,scope.app_id,scope.environment).first<Session>();
    if(!r||r.session_id!==sessionId||r.app_id!==scope.app_id||r.environment!==scope.environment||
      !safeId(r.s_user_id)||!positive(r.auth_version)||!epoch(r.expires_at)||
      (r.revoked_at!==null&&!epoch(r.revoked_at)))return null;
    return Object.freeze(r);
  },
  async identityMatches(provider:Provider,subject:string,userId:string):Promise<boolean>{
    if(!['apple','google'].includes(provider)||!safeId(subject)||!safeId(userId))return false;
    const r=await db.prepare('SELECT 1 AS matched FROM starry_identities WHERE provider=? AND subject=? AND s_user_id=? LIMIT 1')
      .bind(provider,subject,userId).first<{matched:number}>();
    return r?.matched===1;
  },
  async readStoreBinding(key:Readonly<{
    s_user_id:string;app_id:string;environment:TrustedScope['environment'];store:'apple'|'google';
    store_app_id:string;store_environment:'sandbox';
  }>):Promise<StoredStoreBinding|null>{
    if(!safeId(key.s_user_id)||key.app_id!==scope.app_id||key.environment!==scope.environment||
      !['apple','google'].includes(key.store)||!safeId(key.store_app_id)||
      key.store_environment!=='sandbox')return null;
    const r=await db.prepare('SELECT s_user_id,app_id,environment,store,store_app_id,store_environment,account_binding,revoked_at,expires_at FROM starry_store_bindings WHERE s_user_id=? AND app_id=? AND environment=? AND store=? AND store_app_id=? AND store_environment=?')
      .bind(key.s_user_id,key.app_id,key.environment,key.store,key.store_app_id,'sandbox')
      .first<Omit<StoredStoreBinding,'brand_id'>>();
    if(!r||r.s_user_id!==key.s_user_id||r.app_id!==scope.app_id||
      r.environment!==scope.environment||r.store!==key.store||
      r.store_app_id!==key.store_app_id||r.store_environment!=='sandbox'||
      !safeId(r.account_binding)||(r.revoked_at!==null&&!epoch(r.revoked_at))||
      (r.expires_at!==null&&!epoch(r.expires_at)))return null;
    return Object.freeze({...r,brand_id:'starry' as const});
  },
  /** Checked write: caller MUST have trusted principal and verified authorization. */
  async updateProfileCAS(args:Readonly<{
    s_user_id:string;auth_version:number;expected_revision:number;
    display_name:string|null;directory_opt_in:boolean;display_name_public:boolean;now:number;
  }>):Promise<boolean>{
    if(!safeId(args.s_user_id)||!positive(args.auth_version)||!positive(args.expected_revision)||
      !epoch(args.now)||typeof args.directory_opt_in!=='boolean'||typeof args.display_name_public!=='boolean'||
      (args.display_name!==null&&(typeof args.display_name!=='string'||
      args.display_name.trim()!==args.display_name||args.display_name.length<1||args.display_name.length>80)))return false;
    const result=await db.prepare("UPDATE starry_members SET display_name=?,directory_opt_in=?,display_name_public=?,profile_revision=profile_revision+1,updated_at=? WHERE s_user_id=? AND status='active' AND auth_version=? AND profile_revision=?")
      .bind(args.display_name,Number(args.directory_opt_in),Number(args.display_name_public),args.now,args.s_user_id,args.auth_version,args.expected_revision).run();
    return result.success!==false && result.meta?.changes===1;
  },
  async revokeSessionCAS(sUserId:string,sessionId:string,authVersion:number,now:number):Promise<boolean>{
    if(!safeId(sUserId)||!safeId(sessionId)||!positive(authVersion)||!epoch(now))return false;
    const result=await db.prepare("UPDATE starry_sessions SET revoked_at=? WHERE s_user_id=? AND session_id=? AND app_id=? AND environment=? AND auth_version=? AND revoked_at IS NULL")
      .bind(now,sUserId,sessionId,scope.app_id,scope.environment,authVersion).run();
    return result.success!==false && result.meta?.changes===1;
  },
 });
}
