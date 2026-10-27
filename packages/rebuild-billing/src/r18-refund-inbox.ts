/** AI-2 R18. OFFLINE Store refund inbox, local revocation and PITR fence.
 * No Apple/Google authority, lawful KMS issuer, external witness or Queue ACK.
 * R16 and R17 are imported, not replaced. Not a Cloudflare D1 migration.
 */
import type {ReviewRequest,ReviewOutcome} from './deletion-readback-review.ts';
import type {DeleteScope} from './account-deletion-fence.ts';
export const LIVE_BILLING_R18_ENABLED=false as const;
export const BILLING_R18_PUBLISHABLE=false as const;
export const BILLING_R18_ACK_ALLOWED=false as const;
export type SignedRefund=Readonly<{
 version:1;brand_id:'starry';environment:'development'|'staging';
 store:'apple'|'google';store_app_ref:string;transaction_ref:string;
 event_ref:string;source_version:number;effective_at_sec:number;
 member_ref:string;deletion_source_event_id:string;
 kind:'REFUNDED'|'CHARGEBACK'|'REVOKED';key_id:string;signature:string;
}>;
export type RefundOutcome=Readonly<{
 status:'disabled'|'blocked'|'recorded_offline';reason:string;
 may_ack_queue:false;may_regrant:false;may_restore:false;live:false;
}>;
export type RefundPorts=Readonly<{
 lawfulRetentionApproved:()=>Promise<boolean>;
 verifyCommittedStoreRevocation:(event:SignedRefund)=>Promise<boolean>;
 readStoreOriginStillCommitted:(event:SignedRefund)=>Promise<boolean>;
 reviewDeletedMember:(receipt:ReviewRequest)=>Promise<ReviewOutcome>;
}>;
export type RefundDb=Readonly<{
 prepare:(sql:string)=>Readonly<{
  bind:(...args:(string|number)[])=>Readonly<{
   first:<T extends Record<string,unknown>>()=>Promise<T|null>;
  }>;
 }>;
}>;
const KEYS=['version','brand_id','environment','store','store_app_ref',
 'transaction_ref','event_ref','source_version','effective_at_sec',
 'member_ref','deletion_source_event_id','kind','key_id','signature'] as const;
const KID=/^[A-Za-z0-9._:-]{1,96}$/;
const EID=/^[A-Za-z0-9._:-]{20,180}$/,R=/^r_[a-f0-9]{64}$/,M=/^m_[a-f0-9]{64}$/;
const num=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function exact(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return null;
  const d=Object.getOwnPropertyDescriptors(x);
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   if(!Object.hasOwn(d,k)||!d[k].enumerable||!('value'in d[k]))return null;
   o[k]=d[k].value;
  }
  return o;
 }catch{return null;}
}
const answer=(status:RefundOutcome['status'],reason:string):RefundOutcome=>
 Object.freeze({status,reason,may_ack_queue:false,may_regrant:false,
  may_restore:false,live:false});
const b64=(value:unknown):ArrayBuffer|null=>{
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(value))return null;
 try{
  const standard=value.replace(/-/g,'+').replace(/_/g,'/');
  const text=atob(standard+'='.repeat((4-standard.length%4)%4));
  if(btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==value)return null;
  const arr=new Uint8Array(text.length);
  for(let i=0;i<text.length;i++)arr[i]=text.charCodeAt(i);
  return arr.buffer;
 }catch{return null;}
};
function parse(input:unknown,scope:DeleteScope,keyId:string,now:number):SignedRefund|null{
 const v=exact(input,KEYS);
 if(!v||v.version!==1||v.brand_id!=='starry'||v.environment!==scope.environment
  ||(v.store!=='apple'&&v.store!=='google')
  ||typeof v.store_app_ref!=='string'||!R.test(v.store_app_ref)
  ||typeof v.transaction_ref!=='string'||!R.test(v.transaction_ref)
  ||typeof v.event_ref!=='string'||!R.test(v.event_ref)
  ||typeof v.member_ref!=='string'||!M.test(v.member_ref)
  ||typeof v.deletion_source_event_id!=='string'||!EID.test(v.deletion_source_event_id)
  ||!num(v.source_version)||v.source_version<1
  ||!num(v.effective_at_sec)||v.effective_at_sec===0
  ||v.effective_at_sec>now||now-v.effective_at_sec>604800
  ||(v.kind!=='REFUNDED'&&v.kind!=='CHARGEBACK'&&v.kind!=='REVOKED')
  ||v.key_id!==keyId||!b64(v.signature))return null;
 return Object.freeze({
  version:1,brand_id:'starry',environment:scope.environment,
  store:v.store,store_app_ref:v.store_app_ref,
  transaction_ref:v.transaction_ref,event_ref:v.event_ref,
  source_version:v.source_version,effective_at_sec:v.effective_at_sec,
  member_ref:v.member_ref,deletion_source_event_id:v.deletion_source_event_id,
  kind:v.kind,key_id:keyId,signature:v.signature,
 } as SignedRefund);
}
export function canonicalBillingR18Refund(event:SignedRefund):ArrayBuffer{
 const json=JSON.stringify({
  version:1,brand_id:event.brand_id,environment:event.environment,
  store:event.store,store_app_ref:event.store_app_ref,
  transaction_ref:event.transaction_ref,event_ref:event.event_ref,
  source_version:event.source_version,effective_at_sec:event.effective_at_sec,
  member_ref:event.member_ref,deletion_source_event_id:event.deletion_source_event_id,
  kind:event.kind,key_id:event.key_id,
 });
 const bytes=new TextEncoder().encode(json);
 const buffer=new ArrayBuffer(bytes.byteLength);
 new Uint8Array(buffer).set(bytes);
 return buffer;
}
/** Embedded disposable SQLite schema: NEVER migrate to Cloudflare as-is. */
export const BILLING_R18_MEMORY_DDL=[
 'CREATE TABLE billing_r18_refund_floor_DRAFT(',
 "brand_id TEXT NOT NULL CHECK(brand_id='starry'),",
 "environment TEXT NOT NULL CHECK(environment IN ('development','staging')),",
 "store TEXT NOT NULL CHECK(store IN ('apple','google')),",
 'store_app_ref TEXT NOT NULL,transaction_ref TEXT NOT NULL,',
 'member_ref TEXT NOT NULL,source_version INTEGER NOT NULL CHECK(source_version>0),',
 'event_ref TEXT NOT NULL,kind TEXT NOT NULL,',
 'PRIMARY KEY(environment,store,store_app_ref,transaction_ref));',
 'CREATE TABLE billing_r18_refund_inbox_DRAFT(',
 "brand_id TEXT NOT NULL CHECK(brand_id='starry'),",
 "environment TEXT NOT NULL CHECK(environment IN ('development','staging')),",
 "store TEXT NOT NULL CHECK(store IN ('apple','google')),",
 'store_app_ref TEXT NOT NULL,transaction_ref TEXT NOT NULL,',
 'event_ref TEXT NOT NULL,source_version INTEGER NOT NULL CHECK(source_version>0),',
 'member_ref TEXT NOT NULL,kind TEXT NOT NULL,',
 "CHECK(kind IN ('REFUNDED','CHARGEBACK','REVOKED')),",
 'PRIMARY KEY(environment,store,event_ref),',
 'UNIQUE(environment,store,store_app_ref,transaction_ref,source_version));',
 'CREATE TRIGGER billing_r18_version_fence_DRAFT BEFORE INSERT ON billing_r18_refund_inbox_DRAFT',
 'WHEN EXISTS(SELECT 1 FROM billing_r18_refund_floor_DRAFT f WHERE',
 'f.environment=NEW.environment AND f.store=NEW.store',
 'AND f.store_app_ref=NEW.store_app_ref AND f.transaction_ref=NEW.transaction_ref',
 'AND (f.source_version>=NEW.source_version OR f.member_ref<>NEW.member_ref))',
 "BEGIN SELECT RAISE(ABORT,'R18_STALE_OR_CONFLICTING_REFUND'); END;",
 'CREATE TRIGGER billing_r18_refund_atomic_DRAFT AFTER INSERT ON billing_r18_refund_inbox_DRAFT BEGIN',
 'INSERT INTO billing_r18_refund_floor_DRAFT',
 '(brand_id,environment,store,store_app_ref,transaction_ref,member_ref,source_version,event_ref,kind)',
 'VALUES(NEW.brand_id,NEW.environment,NEW.store,NEW.store_app_ref,NEW.transaction_ref,',
 'NEW.member_ref,NEW.source_version,NEW.event_ref,NEW.kind)',
 'ON CONFLICT(environment,store,store_app_ref,transaction_ref) DO UPDATE SET',
 'source_version=excluded.source_version,event_ref=excluded.event_ref,kind=excluded.kind',
 'WHERE excluded.source_version>billing_r18_refund_floor_DRAFT.source_version',
 'AND excluded.member_ref=billing_r18_refund_floor_DRAFT.member_ref;',
 'UPDATE billing_entitlement_candidate_DRAFT SET candidate_state=\'revoked\'',
 'WHERE brand_id=NEW.brand_id AND environment=NEW.environment',
 'AND member_ref=NEW.member_ref AND candidate_state=\'candidate_active\';',
 'END;',
 'CREATE TRIGGER billing_r18_inbox_immutable_update_DRAFT',
 "BEFORE UPDATE ON billing_r18_refund_inbox_DRAFT BEGIN SELECT RAISE(ABORT,'R18_INBOX_IMMUTABLE'); END;",
 'CREATE TRIGGER billing_r18_inbox_immutable_delete_DRAFT',
 "BEFORE DELETE ON billing_r18_refund_inbox_DRAFT BEGIN SELECT RAISE(ABORT,'R18_INBOX_IMMUTABLE'); END;",
 'CREATE TRIGGER billing_r18_floor_immutable_delete_DRAFT',
 "BEFORE DELETE ON billing_r18_refund_floor_DRAFT BEGIN SELECT RAISE(ABORT,'R18_FLOOR_IMMUTABLE'); END;",
].join('\n');
export const BILLING_R18_REFUND_INSERT_SQL=[
 'INSERT INTO billing_r18_refund_inbox_DRAFT',
 '(brand_id,environment,store,store_app_ref,transaction_ref,',
 'event_ref,source_version,member_ref,kind)',
 "VALUES('starry',?,?,?,?,?,?,?,?)",
 'ON CONFLICT(environment,store,event_ref) DO NOTHING',
 'RETURNING event_ref,source_version',
].join(' ');
/** Same-Billing-DB join only; NOT proven post-commit or cross-D1 receipt. */
export const BILLING_R18_REFUND_READ_SQL=[
 'SELECT i.event_ref,i.source_version,f.event_ref AS floor_event_ref,',
 'f.source_version AS floor_source_version,',
 '(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c WHERE',
 'c.environment=i.environment AND c.member_ref=i.member_ref',
 "AND c.candidate_state='candidate_active') AS active_count",
 'FROM billing_r18_refund_inbox_DRAFT i',
 'JOIN billing_r18_refund_floor_DRAFT f ON f.environment=i.environment',
 'AND f.store=i.store AND f.store_app_ref=i.store_app_ref',
 'AND f.transaction_ref=i.transaction_ref',
 "WHERE i.brand_id='starry' AND i.environment=? AND i.store=? AND i.event_ref=?",
].join(' ');
export function createOfflineBillingR18RefundInbox(deps:Readonly<{
 enabled?:boolean;scope:DeleteScope;key_id:string;verifyKey:CryptoKey;
 db:RefundDb;ports:RefundPorts;
}>){
 const scope=exact(deps?.scope,['brand_id','environment']);
 const alg=deps?.verifyKey?.algorithm as RsaHashedKeyAlgorithm|undefined;
 if(!scope||scope.brand_id!=='starry'
  ||(scope.environment!=='development'&&scope.environment!=='staging')
  ||!KID.test(deps.key_id)||!deps.verifyKey||deps.verifyKey.type!=='public'
  ||deps.verifyKey.extractable||alg?.name!=='RSASSA-PKCS1-v1_5'
  ||alg.modulusLength<2048||alg.hash?.name!=='SHA-256'
  ||!deps.verifyKey.usages.includes('verify')
  ||typeof deps.db?.prepare!=='function'
  ||typeof deps.ports?.lawfulRetentionApproved!=='function'
  ||typeof deps.ports?.verifyCommittedStoreRevocation!=='function'
  ||typeof deps.ports?.readStoreOriginStillCommitted!=='function'
  ||typeof deps.ports?.reviewDeletedMember!=='function')
  throw Error('R18_UNTRUSTED_CONFIGURATION');
 const fixedScope:DeleteScope=Object.freeze({
  brand_id:'starry',environment:scope.environment as DeleteScope['environment'],
 });
 return Object.freeze({
  async accept(input:unknown,deletion:ReviewRequest,now:number):Promise<RefundOutcome>{
   if(deps.enabled!==true)return answer('disabled','DISABLED');
   if(!num(now)||now===0)return answer('blocked','INVALID_CLOCK');
   const event=parse(input,fixedScope,deps.key_id,now);
   if(!event||!exact(deletion,['source_event_id','source_commit_ref','member_ref',
     'event_ref','event_digest','auth_version','occurred_at_sec'])
    ||event.member_ref!==deletion.member_ref
    ||event.deletion_source_event_id!==deletion.source_event_id)
    return answer('blocked','FOREIGN_OR_MALFORMED_EVENT');
   try{
    const sig=b64(event.signature);
    if(!sig||!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
     deps.verifyKey,sig,canonicalBillingR18Refund(event)))
     return answer('blocked','UNTRUSTED_SIGNATURE');
    if(await deps.ports.lawfulRetentionApproved()!==true)
     return answer('blocked','LAWFUL_PROVENANCE_MISSING');
    if(await deps.ports.verifyCommittedStoreRevocation(event)!==true)
     return answer('blocked','STORE_SOURCE_NOT_VERIFIED');
    const member=await deps.ports.reviewDeletedMember(deletion);
    if(!member||member.status!=='review_only'||member.may_ack_queue!==false
     ||member.may_grant!==false||member.may_restore!==false||member.live!==false)
     return answer('blocked','DELETED_MEMBER_OR_PITR_FENCE_MISSING');
    if(await deps.ports.readStoreOriginStillCommitted(event)!==true)
     return answer('blocked','STORE_SOURCE_CHANGED');
    const row=await deps.db.prepare(BILLING_R18_REFUND_INSERT_SQL)
     .bind(event.environment,event.store,event.store_app_ref,
      event.transaction_ref,event.event_ref,event.source_version,
      event.member_ref,event.kind).first<Record<string,unknown>>();
    if(!row)return answer('blocked','DUPLICATE_OR_OLDER_REFUND');
    const inserted=exact(row,['event_ref','source_version']);
    if(!inserted||inserted.event_ref!==event.event_ref
     ||inserted.source_version!==event.source_version)
     return answer('blocked','INVALID_LOCAL_COMMIT_RECEIPT');
    const stored=await deps.db.prepare(BILLING_R18_REFUND_READ_SQL)
     .bind(event.environment,event.store,event.event_ref).first<Record<string,unknown>>();
    const proof=exact(stored,['event_ref','source_version','floor_event_ref',
     'floor_source_version','active_count']);
    if(!proof||proof.event_ref!==event.event_ref||proof.source_version!==event.source_version
     ||proof.floor_event_ref!==event.event_ref
     ||proof.floor_source_version!==event.source_version||proof.active_count!==0)
     return answer('blocked','REFUND_RECEIPT_OR_RIGHTS_DIVERGED');
    return answer('recorded_offline','LOCAL_REVOCATION_REVIEW_ONLY');
   }catch{return answer('blocked','REFUND_DB_OR_AUTHORITY_UNAVAILABLE');}
  },
 });
}
