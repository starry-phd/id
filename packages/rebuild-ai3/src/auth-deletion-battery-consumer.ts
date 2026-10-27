/**
 * AI-3 R14: OFFLINE one-statement Starry Auth deletion -> free Battery
 * tombstone / held reservation revocation / append-only journal/inbox.
 * The Auth D1 commit is a SEPARATE authority, never a cross-D1 transaction.
 * No public endpoint, real D1, live Queue, Secrets or paid services.
 */
export const LIVE_BATTERY_DELETION_CONSUMER_ENABLED=false as const;
export type StarryDeletionScope=Readonly<{
 brand_id:'starry';environment:'development'|'staging';
}>;
/** Exact minimal format of AI-1 R13 immutable account_deleted outbox. */
export type AuthDeletionEvent=Readonly<{
 event_id:string;member_ref:string;occurred_at_sec:number;
 event_type:'account_deleted';
}>;
export type BatteryDeletionResult=Readonly<{
 disposition:'receipt_only'|'retry';reason:string;may_regrant:false;
 may_ack_queue:false;live:false;
}>;
type Value=string|number;
export type DeletionSqlPort=Readonly<{
 prepare:(sql:string)=>Readonly<{
  bind:(...values:Value[])=>Readonly<{
   run:()=>Promise<Readonly<{success:boolean;meta?:Readonly<{changes?:number}>}>>;
   first:<T extends object>()=>Promise<T|null>;
  }>;
 }>;
}>;
/** Trusted server injected ONLY; never delegated to a request or client JSON. */
export type DeletionAuthAuthority=Readonly<{
 // Must re-check unique durable AI-1 Auth outbox event_id and deleted member,
 // not merely a client boolean or cached session snapshot.
 verifyCommittedDeletion:(scope:StarryDeletionScope,event:AuthDeletionEvent)=>Promise<boolean>;
 // Battery-authority policy version. X/Y amounts are NOT approved or used here.
 readApprovedBatteryPolicyVersion:(scope:StarryDeletionScope)=>Promise<number|null>;
}>;
const MEMBER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const n=(v:unknown):v is number=>typeof v==='number'&&
 Number.isSafeInteger(v)&&v>=0;
const FIELDS=['event_id','member_ref','occurred_at_sec','event_type'] as const;
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(v===null||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return null;
  const names=Reflect.ownKeys(v);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||d.enumerable!==true||!('value' in d))return null;
   out[k]=d.value;
  }
  return out;
 }catch{return null;}
}
function parse(input:unknown,now_ms:number):AuthDeletionEvent|null{
 const q=exact(input,FIELDS);
 if(!q||typeof q.event_id!=='string'||!EVENT.test(q.event_id)||
  typeof q.member_ref!=='string'||!MEMBER.test(q.member_ref)||
  !n(q.occurred_at_sec)||q.event_type!=='account_deleted'||
  !Number.isSafeInteger(q.occurred_at_sec*1000)||
  q.occurred_at_sec*1000>now_ms)return null;
 return Object.freeze({event_id:q.event_id,member_ref:q.member_ref,
  occurred_at_sec:q.occurred_at_sec,event_type:'account_deleted'});
}
const fail=(reason:string):BatteryDeletionResult=>Object.freeze({
 disposition:'retry',reason,may_regrant:false,may_ack_queue:false,live:false
});
const ok=():BatteryDeletionResult=>Object.freeze({
 disposition:'receipt_only',reason:'BATTERY_LOCAL_REVOCATION_RECORDED',
 may_regrant:false,may_ack_queue:false,live:false
});
export const BATTERY_DELETE_SQL=Object.freeze({
 apply:'INSERT INTO ai3_r14_deletion_inbox '+
  '(brand_id,environment,event_id,member_ref,event_type,occurred_at_ms,policy_version,applied) '+
  'VALUES (?,?,?,?,?,?,?,0)',
 receipt:'SELECT i.applied,w.revoked,w.balance,w.version,j.revision AS journal_revision,'+
  'j.kind,j.delta,j.balance_after,j.reason_code,'+
  '(SELECT COUNT(*) FROM ai3_battery_hold h WHERE h.brand_id=? '+
  "AND h.member_ref=i.member_ref AND h.status='held') AS pending_holds "+
  'FROM ai3_r14_deletion_inbox i '+
  'JOIN ai3_battery_wallet w ON w.member_ref=i.member_ref AND w.brand_id=i.brand_id '+
  'JOIN ai3_battery_journal j ON j.brand_id=i.brand_id AND j.member_ref=i.member_ref '+
  "AND j.event_ref=i.event_id AND j.kind='revoke' "+
  'WHERE i.brand_id=? AND i.environment=? AND i.member_ref=? AND i.event_id=?'
});
/**
 * One INSERT + SQLite AFTER INSERT trigger atomically writes four AI-3
 * resources inside ONE Battery D1 database:
 * inbox, revoke journal, pending holds, and wallet zero/revoked/version.
 * Replay/collision must fail without ANY partial Battery mutation.
 * A positive receipt only means local OFFLINE DB proof; it NEVER authorizes
 * cross-D1 Auth deletion completion, Queue ACK, X/Y or restore.
 */
export function createOfflineAuthDeletionBatteryConsumer(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionScope;db:DeletionSqlPort;
 authority:DeletionAuthAuthority;
}>){
 const scope=exact(deps?.scope,['brand_id','environment']);
 if(!scope||scope.brand_id!=='starry'||
  (scope.environment!=='development'&&scope.environment!=='staging'))
  throw Error('AI3_R14_SCOPE_DENIED');
 if(!deps.db||typeof deps.db.prepare!=='function'||!deps.authority||
  typeof deps.authority.verifyCommittedDeletion!=='function'||
  typeof deps.authority.readApprovedBatteryPolicyVersion!=='function')
  throw Error('AI3_R14_SERVER_PORTS_REQUIRED');
 const immutableScope:StarryDeletionScope=Object.freeze({
  brand_id:'starry',environment:scope.environment as StarryDeletionScope['environment']
 });
 const enabled=deps.enabled===true;
 return Object.freeze({
  async consume(event:unknown,serverNowMs:number):Promise<BatteryDeletionResult>{
   if(!enabled)return fail('DISABLED');
   if(!n(serverNowMs))return fail('INVALID_SERVER_TIME');
   const q=parse(event,serverNowMs);
   if(!q)return fail('UNTRUSTED_AUTH_OUTBOX_DTO');
   try{
    if(await deps.authority.verifyCommittedDeletion(immutableScope,q)!==true)
     return fail('AUTH_DELETE_NOT_AUTHENTICATED');
    const policy=await deps.authority.readApprovedBatteryPolicyVersion(immutableScope);
    if(!n(policy)||policy<1)return fail('BATTERY_POLICY_NOT_AUTHORIZED');
    const updated=await deps.db.prepare(BATTERY_DELETE_SQL.apply).bind(
     'starry',immutableScope.environment,q.event_id,q.member_ref,
     'account_deleted',q.occurred_at_sec*1000,policy).run();
    if(updated?.success!==true||updated.meta?.changes!==1)
     return fail('BATTERY_DB_COMMIT_UNCONFIRMED');
    // Post-commit readback can itself fail. Retry (without Queue ACK) is safe:
    // immutable unique inbox and journal prevent a second mutation on replay.
    const row=await deps.db.prepare(BATTERY_DELETE_SQL.receipt)
     .bind('starry','starry',immutableScope.environment,q.member_ref,q.event_id)
     .first<Record<string,unknown>>();
    const r=exact(row,['applied','revoked','balance','version','journal_revision',
     'kind','delta','balance_after','reason_code','pending_holds']);
    if(!r||r.applied!==1||r.revoked!==1||r.balance!==0||
     !n(r.version)||r.version===0||r.journal_revision!==r.version||
     r.kind!=='revoke'||!Number.isSafeInteger(r.delta)||
     r.balance_after!==0||r.reason_code!=='ACCOUNT_DELETED'||r.pending_holds!==0)
     return fail('BATTERY_RECEIPT_NOT_DURABLE');
    return ok();
   }catch{return fail('AUTH_OR_LOCAL_DB_UNAVAILABLE');}
  }
 });
}
