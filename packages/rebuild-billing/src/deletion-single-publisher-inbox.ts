/** AI-2 R16: OFFLINE sole-CANDIDATE Auth publisher + Billing atomic inbox.
 * Publisher identity is NOT AI-0 approved. No live Queue ACK/Store/P05.
 */
import type {DeleteScope} from './account-deletion-fence.ts';
export const LIVE_BILLING_DELETE_INBOX_ENABLED=false as const;
export const BILLING_DELETE_INBOX_PUBLISHABLE=false as const;
export const BILLING_DELETE_INBOX_ACK_ALLOWED=false as const;
export const BILLING_R16_PUBLISHER_ID='starry.auth.account_deleted.v1.offline_candidate' as const;
export type SignedBillingDeleteCandidate=Readonly<{
 version:1;brand_id:'starry';environment:'development'|'staging';
 publisher_id:typeof BILLING_R16_PUBLISHER_ID;source_event_id:string;
 source_commit_ref:string;member_ref:string;event_ref:string;event_digest:string;
 auth_version:number;occurred_at_sec:number;issued_at_sec:number;
 expires_at_sec:number;key_id:string;signature:string;
}>;
export type BillingAuthDeletion=Readonly<{
 status:'deleted';source_event_id:string;source_commit_ref:string;
 member_ref:string;event_ref:string;event_digest:string;auth_version:number;
 occurred_at_sec:number;
}>;
export type BillingDeleteAuthority=Readonly<{
 lawfulMinimalRetentionApproved:()=>Promise<boolean>;
 verifyCommittedOrigin:(receipt:SignedBillingDeleteCandidate)=>Promise<boolean>;
 readCurrentDeletedAuth:(sourceEventId:string)=>Promise<unknown>;
}>;
export type BillingInboxDb=Readonly<{
 prepare:(sql:string)=>Readonly<{bind:(...args:(number|string)[])=>Readonly<{
 first:<T extends Record<string,unknown>>()=>Promise<T|null>;
 }> }>;
}>;
export type InboxOutcome=Readonly<{
 status:'disabled'|'blocked'|'recorded_offline';reason:string;
 may_ack_queue:false;may_grant:false;live:false;
}>;
const FIELDS=['version','brand_id','environment','publisher_id','source_event_id',
 'source_commit_ref','member_ref','event_ref','event_digest','auth_version',
 'occurred_at_sec','issued_at_sec','expires_at_sec','key_id','signature'] as const;
const AUTH=['status','source_event_id','source_commit_ref','member_ref','event_ref',
 'event_digest','auth_version','occurred_at_sec'] as const;
const HEX=/^[a-f0-9]{64}$/,REF=/^r_[a-f0-9]{64}$/,MEMBER=/^m_[a-f0-9]{64}$/;
const EVENT=/^[A-Za-z0-9._:-]{20,180}$/,KID=/^[A-Za-z0-9._:-]{1,96}$/;
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function safe(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const desc=Object.getOwnPropertyDescriptors(x);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of keys){
   if(!Object.hasOwn(desc,key)||!desc[key].enumerable||!('value' in desc[key]))
    return null;
   out[key]=desc[key].value;
  }
  return out;
 }catch{return null;}
}
function decode(s:unknown):ArrayBuffer|null{
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(s))return null;
 try{
  const enc=s.replace(/-/g,'+').replace(/_/g,'/');
  const text=atob(enc+'='.repeat((4-enc.length%4)%4));
  if(btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==s)return null;
  const b=new ArrayBuffer(text.length),v=new Uint8Array(b);
  for(let i=0;i<text.length;i++)v[i]=text.charCodeAt(i);
  return b;
 }catch{return null;}
}
function parse(x:unknown,scope:DeleteScope,keyId:string,now:number){
 const o=safe(x,FIELDS);
 if(!o||o.version!==1||o.brand_id!=='starry'
  ||o.environment!==scope.environment||o.publisher_id!==BILLING_R16_PUBLISHER_ID
  ||typeof o.source_event_id!=='string'||!EVENT.test(o.source_event_id)
  ||typeof o.source_commit_ref!=='string'||!REF.test(o.source_commit_ref)
  ||typeof o.member_ref!=='string'||!MEMBER.test(o.member_ref)
  ||typeof o.event_ref!=='string'||!REF.test(o.event_ref)
  ||typeof o.event_digest!=='string'||!HEX.test(o.event_digest)
  ||!integer(o.auth_version)||o.auth_version<2
  ||!integer(o.occurred_at_sec)||o.occurred_at_sec===0
  ||o.occurred_at_sec>now||now-o.occurred_at_sec>604800
  ||!integer(o.issued_at_sec)||!integer(o.expires_at_sec)
  ||o.issued_at_sec>now||o.expires_at_sec<=now
  ||o.expires_at_sec<=o.issued_at_sec
  ||o.expires_at_sec-o.issued_at_sec>30||o.key_id!==keyId)return null;
 const signature=decode(o.signature);
 if(!signature)return null;
 const receipt:SignedBillingDeleteCandidate=Object.freeze({
  version:1,brand_id:'starry',environment:scope.environment,
  publisher_id:BILLING_R16_PUBLISHER_ID,source_event_id:o.source_event_id,
  source_commit_ref:o.source_commit_ref,member_ref:o.member_ref,
  event_ref:o.event_ref,event_digest:o.event_digest,auth_version:o.auth_version,
  occurred_at_sec:o.occurred_at_sec,issued_at_sec:o.issued_at_sec,
  expires_at_sec:o.expires_at_sec,key_id:keyId,signature:o.signature,
 } as SignedBillingDeleteCandidate);
 return {receipt,signature};
}
export function canonicalBillingDeletePublisherV1(c:SignedBillingDeleteCandidate):ArrayBuffer{
 const bytes=new TextEncoder().encode(JSON.stringify({
  version:1,brand_id:c.brand_id,environment:c.environment,publisher_id:c.publisher_id,
  source_event_id:c.source_event_id,source_commit_ref:c.source_commit_ref,
  member_ref:c.member_ref,event_ref:c.event_ref,event_digest:c.event_digest,
  auth_version:c.auth_version,occurred_at_sec:c.occurred_at_sec,
  issued_at_sec:c.issued_at_sec,expires_at_sec:c.expires_at_sec,key_id:c.key_id,
 }));
 const out=new ArrayBuffer(bytes.byteLength);new Uint8Array(out).set(bytes);return out;
}
function currentOK(x:unknown,c:SignedBillingDeleteCandidate):boolean{
 const v=safe(x,AUTH);
 return v!==null&&v.status==='deleted'&&v.source_event_id===c.source_event_id
  &&v.source_commit_ref===c.source_commit_ref&&v.member_ref===c.member_ref
  &&v.event_ref===c.event_ref&&v.event_digest===c.event_digest
  &&v.auth_version===c.auth_version&&v.occurred_at_sec===c.occurred_at_sec;
}
const answer=(status:InboxOutcome['status'],reason:string):InboxOutcome=>
 Object.freeze({status,reason,may_ack_queue:false,may_grant:false,live:false});
export const BILLING_R16_INBOX_INSERT_SQL=[
 'INSERT INTO billing_delete_inbox_R16_DRAFT',
 '(brand_id,environment,publisher_id,source_event_id,source_commit_ref,',
 'member_ref,event_ref,event_digest,auth_version,occurred_at_sec)',
 "VALUES('starry',?,?,?,?,?,?,?,?,?)",
 'ON CONFLICT(brand_id,environment,source_event_id) DO NOTHING',
 'RETURNING source_event_id,event_ref',
].join(' ');
/** Embedded :memory: schema, NOT a new Cloudflare migration or SQL inventory item. */
export const BILLING_R16_INBOX_MEMORY_DDL=[
 'CREATE TABLE billing_delete_inbox_R16_DRAFT(',
 "brand_id TEXT NOT NULL CHECK(brand_id='starry'),",
 "environment TEXT NOT NULL CHECK(environment IN ('development','staging')),",
 "publisher_id TEXT NOT NULL CHECK(publisher_id='starry.auth.account_deleted.v1.offline_candidate'),",
 'source_event_id TEXT NOT NULL CHECK(length(source_event_id) BETWEEN 20 AND 180),',
 'source_commit_ref TEXT NOT NULL CHECK(length(source_commit_ref)=66),',
 'member_ref TEXT NOT NULL CHECK(length(member_ref)=66),',
 'event_ref TEXT NOT NULL UNIQUE CHECK(length(event_ref)=66),',
 'event_digest TEXT NOT NULL CHECK(length(event_digest)=64),',
 'auth_version INTEGER NOT NULL CHECK(auth_version>=2),',
 'occurred_at_sec INTEGER NOT NULL CHECK(occurred_at_sec>0),',
 'PRIMARY KEY(brand_id,environment,source_event_id));',
 'CREATE TRIGGER billing_r16_atomic_tombstone_DRAFT AFTER INSERT',
 'ON billing_delete_inbox_R16_DRAFT BEGIN',
 'INSERT INTO billing_deletion_fence_DRAFT',
 '(brand_id,environment,member_ref,deleted_version,deleted_at_sec,event_ref,event_digest)',
 "VALUES('starry',NEW.environment,NEW.member_ref,NEW.auth_version,NEW.occurred_at_sec,NEW.event_ref,NEW.event_digest)",
 'ON CONFLICT(member_ref) DO UPDATE SET',
 'deleted_version=excluded.deleted_version,deleted_at_sec=excluded.deleted_at_sec,',
 'event_ref=excluded.event_ref,event_digest=excluded.event_digest',
 'WHERE excluded.deleted_version>billing_deletion_fence_DRAFT.deleted_version',
 'AND excluded.deleted_at_sec>=billing_deletion_fence_DRAFT.deleted_at_sec',
 'AND billing_deletion_fence_DRAFT.environment=excluded.environment;',
 'SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM billing_deletion_fence_DRAFT',
 'WHERE member_ref=NEW.member_ref AND deleted_version=NEW.auth_version',
 'AND event_ref=NEW.event_ref AND event_digest=NEW.event_digest',
 "AND deleted_at_sec=NEW.occurred_at_sec) THEN RAISE(ABORT,'BILLING_INBOX_STALE_OR_CONFLICTING') END;",
 'END;',
 'CREATE TRIGGER billing_r16_inbox_immutable_update_DRAFT',
 "BEFORE UPDATE ON billing_delete_inbox_R16_DRAFT BEGIN SELECT RAISE(ABORT,'BILLING_INBOX_IMMUTABLE'); END;",
 'CREATE TRIGGER billing_r16_inbox_immutable_delete_DRAFT',
 "BEFORE DELETE ON billing_delete_inbox_R16_DRAFT BEGIN SELECT RAISE(ABORT,'BILLING_INBOX_IMMUTABLE'); END;",
].join('\n');
export function createOfflineSinglePublisherBillingInbox(deps:Readonly<{
 enabled?:boolean;scope:DeleteScope;key_id:string;verifyKey:CryptoKey;
 db:BillingInboxDb;ports:BillingDeleteAuthority;
}>){
 const sc=safe(deps?.scope,['brand_id','environment']),key=deps?.verifyKey;
 const alg=key?.algorithm as RsaHashedKeyAlgorithm|undefined;
 if(!sc||sc.brand_id!=='starry'||
  (sc.environment!=='development'&&sc.environment!=='staging')
  ||typeof deps.key_id!=='string'||!KID.test(deps.key_id)
  ||!key||key.type!=='public'||key.extractable
  ||alg?.name!=='RSASSA-PKCS1-v1_5'||alg.modulusLength<2048
  ||alg.hash?.name!=='SHA-256'||!key.usages.includes('verify')
  ||typeof deps.db?.prepare!=='function'
  ||typeof deps.ports?.lawfulMinimalRetentionApproved!=='function'
  ||typeof deps.ports.verifyCommittedOrigin!=='function'
  ||typeof deps.ports.readCurrentDeletedAuth!=='function')
  throw Error('BILLING_R16_CONFIG_DENIED');
 const scope:DeleteScope=Object.freeze({brand_id:'starry',
  environment:sc.environment as DeleteScope['environment']});
 return Object.freeze({
  async accept(input:unknown,now:number):Promise<InboxOutcome>{
   if(deps.enabled!==true)return answer('disabled','DISABLED');
   if(!integer(now)||now===0)return answer('blocked','INVALID_CLOCK');
   const data=parse(input,scope,deps.key_id,now);
   if(!data)return answer('blocked','UNTRUSTED_PUBLISHER_ENVELOPE');
   try{
    const signed=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
     key,data.signature,canonicalBillingDeletePublisherV1(data.receipt));
    if(!signed)return answer('blocked','PUBLISHER_SIGNATURE_DENIED');
    if(await deps.ports.lawfulMinimalRetentionApproved()!==true)
     return answer('blocked','LAWFUL_PURPOSE_NOT_APPROVED');
    const c=data.receipt;
    if(await deps.ports.verifyCommittedOrigin(c)!==true)
     return answer('blocked','AUTH_COMMIT_PROOF_MISSING');
    if(!currentOK(await deps.ports.readCurrentDeletedAuth(c.source_event_id),c))
     return answer('blocked','CURRENT_AUTH_DIVERGED');
    if(await deps.ports.verifyCommittedOrigin(c)!==true||
     !currentOK(await deps.ports.readCurrentDeletedAuth(c.source_event_id),c))
     return answer('blocked','AUTH_CHANGED_DURING_DELIVERY');
    const res=await deps.db.prepare(BILLING_R16_INBOX_INSERT_SQL)
     .bind(scope.environment,c.publisher_id,c.source_event_id,
      c.source_commit_ref,c.member_ref,c.event_ref,c.event_digest,
      c.auth_version,c.occurred_at_sec)
     .first<Record<string,unknown>>();
    if(res===null)return answer('blocked','DUPLICATE_COMMITTED_DELIVERY');
    const row=safe(res,['source_event_id','event_ref']);
    if(!row||row.source_event_id!==c.source_event_id||
     row.event_ref!==c.event_ref)return answer('blocked','UNTRUSTED_COMMIT_RECEIPT');
    return answer('recorded_offline','SAME_BILLING_DB_INBOX_TOMBSTONE_ATOMIC');
   }catch{return answer('blocked','OFFLINE_AUTHORITY_OR_DB_UNAVAILABLE');}
  },
 });
}
