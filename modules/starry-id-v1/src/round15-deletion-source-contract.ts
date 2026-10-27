/**
 * AI-1 R15 Q88: offline-only authoritative Auth deletion event source.
 *
 * AI-1 persists event_id/s_user_id/occurred_at/event_type in its OWN Auth DB.
 * AI-3 needs event_id/member_ref/occurred_at_sec/event_type. This adapter
 * reads the real committed outbox + CURRENT deleted member together from Auth
 * D1-shaped SQL; it never trusts an incoming DTO to prove deletion.
 *
 * NOT a cross-D1 transport, signature, Queue ACK, legal retention permission,
 * Store entitlement, or an authorization to restore/regrant Battery.
 */
import type {D1Database} from './d1-ports.ts';
export const LIVE_AUTH_DELETION_EVENT_DELIVERY_ENABLED=false as const;
export const BILLING_HMAC_DELETION_MAPPING_APPROVED=false as const;
export type StarryDeletionEventScope=Readonly<{
 brand_id:'starry';environment:'development'|'staging';
}>;
export type AuthCommittedDeletion=Readonly<{
 event_id:string;s_user_id:string;occurred_at:number;
 event_type:'account_deleted';auth_version:number;
}>;
/** Exact data contract currently accepted by AI-3 R14 Battery consumer. */
export type BatteryAuthDeletionDTO=Readonly<{
 event_id:string;member_ref:string;occurred_at_sec:number;
 event_type:'account_deleted';
}>;
type SourceRow=Readonly<{
 event_id:unknown;s_user_id:unknown;occurred_at:unknown;
 event_type:unknown;auth_version:unknown;member_status:unknown;
 member_updated_at:unknown;profile_name:unknown;
 directory_opt_in:unknown;display_name_public:unknown;
 pending_sessions:unknown;
}>;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const MEMBER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const safeTime=(x:unknown):x is number=>typeof x==='number'&&
 Number.isSafeInteger(x)&&x>=0;
const positive=(x:unknown):x is number=>safeTime(x)&&x>=2;
const FIELDS=['event_id','member_ref','occurred_at_sec','event_type'] as const;
const SCOPE=['brand_id','environment'] as const;
function exact(x:unknown,fields:readonly string[]):Record<string,unknown>|null {
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return null;
  const names=Reflect.ownKeys(x);
  if(names.length!==fields.length||
     names.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const desc=Object.getOwnPropertyDescriptors(x);
  const d:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of fields){
   const v=desc[k];
   if(!v||!v.enumerable||!('value' in v))return null;
   d[k]=v.value;
  }
  return d;
 }catch{return null;}
}
export const AUTH_DELETION_SOURCE_SELECT=
 'SELECT o.event_id,o.s_user_id,o.occurred_at,o.event_type,'+
 'm.auth_version,m.status AS member_status,m.updated_at AS member_updated_at,'+
 'm.display_name AS profile_name,m.directory_opt_in,m.display_name_public,'+
 '(SELECT COUNT(*) FROM starry_sessions s WHERE s.s_user_id=m.s_user_id '+
 'AND s.revoked_at IS NULL) AS pending_sessions '+
 'FROM starry_deletion_outbox o '+
 'JOIN starry_members m ON m.s_user_id=o.s_user_id '+
 'WHERE o.event_id=? AND o.event_type=\'account_deleted\' LIMIT 1';
const trusted=new WeakSet<object>();
export function isSealedAuthDeletionSource(v:unknown):v is AuthCommittedDeletion{
 return !!v&&typeof v==='object'&&trusted.has(v);
}
export function createOfflineAuthDeletionEventSource(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionEventScope;db:D1Database;
 // Policy authority must re-check lawful deletion-processing purpose, not
 // infer approval from a requester, Bearer token, or cached value.
 legalDeletionProcessingApprovedNow:()=>Promise<boolean>;
 // Trusted server wall clock; never supplied by the HTTP sender.
 readServerNow:()=>number;
}>) {
 const s=exact(deps.scope,SCOPE);
 if(!s||s.brand_id!=='starry'||typeof s.environment!=='string'||
  !['development','staging'].includes(s.environment))
  throw Error('AUTH_DELETION_SOURCE_SCOPE_DENIED');
 if(typeof deps.db?.prepare!=='function'||
  typeof deps.legalDeletionProcessingApprovedNow!=='function'||
  typeof deps.readServerNow!=='function')
  throw Error('AUTH_DELETION_SOURCE_BACKEND_REQUIRED');
 const scope=Object.freeze({brand_id:'starry' as const,
  environment:s.environment as 'development'|'staging'});
 const enabled=deps.enabled===true;
 async function source(id:unknown):Promise<AuthCommittedDeletion|null>{
  if(!enabled||typeof id!=='string'||!EVENT.test(id))return null;
  try{
   if(await deps.legalDeletionProcessingApprovedNow()!==true)return null;
   const now=deps.readServerNow();
   if(!safeTime(now))return null;
   const row=await deps.db.prepare(AUTH_DELETION_SOURCE_SELECT)
    .bind(id).first<SourceRow>();
   if(!row||row.event_id!==id||typeof row.s_user_id!=='string'||
    !MEMBER.test(row.s_user_id)||row.event_type!=='account_deleted'||
    !safeTime(row.occurred_at)||row.occurred_at>now||
    !positive(row.auth_version)||row.member_status!=='deleted'||
    row.member_updated_at!==row.occurred_at||
    row.profile_name!==null||row.directory_opt_in!==0||
    row.display_name_public!==0||row.pending_sessions!==0)return null;
   const out=Object.freeze({event_id:id,s_user_id:row.s_user_id,
    occurred_at:row.occurred_at,event_type:'account_deleted' as const,
    auth_version:row.auth_version});
   trusted.add(out);
   return out;
  }catch{return null;}
 }
 return Object.freeze({
  /** Starry Auth SOURCE-only, not a portable/independently signed event. */
  readCommitted:source,
  /** Construct EXACT R14 AI-3 DTO after an authoritative live re-read. */
  async readBatteryEvent(eventId:unknown):Promise<BatteryAuthDeletionDTO|null>{
   const auth=await source(eventId);
   if(!auth)return null;
   return Object.freeze({event_id:auth.event_id,member_ref:auth.s_user_id,
    occurred_at_sec:auth.occurred_at,event_type:'account_deleted' as const});
  },
  /**
   * Intended as the AI-3 trusted backend verifyCommittedDeletion port.
   * Always re-reads Auth current state from its OWN DB, does not trust DTO
   * verified:true or a previously obtained WeakSet/cached proof.
   * A real authenticated durable transport/inbox/Queue remains AI-0 Gate.
   */
  async verifyCommittedDeletion(requestScope:unknown,event:unknown):Promise<boolean>{
   const q=exact(event,FIELDS),sc=exact(requestScope,SCOPE);
   if(!q||!sc||sc.brand_id!=='starry'||
      sc.environment!==scope.environment||
      q.event_type!=='account_deleted'||typeof q.event_id!=='string'||
      !EVENT.test(q.event_id)||typeof q.member_ref!=='string'||
      !MEMBER.test(q.member_ref)||!safeTime(q.occurred_at_sec))return false;
   const auth=await source(q.event_id);
   return !!auth&&auth.s_user_id===q.member_ref&&
     auth.occurred_at===q.occurred_at_sec;
  },
  /** AI-2 requires HMAC member_ref/event_ref/digest + lawful retention:
   * intentionally NOT fabricated out of Auth raw user ID or a plain hash.
   */
  billingContractStatus:'BLOCKED_LEGAL_HMAC_PROTOCOL' as const,
 });
}
