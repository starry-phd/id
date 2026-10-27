/**
 * R16 AI-1: one canonical Auth-owned account_deleted dispatcher candidate.
 * Auth owns durable deletion outbox and lease. AI-3 owns its UNIQUE Battery
 * inbox and its own wallet transaction. AI-4 owns network/Queue transport.
 * Never ACK queues, regrant funds, deploy or issue Billing entitlements.
 *
 * OFFLINE TEST ONLY: the publisher-lease schema is in test/fixtures, not an
 * approved Cloudflare migration. No cross-D1 ACID or exactly-once transport.
 */
import {createOfflineAuthDeletionEventSource} from './round15-deletion-source-contract.ts';
import type {BatteryAuthDeletionDTO,StarryDeletionEventScope} from './round15-deletion-source-contract.ts';
import type {D1Database} from './d1-ports.ts';
export const LIVE_AUTH_DELETION_PUBLISHER_ENABLED=false as const;
export const AUTH_CANONICAL_PUBLISHER_ID='starry-auth-sole-v1' as const;
export const AUTH_DELETION_TRANSPORT_ACK_ALLOWED=false as const;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const safe=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const scoped=(s:unknown):s is StarryDeletionEventScope=>{
 try{
  if(!s||typeof s!=='object'||Array.isArray(s))return false;
  const o=s as object,keys=Reflect.ownKeys(o),d=Object.getOwnPropertyDescriptors(o);
  if((Object.getPrototypeOf(o)!==Object.prototype&&Object.getPrototypeOf(o)!==null)||
   keys.length!==2||!('value' in (d.brand_id??{}))||
   !('value' in (d.environment??{})))return false;
  return d.brand_id.value==='starry'&&['development','staging'].includes(d.environment.value)&&
   keys.every(k=>k==='brand_id'||k==='environment');
 }catch{return false;}
};
export type AuthDeletionDispatchClaim=Readonly<{
 disposition:'offline_claim_only';publisher_id:typeof AUTH_CANONICAL_PUBLISHER_ID;
 event:BatteryAuthDeletionDTO;lease_token:string;lease_expires_at:number;
 attempt_no:number;may_ack_queue:false;may_mark_delivered:false;
 may_regrant:false;live:false;
}>;
const sealed=new WeakSet<object>();
export function isSealedAuthDeletionDispatchClaim(v:unknown):v is AuthDeletionDispatchClaim{
 return !!v&&typeof v==='object'&&sealed.has(v);
}
/**
 * One atomic INSERT/UPSERT and current Auth source/state/scope check; expired
 * lease may be retaken, using a NEW token and incremented attempt number.
 * The SOURCE event_id never changes between attempts: the recipient DB must
 * deduplicate by UNIQUE(event_id), independent of any sender lease.
 *
 * No status 'delivered' and NO Queue ACK, even after an offline Battery
 * receipt. AI-0 must first approve independent durable ACK semantics.
 */
export const AUTH_CLAIM_SQL=
 'INSERT INTO starry_auth_deletion_dispatch_claims '+
 '(event_id,publisher_id,lease_token,lease_expires_at,attempt_no) '+
 "SELECT o.event_id,'starry-auth-sole-v1',?,?,1 "+
 'FROM starry_deletion_outbox o '+
 'JOIN starry_members m ON m.s_user_id=o.s_user_id '+
 'JOIN starry_deletion_challenges c ON c.event_id=o.event_id '+
 'AND c.s_user_id=o.s_user_id AND c.consumed_at=o.occurred_at '+
 'JOIN starry_deletion_challenge_scope z ON z.challenge_ref=c.challenge_ref '+
 'WHERE o.event_id=? AND o.event_type=\'account_deleted\' '+
 'AND z.environment=? AND o.occurred_at<=? AND o.occurred_at>=0 '+
 "AND m.status='deleted' AND m.auth_version=c.auth_version+1 "+
 'AND m.updated_at=o.occurred_at AND m.display_name IS NULL '+
 'AND m.directory_opt_in=0 AND m.display_name_public=0 '+
 'AND length(o.s_user_id)<=96 '+
 'AND NOT EXISTS(SELECT 1 FROM starry_sessions s '+
 'WHERE s.s_user_id=m.s_user_id AND s.revoked_at IS NULL) '+
 'ON CONFLICT(event_id) DO UPDATE SET '+
 'lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,'+
 'attempt_no=starry_auth_deletion_dispatch_claims.attempt_no+1 '+
 "WHERE starry_auth_deletion_dispatch_claims.publisher_id='starry-auth-sole-v1' "+
 'AND starry_auth_deletion_dispatch_claims.lease_expires_at<=? '+
 'AND starry_auth_deletion_dispatch_claims.attempt_no<1000 '+
 'RETURNING event_id,publisher_id,lease_token,lease_expires_at,attempt_no';
function randomToken(){
 const bytes=new Uint8Array(32);
 crypto.getRandomValues(bytes);
 return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
}
export function createOfflineCanonicalAuthDeletionPublisher(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionEventScope;db:D1Database;
 lawfulDeletionProcessingApprovedNow:()=>Promise<boolean>;
 readServerNow:()=>number;
}>) {
 if(!scoped(deps.scope)||typeof deps.db?.prepare!=='function'||
    typeof deps.lawfulDeletionProcessingApprovedNow!=='function'||
    typeof deps.readServerNow!=='function')
  throw Error('AUTH_SOLE_PUBLISHER_CONFIG_DENIED');
 const scope=Object.freeze({...deps.scope});
 const enabled=deps.enabled===true;
 const source=createOfflineAuthDeletionEventSource({
  enabled,scope,db:deps.db,
  legalDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  readServerNow:deps.readServerNow
 });
 return Object.freeze({
  async claim(eventId:unknown):Promise<AuthDeletionDispatchClaim|null>{
   if(!enabled||typeof eventId!=='string'||!EVENT.test(eventId))return null;
   try{
    const now=deps.readServerNow();
    if(!safe(now)||now>Number.MAX_SAFE_INTEGER-30)return null;
    // Lawful purpose + current deleted Member/fully revoked sessions FIRST.
    const event=await source.readBatteryEvent(eventId);
    if(!event)return null;
    const leaseToken=randomToken();
    const leaseUntil=now+30;
    const candidate=await deps.db.prepare(AUTH_CLAIM_SQL)
     .bind(leaseToken,leaseUntil,event.event_id,scope.environment,now,now)
     .first<{event_id:unknown;publisher_id:unknown;lease_token:unknown;
      lease_expires_at:unknown;attempt_no:unknown}>();
    if(!candidate||candidate.event_id!==event.event_id||
     candidate.publisher_id!==AUTH_CANONICAL_PUBLISHER_ID||
     candidate.lease_token!==leaseToken||!TOKEN.test(leaseToken)||
     candidate.lease_expires_at!==leaseUntil||
     !safe(candidate.attempt_no)||candidate.attempt_no<1||
     candidate.attempt_no>1000)return null;
    // Source can change between obtaining a lease and handing off an event.
    // Recheck before returning: if it fails the lease merely expires.
    const fresh=await source.readBatteryEvent(eventId);
    if(!fresh||fresh.member_ref!==event.member_ref||
     fresh.occurred_at_sec!==event.occurred_at_sec||
     fresh.event_id!==event.event_id)return null;
    const claim=Object.freeze({
     disposition:'offline_claim_only' as const,
     publisher_id:AUTH_CANONICAL_PUBLISHER_ID,
     event:fresh,lease_token:leaseToken,lease_expires_at:leaseUntil,
     attempt_no:candidate.attempt_no,may_ack_queue:false as const,
     may_mark_delivered:false as const,may_regrant:false as const,
     live:false as const,
    });
    sealed.add(claim);
    return claim;
   }catch{return null;}
  },
  // No publish()/send()/ack()/markDelivered() method intentionally.
  // AI-4 will own any real transport only after a separate architecture Gate.
  publisher_status:'CANDIDATE_NOT_APPROVED_CANONICAL_PROTOCOL' as const,
 });
}
