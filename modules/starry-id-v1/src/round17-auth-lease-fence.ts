/**
 * AI-1 R17: default-OFF read-only Auth lease revalidation. A successful
 * observation NEVER grants transport, Queue ACK, entitlement or recovery.
 */
import {isSealedAuthDeletionDispatchClaim, AUTH_CANONICAL_PUBLISHER_ID} from './round16-canonical-deletion-publisher.ts';
import type {AuthDeletionDispatchClaim} from './round16-canonical-deletion-publisher.ts';
import {createOfflineAuthDeletionEventSource} from './round15-deletion-source-contract.ts';
import type {StarryDeletionEventScope} from './round15-deletion-source-contract.ts';
import type {D1Database} from './d1-ports.ts';

export const LIVE_AUTH_LEASE_FENCE_ENABLED=false as const;
export const AUTH_FENCE_TRANSPORT_ACK_ALLOWED=false as const;
const safe=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const token=/^[0-9a-f]{64}$/;
const validScope=(s:unknown):s is StarryDeletionEventScope=>{
 try{
  if(!s||typeof s!=='object'||Array.isArray(s))return false;
  const o=s as object,keys=Reflect.ownKeys(o),d=Object.getOwnPropertyDescriptors(o);
  return (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null)&&
   keys.length===2&&keys.every(k=>k==='brand_id'||k==='environment')&&
   d.brand_id?.enumerable===true&&'value' in d.brand_id&&
   d.environment?.enumerable===true&&'value' in d.environment&&
   d.brand_id.value==='starry'&&
   (d.environment.value==='development'||d.environment.value==='staging');
 }catch{return false;}
};

/** Read-only Auth DB lease, original outbox, challenge, member and session join. */
export const AUTH_LEASE_FENCE_SQL=
 'SELECT d.event_id,d.publisher_id,d.lease_token,d.lease_expires_at,d.attempt_no,'+
 'o.s_user_id,o.occurred_at,o.event_type '+
 'FROM starry_auth_deletion_dispatch_claims d '+
 'JOIN starry_deletion_outbox o ON o.event_id=d.event_id '+
 'JOIN starry_members m ON m.s_user_id=o.s_user_id '+
 'JOIN starry_deletion_challenges c ON c.event_id=o.event_id '+
 'AND c.s_user_id=o.s_user_id AND c.consumed_at=o.occurred_at '+
 'JOIN starry_deletion_challenge_scope z ON z.challenge_ref=c.challenge_ref '+
 "WHERE d.event_id=? AND d.lease_token=? AND d.attempt_no=? "+
 "AND d.publisher_id='starry-auth-sole-v1' "+
 'AND z.environment=? AND d.lease_expires_at>? '+
 "AND o.event_type='account_deleted' AND o.occurred_at<=? "+
 "AND m.status='deleted' AND m.auth_version=c.auth_version+1 "+
 'AND m.updated_at=o.occurred_at AND m.display_name IS NULL '+
 'AND m.directory_opt_in=0 AND m.display_name_public=0 '+
 'AND length(o.s_user_id)<=96 '+
 'AND NOT EXISTS (SELECT 1 FROM starry_sessions s '+
 'WHERE s.s_user_id=m.s_user_id AND s.revoked_at IS NULL) LIMIT 1';

type Row={event_id:unknown;publisher_id:unknown;lease_token:unknown;
 lease_expires_at:unknown;attempt_no:unknown;s_user_id:unknown;
 occurred_at:unknown;event_type:unknown};
export type OfflineLeaseFenceObservation=Readonly<{
 disposition:'offline_current_lease_observation_only';
 event_id:string;attempt_no:number;lease_expires_at:number;
 may_ack_queue:false;may_mark_delivered:false;may_regrant:false;live:false;
}>;
export function createOfflineAuthLeaseFence(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionEventScope;db:D1Database;
 lawfulDeletionProcessingApprovedNow:()=>Promise<boolean>;
 readServerNow:()=>number;
}>) {
 if(!validScope(deps.scope)||typeof deps.db?.prepare!=='function'||
    typeof deps.lawfulDeletionProcessingApprovedNow!=='function'||
    typeof deps.readServerNow!=='function')
  throw Error('AUTH_R17_FENCE_CONFIG_DENIED');
 const scope=Object.freeze({...deps.scope});
 const enabled=deps.enabled===true;
 const source=createOfflineAuthDeletionEventSource({enabled,scope,db:deps.db,
  legalDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  readServerNow:deps.readServerNow});
 const matches=(r:Row|null,c:AuthDeletionDispatchClaim):boolean=>!!r&&
  r.event_id===c.event.event_id&&r.publisher_id===AUTH_CANONICAL_PUBLISHER_ID&&
  r.lease_token===c.lease_token&&r.lease_expires_at===c.lease_expires_at&&
  r.attempt_no===c.attempt_no&&r.s_user_id===c.event.member_ref&&
  r.occurred_at===c.event.occurred_at_sec&&r.event_type==='account_deleted';
 return Object.freeze({
  async observeCurrentLease(value:unknown):Promise<OfflineLeaseFenceObservation|null>{
   if(!enabled||!isSealedAuthDeletionDispatchClaim(value))return null;
   const c=value;
   if(!Object.isFrozen(c)||c.disposition!=='offline_claim_only'||
    c.publisher_id!==AUTH_CANONICAL_PUBLISHER_ID||c.live!==false||
    c.may_ack_queue!==false||c.may_mark_delivered!==false||
    c.may_regrant!==false||!token.test(c.lease_token)||
    !safe(c.attempt_no)||c.attempt_no<1||c.attempt_no>1000||
    !safe(c.lease_expires_at))return null;
   try{
    // Legal-purpose gate must precede ANY Auth database read.
    if(await deps.lawfulDeletionProcessingApprovedNow()!==true)return null;
    const now=deps.readServerNow();
    if(!safe(now)||now>=c.lease_expires_at||
       c.lease_expires_at>now+30)return null;
    const read=async()=>deps.db.prepare(AUTH_LEASE_FENCE_SQL)
     .bind(c.event.event_id,c.lease_token,c.attempt_no,scope.environment,now,now)
     .first<Row>();
    if(!matches(await read(),c))return null;
    // R15 rechecks current lawful state; then fence against lease replacement.
    if(await source.verifyCommittedDeletion(scope,c.event)!==true)return null;
    if(!matches(await read(),c)||deps.readServerNow()>=c.lease_expires_at)
     return null;
    return Object.freeze({
     disposition:'offline_current_lease_observation_only' as const,
     event_id:c.event.event_id,attempt_no:c.attempt_no,
     lease_expires_at:c.lease_expires_at,
     may_ack_queue:false as const,may_mark_delivered:false as const,
     may_regrant:false as const,live:false as const,
    });
   }catch{return null;}
  },
  // No send/publish/ack/markDelivered; NOT a portable cross-D1 proof.
  fence_status:'OFFLINE_ONLY_UNAPPROVED_P05_AND_CROSS_D1' as const,
 });
}
