/** AI-2 R17 OFFLINE ONLY: Billing delete inbox readback/PITR review.
 * Not a trusted real independent anchor, Store authority, live ACK, or grant.
 */
import type {DeleteScope} from './account-deletion-fence.ts';
export const LIVE_BILLING_R17_REVIEW_ENABLED=false as const;
export const BILLING_R17_REVIEW_PUBLISHABLE=false as const;
export const BILLING_R17_ACK_ALLOWED=false as const;
export type ReviewRequest=Readonly<{
 source_event_id:string;source_commit_ref:string;member_ref:string;
 event_ref:string;event_digest:string;auth_version:number;occurred_at_sec:number;
}>;
export type ReviewOutcome=Readonly<{
 status:'disabled'|'blocked'|'review_only';reason:string;
 may_ack_queue:false;may_grant:false;may_restore:false;live:false;
}>;
export type ReviewPorts=Readonly<{
 lawfulMinimalRetentionApproved:()=>Promise<boolean>;
 readCurrentDeletedAuth:(eventId:string)=>Promise<unknown>;
 readIndependentFloorCandidate:(memberRef:string)=>Promise<unknown>;
}>;
type ReviewDb=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...args:string[])=>Readonly<{
 first:<T extends Record<string,unknown>>()=>Promise<T|null>;
 }>;
}>}>;
const F=['source_event_id','source_commit_ref','member_ref','event_ref',
 'event_digest','auth_version','occurred_at_sec'] as const;
const A=['status',...F] as const;
const W=['source_event_id','event_ref','auth_version','status'] as const;
const B=[...F,'tombstone_version','tombstone_event_ref',
 'tombstone_digest','active_candidates'] as const;
const e=/^[A-Za-z0-9._:-]{20,180}$/,r=/^r_[a-f0-9]{64}$/,m=/^m_[a-f0-9]{64}$/,h=/^[a-f0-9]{64}$/;
const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function exact(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const d=Object.getOwnPropertyDescriptors(x);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   if(!Object.hasOwn(d,k)||!d[k].enumerable||!('value' in d[k]))return null;
   out[k]=d[k].value;
  }
  return out;
 }catch{return null;}
}
const answer=(status:ReviewOutcome['status'],reason:string):ReviewOutcome=>
 Object.freeze({status,reason,may_ack_queue:false,may_grant:false,may_restore:false,live:false});
function parse(x:unknown):ReviewRequest|null{
 const a=exact(x,F);
 if(!a||typeof a.source_event_id!=='string'||!e.test(a.source_event_id)
  ||typeof a.source_commit_ref!=='string'||!r.test(a.source_commit_ref)
  ||typeof a.member_ref!=='string'||!m.test(a.member_ref)
  ||typeof a.event_ref!=='string'||!r.test(a.event_ref)
  ||typeof a.event_digest!=='string'||!h.test(a.event_digest)
  ||!integer(a.auth_version)||a.auth_version<2
  ||!integer(a.occurred_at_sec)||a.occurred_at_sec===0)return null;
 return Object.freeze({
  source_event_id:a.source_event_id,source_commit_ref:a.source_commit_ref,
  member_ref:a.member_ref,event_ref:a.event_ref,event_digest:a.event_digest,
  auth_version:a.auth_version,occurred_at_sec:a.occurred_at_sec,
 });
}
function current(x:unknown,v:ReviewRequest){
 const a=exact(x,A);
 return a!==null&&a.status==='deleted'&&F.every(k=>a[k]===v[k]);
}
function floor(x:unknown,v:ReviewRequest){
 const a=exact(x,W);
 return a!==null&&a.status==='deleted'&&a.auth_version===v.auth_version
  &&a.event_ref===v.event_ref&&a.source_event_id===v.source_event_id;
}
/** Same-connection SQL visibility is NOT independent committed-read proof. */
export const BILLING_R17_READBACK_SQL=[
 'SELECT i.source_event_id,i.source_commit_ref,i.member_ref,i.event_ref,',
 'i.event_digest,i.auth_version,i.occurred_at_sec,',
 'f.deleted_version AS tombstone_version,f.event_ref AS tombstone_event_ref,',
 'f.event_digest AS tombstone_digest,',
 '(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c',
 'WHERE c.member_ref=i.member_ref AND c.environment=i.environment',
 "AND c.candidate_state='candidate_active') AS active_candidates",
 'FROM billing_delete_inbox_R16_DRAFT i',
 'JOIN billing_deletion_fence_DRAFT f ON f.member_ref=i.member_ref',
 'AND f.brand_id=i.brand_id AND f.environment=i.environment',
 "WHERE i.brand_id='starry' AND i.environment=? AND i.source_event_id=?",
].join(' ');
function rowOK(x:unknown,v:ReviewRequest){
 const a=exact(x,B);
 return a!==null&&F.every(k=>a[k]===v[k])
  &&a.tombstone_version===v.auth_version&&a.tombstone_event_ref===v.event_ref
  &&a.tombstone_digest===v.event_digest&&a.active_candidates===0;
}
export function createOfflineBillingDeletionReadbackReview(deps:Readonly<{
 enabled?:boolean;scope:DeleteScope;db:ReviewDb;ports:ReviewPorts;
}>){
 const s=exact(deps?.scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'
  ||(s.environment!=='development'&&s.environment!=='staging')
  ||typeof deps.db?.prepare!=='function'
  ||typeof deps.ports?.lawfulMinimalRetentionApproved!=='function'
  ||typeof deps.ports?.readCurrentDeletedAuth!=='function'
  ||typeof deps.ports?.readIndependentFloorCandidate!=='function')
  throw Error('BILLING_R17_CONFIG_DENIED');
 const environment=s.environment as string;
 return Object.freeze({
  async inspect(input:unknown):Promise<ReviewOutcome>{
   if(deps.enabled!==true)return answer('disabled','DISABLED');
   const v=parse(input);
   if(!v)return answer('blocked','INVALID_RECEIPT');
   try{
    if(await deps.ports.lawfulMinimalRetentionApproved()!==true)
     return answer('blocked','LEGAL_RETENTION_REQUIRED');
    if(!current(await deps.ports.readCurrentDeletedAuth(v.source_event_id),v))
     return answer('blocked','AUTH_DIVERGED');
    if(!floor(await deps.ports.readIndependentFloorCandidate(v.member_ref),v))
     return answer('blocked','INDEPENDENT_FLOOR_MISSING');
    const read=await deps.db.prepare(BILLING_R17_READBACK_SQL)
     .bind(environment,v.source_event_id).first<Record<string,unknown>>();
    if(!rowOK(read,v))return answer('blocked','BILLING_OR_ENTITLEMENT_DIVERGED');
    if(!current(await deps.ports.readCurrentDeletedAuth(v.source_event_id),v))
     return answer('blocked','AUTH_CHANGED_AFTER_READ');
    if(!floor(await deps.ports.readIndependentFloorCandidate(v.member_ref),v))
     return answer('blocked','FLOOR_CHANGED_AFTER_READ');
    return answer('review_only','LOCAL_CANDIDATE_RECEIPTS_MATCH');
   }catch{return answer('blocked','AUTHORITY_OR_DB_UNAVAILABLE');}
  },
 });
}
