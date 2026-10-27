/**
 * AI-4 R15 OFFLINE-only, server-owned translation of REAL AI-1 account_deleted
 * outbox into AI-3's narrow Battery DTO. NEVER trusts client event JSON.
 * Billing's HMAC/digest/version are NOT in AI-1 raw outbox; no fabrication.
 * No real D1/Queue/Worker handler, independent witness or cross-D1 atomicity.
 */
export const LIVE_AUTH_DELETION_RELAY=false as const;
export const DELETION_RELAY_VERSION='starry.account-deleted-relay.v0-draft' as const;
export type RelayScope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
export type AuthOutbox=Readonly<{
 event_id:string;s_user_id:string;occurred_at:number;event_type:'account_deleted';
}>;
export type AuthContext=Readonly<{
 event_id:string;s_user_id:string;environment:'development'|'staging';consumed_at:number;
}>;
export type DeletedMember=Readonly<{
 s_user_id:string;status:'deleted';auth_version:number;updated_at:number;
}>;
export type BatteryDeletionCandidate=Readonly<{
 event_id:string;member_ref:string;occurred_at_sec:number;event_type:'account_deleted';
}>;
export type RelayResult=Readonly<{
 status:'verified_offline_candidate'|'blocked';reason:string;
 battery_event:BatteryDeletionCandidate|null;
 billing_status:'blocked_missing_authoritative_hmac_digest_version';
 task_status:'blocked_no_cross_db_fence';
 may_ack_queue:false;may_regrant:false;live:false;
}>;
export type AuthPorts=Readonly<{
 lawfulRelayApproved:(scope:RelayScope)=>Promise<boolean>;
 readCommittedOutbox:(eventRef:string)=>Promise<unknown>;
 readDeletionContext:(eventRef:string)=>Promise<unknown>;
 readCurrentDeletedMember:(memberRef:string)=>Promise<unknown>;
 readUnrevokedSessions:(memberRef:string)=>Promise<unknown>;
}>;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const num=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const portNames=['lawfulRelayApproved','readCommittedOutbox','readDeletionContext',
 'readCurrentDeletedMember','readUnrevokedSessions'] as const;
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return null;
  const k=Reflect.ownKeys(v);
  if(k.length!==keys.length||k.some(x=>typeof x!=='string'||!keys.includes(x)))
   return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of keys){
   const d=Object.getOwnPropertyDescriptor(v,key);
   if(!d||d.enumerable!==true||!('value' in d))return null;
   out[key]=d.value;
  }
  return out;
 }catch{return null;}
}
const blocked=(reason:string):RelayResult=>Object.freeze({
 status:'blocked',reason,battery_event:null,
 billing_status:'blocked_missing_authoritative_hmac_digest_version',
 task_status:'blocked_no_cross_db_fence',may_ack_queue:false,may_regrant:false,live:false
});
export function createOfflineDeletionEventRelay(scope:RelayScope,ports:AuthPorts){
 const s=exact(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||
  (s.environment!=='development'&&s.environment!=='staging'))
  throw Error('AI4_R15_SCOPE_DENIED');
 const p=exact(ports,portNames);
 if(!p||portNames.some(k=>typeof p[k]!=='function'))
  throw Error('AI4_R15_AUTH_PORTS_REQUIRED');
 const immutableScope:RelayScope=Object.freeze({
  brand_id:'starry',environment:s.environment as RelayScope['environment']
 });
 return Object.freeze({
  async inspect(eventRef:unknown,serverNowSec:unknown):Promise<RelayResult>{
   if(!LIVE_AUTH_DELETION_RELAY && !num(serverNowSec,1))return blocked('INVALID_SERVER_CLOCK');
   if(typeof eventRef!=='string'||!EVENT.test(eventRef))
    return blocked('INVALID_OPAQUE_EVENT_REF');
   if(!num(serverNowSec,1))return blocked('INVALID_SERVER_CLOCK');
   try{
    // FIRST CHECK legal purpose: no Auth member/session data before approval.
    if(await ports.lawfulRelayApproved(immutableScope)!==true)
     return blocked('LAWFUL_RELAY_NOT_APPROVED');
    // Authoritative data MUST originate server-side from committed AI-1 Auth DB,
    // not from the Queue body, JWT, signature:true, or client-provided hash.
    const row=exact(await ports.readCommittedOutbox(eventRef),
     ['event_id','s_user_id','occurred_at','event_type']);
    if(!row||row.event_id!==eventRef||row.event_type!=='account_deleted'||
     typeof row.s_user_id!=='string'||!ID.test(row.s_user_id)||
     !num(row.occurred_at,1)||row.occurred_at>serverNowSec||
     !num(row.occurred_at*1000))return blocked('COMMITTED_AUTH_OUTBOX_MISMATCH');
    const ctx=exact(await ports.readDeletionContext(eventRef),
     ['event_id','s_user_id','environment','consumed_at']);
    if(!ctx||ctx.event_id!==row.event_id||ctx.s_user_id!==row.s_user_id||
     ctx.environment!==immutableScope.environment||
     ctx.consumed_at!==row.occurred_at)
     return blocked('DELETION_CHALLENGE_SCOPE_MISMATCH');
    const current=exact(await ports.readCurrentDeletedMember(row.s_user_id),
     ['s_user_id','status','auth_version','updated_at']);
    if(!current||current.s_user_id!==row.s_user_id||current.status!=='deleted'||
     !num(current.auth_version,2)||current.updated_at!==row.occurred_at)
     return blocked('CURRENT_AUTH_MEMBER_NOT_DELETED');
    if(await ports.readUnrevokedSessions(row.s_user_id)!==0)
     return blocked('AUTH_SESSIONS_NOT_FULLY_REVOKED');
    // After verification, RECHECK original committed source, not just JS ref.
    const rowAgain=exact(await ports.readCommittedOutbox(eventRef),
     ['event_id','s_user_id','occurred_at','event_type']);
    if(!rowAgain||['event_id','s_user_id','occurred_at','event_type']
     .some(k=>rowAgain[k]!==row[k]))
     return blocked('AUTH_OUTBOX_CHANGED_DURING_RELAY');
    const event:BatteryDeletionCandidate=Object.freeze({
     event_id:row.event_id as string,member_ref:row.s_user_id as string,
     occurred_at_sec:row.occurred_at as number,event_type:'account_deleted'
    });
    return Object.freeze({
     status:'verified_offline_candidate',reason:'AUTH_SOURCE_READBACK_CONSISTENT',
     battery_event:event,
     billing_status:'blocked_missing_authoritative_hmac_digest_version',
     task_status:'blocked_no_cross_db_fence',
     may_ack_queue:false,may_regrant:false,live:false
    });
   }catch{return blocked('AUTH_OR_LEGAL_SOURCE_UNAVAILABLE');}
  }
 });
}
