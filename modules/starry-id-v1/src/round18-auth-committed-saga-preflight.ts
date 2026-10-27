/**
 * AI-1 R18: offline-only Auth committed-source/Saga preflight. R15 owns
 * committed outbox; R16 owns the claimed lease; R17 owns its freshness fence.
 * This read-only guard adds deletion-time Session revocation, current policy
 * and lawful minimal-retention validation. No portable attestation is issued.
 */
import {createOfflineAuthDeletionEventSource} from './round15-deletion-source-contract.ts';
import type {StarryDeletionEventScope} from './round15-deletion-source-contract.ts';
import {isSealedAuthDeletionDispatchClaim} from './round16-canonical-deletion-publisher.ts';
import type {AuthDeletionDispatchClaim} from './round16-canonical-deletion-publisher.ts';
import {createOfflineAuthLeaseFence} from './round17-auth-lease-fence.ts';
import type {D1Database} from './d1-ports.ts';

export const LIVE_AUTH_R18_SAGA_PREFLIGHT_ENABLED=false as const;
export const AUTH_R18_EXTERNAL_PROVENANCE_APPROVED=false as const;
export const AUTH_R18_QUEUE_ACK_APPROVED=false as const;

/**
 * This *only* reads the original committed four-column outbox, Member,
 * consumed one-use challenge, and every Auth Session (all apps of this Starry
 * member). The R15/R17 guards check present revocation. R18 additionally
 * rejects sessions revoked AFTER the deletion commit. The aggregate is not
 * proof of a rollback-resistant independent external witness.
 */
export const AUTH_R18_COMMITTED_TIMELINE_SQL=
 'SELECT o.event_id,o.s_user_id,o.occurred_at,o.event_type,m.auth_version,'+
 '(SELECT COUNT(*) FROM starry_deletion_challenges c '+
 'JOIN starry_deletion_challenge_scope z ON z.challenge_ref=c.challenge_ref '+
 'WHERE c.event_id=o.event_id AND c.s_user_id=o.s_user_id '+
 'AND c.consumed_at=o.occurred_at AND c.auth_version+1=m.auth_version '+
 'AND z.environment=?) AS committed_challenges,'+
 '(SELECT COUNT(*) FROM starry_sessions s WHERE s.s_user_id=o.s_user_id) AS total_sessions,'+
 '(SELECT COUNT(*) FROM starry_sessions s WHERE s.s_user_id=o.s_user_id '+
 'AND (s.revoked_at IS NULL OR s.revoked_at>o.occurred_at)) AS unsafe_sessions '+
 'FROM starry_deletion_outbox o '+
 'JOIN starry_members m ON m.s_user_id=o.s_user_id '+
 "WHERE o.event_id=? AND o.event_type='account_deleted' "+
 "AND m.status='deleted' AND m.updated_at=o.occurred_at "+
 'AND m.display_name IS NULL AND m.directory_opt_in=0 '+
 'AND m.display_name_public=0 LIMIT 1';

type Timeline=Readonly<{
 event_id:unknown;s_user_id:unknown;occurred_at:unknown;
 event_type:unknown;auth_version:unknown;committed_challenges:unknown;
 total_sessions:unknown;unsafe_sessions:unknown;
}>;
const safe=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const match=(v:Timeline|null,c:AuthDeletionDispatchClaim):v is Timeline=>
 !!v&&v.event_id===c.event.event_id&&v.s_user_id===c.event.member_ref&&
 v.occurred_at===c.event.occurred_at_sec&&v.event_type==='account_deleted'&&
 safe(v.auth_version)&&v.auth_version>=2&&
 v.committed_challenges===1&&safe(v.total_sessions)&&v.total_sessions>=1&&
 v.unsafe_sessions===0;
const stable=(a:Timeline,b:Timeline)=>
 a.event_id===b.event_id&&a.s_user_id===b.s_user_id&&
 a.occurred_at===b.occurred_at&&a.event_type===b.event_type&&
 a.auth_version===b.auth_version&&
 a.committed_challenges===b.committed_challenges&&
 a.total_sessions===b.total_sessions&&a.unsafe_sessions===b.unsafe_sessions;

export type AuthR18SourceReview=Readonly<{
 disposition:'offline_auth_source_review_only';
 event_id:string;attempt_no:number;auth_version:number;
 may_ack_queue:false;may_mark_delivered:false;may_regrant:false;
 may_restore:false;may_publish:false;live:false;
}>;

export function createOfflineAuthCommittedSagaPreflight(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionEventScope;db:D1Database;
 lawfulDeletionProcessingApprovedNow:()=>Promise<boolean>;
 lawfulMinimalRetentionApprovedNow:()=>Promise<boolean>;
 readServerNow:()=>number;
}>) {
 if(typeof deps.lawfulMinimalRetentionApprovedNow!=='function')
  throw Error('AUTH_R18_RETENTION_POLICY_REQUIRED');
 // These constructors enforce strict Starry development/staging scope and
 // safe server-only Auth ports. They never give out live network controls.
 const source=createOfflineAuthDeletionEventSource({
  enabled:deps.enabled===true,scope:deps.scope,db:deps.db,
  legalDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  readServerNow:deps.readServerNow
 });
 const fence=createOfflineAuthLeaseFence({
  enabled:deps.enabled===true,scope:deps.scope,db:deps.db,
  lawfulDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  readServerNow:deps.readServerNow
 });
 const enabled=deps.enabled===true,scope=Object.freeze({...deps.scope});
 const policy=async()=>await deps.lawfulDeletionProcessingApprovedNow()===true&&
   await deps.lawfulMinimalRetentionApprovedNow()===true;
 const read=async(eventId:string)=>deps.db.prepare(AUTH_R18_COMMITTED_TIMELINE_SQL)
  .bind(scope.environment,eventId).first<Timeline>();
 return Object.freeze({
  async inspect(value:unknown):Promise<AuthR18SourceReview|null>{
   if(!enabled||!isSealedAuthDeletionDispatchClaim(value))return null;
   const claim=value;
   try{
    // BEFORE any DB read: legal-purpose and separately approved minimal
    // retention must each be TRUE now. Unknown, false and errors deny.
    if(!await policy())return null;
    const a=await read(claim.event.event_id);
    if(!match(a,claim))return null;
    const first=await source.readCommitted(claim.event.event_id);
    if(!first||!isConsistent(first,a))return null;
    // R17 verifies current claim token/attempt and current Auth deletion
    // twice. Its observation is NOT a transport/ACK capability.
    const observed=await fence.observeCurrentLease(claim);
    if(!observed||observed.attempt_no!==claim.attempt_no)return null;
    if(!await policy())return null;
    const b=await read(claim.event.event_id);
    if(!match(b,claim)||!stable(a,b))return null;
    const second=await source.readCommitted(claim.event.event_id);
    if(!second||!isConsistent(second,b))return null;
    if(!await policy())return null;
    const now=deps.readServerNow();
    if(!safe(now)||now>=claim.lease_expires_at)return null;
    return Object.freeze({
     disposition:'offline_auth_source_review_only' as const,
     event_id:claim.event.event_id,attempt_no:claim.attempt_no,
     auth_version:second.auth_version,
     may_ack_queue:false as const,may_mark_delivered:false as const,
     may_regrant:false as const,may_restore:false as const,
     may_publish:false as const,live:false as const
    });
   }catch{return null;}
  },
  // There is intentionally no publish/send/ack/regrant/restore method.
  status:'CANDIDATE_ONLY_EXTERNAL_SIGNER_AND_Q104_Q119_UNAPPROVED' as const
 });
}
function isConsistent(
 source:Readonly<{event_id:string;s_user_id:string;occurred_at:number;
 auth_version:number;event_type:'account_deleted'}>,row:Timeline
):boolean {
 return source.event_id===row.event_id&&source.s_user_id===row.s_user_id&&
  source.occurred_at===row.occurred_at&&source.auth_version===row.auth_version&&
  source.event_type===row.event_type;
}
