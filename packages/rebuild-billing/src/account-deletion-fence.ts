/** AI-2 R14 Q88: OFFLINE, default-OFF Billing candidate anti-resurrection.
 * NOT a live Auth outbox consumer, entitled SKU grant, P05, ACK or real D1.
 */
export const LIVE_BILLING_DELETION_CONSUMER_ENABLED=false as const;
export const BILLING_DELETION_ENTITLEMENT_PUBLISHABLE=false as const;
export type DeleteScope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
export type AuthDeletionEvent=Readonly<{
 brand_id:'starry';environment:'development'|'staging';
 event_type:'account_deleted';member_ref:string;event_ref:string;
 event_digest:string;auth_version:number;occurred_at_sec:number;
}>;
export type CommittedAuthDeletion=Readonly<{
 brand_id:'starry';environment:'development'|'staging';status:'deleted';
 member_ref:string;auth_version:number;event_ref:string;event_digest:string;
 deleted_at_sec:number;
}>;
export type DeletionOutcome=Readonly<{
 status:'disabled'|'blocked'|'revoked_candidate';reason:string;
 may_grant:false;may_ack:false;
}>;
type DbArg=string|number;
export type OfflineDeleteDb=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...args:DbArg[])=>Readonly<{
  first:<T extends Record<string,unknown>>()=>Promise<T|null>;
 }>;
}>}>;
export type TrustedDeletePorts=Readonly<{
 lawfulMinimalRetentionApproved:()=>Promise<boolean>;
 verifyCommittedAuthOutbox:(event:AuthDeletionEvent)=>Promise<boolean>;
 readCurrentAuthDeletion:(member_ref:string)=>Promise<CommittedAuthDeletion|null>;
}>;
const M=/^m_[a-f0-9]{64}$/,R=/^r_[a-f0-9]{64}$/,H=/^[a-f0-9]{64}$/;
const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function exact(x:unknown,keys:readonly string[]):x is Record<string,unknown>{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return false;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return false;
  if(Reflect.ownKeys(x).length!==keys.length)return false;
  const d=Object.getOwnPropertyDescriptors(x);
  return keys.every(k=>Object.hasOwn(d,k)&&d[k].enumerable&&'value' in d[k]);
 }catch{return false;}
}
const SCOPE=['brand_id','environment'];
const EVENT=['brand_id','environment','event_type','member_ref','event_ref',
 'event_digest','auth_version','occurred_at_sec'];
const CURRENT=['brand_id','environment','status','member_ref','auth_version',
 'event_ref','event_digest','deleted_at_sec'];
function scopeOK(s:unknown):s is DeleteScope{
 return exact(s,SCOPE)&&s.brand_id==='starry'&&
  (s.environment==='development'||s.environment==='staging');
}
function eventOK(e:unknown,s:DeleteScope,now:number):e is AuthDeletionEvent{
 return exact(e,EVENT)&&e.brand_id==='starry'&&e.environment===s.environment
  &&e.event_type==='account_deleted'
  &&typeof e.member_ref==='string'&&M.test(e.member_ref)
  &&typeof e.event_ref==='string'&&R.test(e.event_ref)
  &&typeof e.event_digest==='string'&&H.test(e.event_digest)
  &&integer(e.auth_version)&&e.auth_version>=1
  &&integer(e.occurred_at_sec)&&e.occurred_at_sec>0
  &&e.occurred_at_sec<=now&&now-e.occurred_at_sec<=604800;
}
function currentOK(a:unknown,e:AuthDeletionEvent):a is CommittedAuthDeletion{
 return exact(a,CURRENT)&&a.brand_id==='starry'&&a.environment===e.environment
  &&a.status==='deleted'&&a.member_ref===e.member_ref
  &&a.auth_version===e.auth_version&&a.event_ref===e.event_ref
  &&a.event_digest===e.event_digest&&a.deleted_at_sec===e.occurred_at_sec;
}
/** Single statement + trigger in SAME Billing DB; no cross-D1 atomic claim. */
export const BILLING_DELETION_FENCE_SQL=[
 'INSERT INTO billing_deletion_fence_DRAFT',
 '(brand_id,environment,member_ref,deleted_version,deleted_at_sec,event_ref,event_digest)',
 "VALUES('starry',?,?,?,?,?,?)",
 'ON CONFLICT(member_ref) DO UPDATE SET',
 'deleted_version=excluded.deleted_version,deleted_at_sec=excluded.deleted_at_sec,',
 'event_ref=excluded.event_ref,event_digest=excluded.event_digest',
 "WHERE billing_deletion_fence_DRAFT.brand_id='starry'",
 'AND billing_deletion_fence_DRAFT.environment=excluded.environment',
 'AND excluded.deleted_version>billing_deletion_fence_DRAFT.deleted_version',
 'AND excluded.deleted_at_sec>=billing_deletion_fence_DRAFT.deleted_at_sec',
 'RETURNING member_ref,deleted_version,event_ref',
].join(' ');
const result=(status:DeletionOutcome['status'],reason:string):DeletionOutcome=>
 Object.freeze({status,reason,may_grant:false,may_ack:false});
export function createOfflineBillingAccountDeletionFence(deps:Readonly<{
 enabled?:boolean;scope:DeleteScope;db:OfflineDeleteDb;ports:TrustedDeletePorts;
}>){
 if(!scopeOK(deps?.scope)||typeof deps.db?.prepare!=='function'
  ||typeof deps.ports?.lawfulMinimalRetentionApproved!=='function'
  ||typeof deps.ports.verifyCommittedAuthOutbox!=='function'
  ||typeof deps.ports.readCurrentAuthDeletion!=='function')
  throw Error('BILLING_DELETE_CONFIG_DENIED');
 const s=Object.freeze({...deps.scope});
 return Object.freeze({
  async consume(e:unknown,now:number):Promise<DeletionOutcome>{
   if(deps.enabled!==true)return result('disabled','DISABLED');
   if(!integer(now)||now===0||!eventOK(e,s,now))
    return result('blocked','INVALID_OR_EXPIRED_AUTH_EVENT');
   try{
    // No Auth/D1 read before a lawful purpose + minimal retention approval.
    if(await deps.ports.lawfulMinimalRetentionApproved()!==true)
     return result('blocked','LAWFUL_RETENTION_REQUIRED');
    if(await deps.ports.verifyCommittedAuthOutbox(e)!==true)
     return result('blocked','AUTH_OUTBOX_UNVERIFIED');
    const current=await deps.ports.readCurrentAuthDeletion(e.member_ref);
    if(!currentOK(current,e))
     return result('blocked','CURRENT_AUTH_NOT_DELETED_OR_DIVERGED');
    const row=await deps.db.prepare(BILLING_DELETION_FENCE_SQL)
     .bind(s.environment,e.member_ref,e.auth_version,e.occurred_at_sec,
      e.event_ref,e.event_digest).first<Record<string,unknown>>();
    if(row===null)return result('blocked','REPLAY_OR_STALE_AUTH_VERSION');
    if(!exact(row,['member_ref','deleted_version','event_ref'])
     ||row.member_ref!==e.member_ref||row.deleted_version!==e.auth_version
     ||row.event_ref!==e.event_ref)
     return result('blocked','BILLING_DB_RESULT_UNTRUSTED');
    return result('revoked_candidate','BILLING_TOMBSTONE_COMMITTED');
   }catch{return result('blocked','AUTHORITY_OR_BILLING_DB_UNAVAILABLE');}
  },
 });
}
