/** AI-2 R19 READ-ONLY offline Billing Saga receipt. No real Store, Queue or ACK. */
import {BILLING_R17_READBACK_SQL} from './deletion-readback-review.ts';
export const R19_BILLING_LIVE=false as const;
export const R19_BILLING_PUBLISHABLE=false as const;
export const R19_BILLING_ACK_ALLOWED=false as const;
export type R19Scope=Readonly<{brand_id:'starry';environment:'development'|'staging';app_ref:string;store_app_ref:string}>;
export type R19Request=Readonly<{brand_id:'starry';environment:'development'|'staging';app_ref:string;store_app_ref:string;member_ref:string;source_event_id:string;source_commit_ref:string;event_ref:string;event_digest:string;auth_version:number;occurred_at_sec:number;store:'apple'|'google';transaction_ref:string;refund_event_ref:string;refund_source_version:number;refund_kind:'REFUNDED'|'CHARGEBACK'|'REVOKED'}>;
export type R19Receipt=Readonly<{kind:'offline_candidate_only';brand_id:'starry';environment:'development'|'staging';member_ref:string;app_ref:string;source_event_id:string;auth_version:number;refund_event_ref:string;refund_source_version:number;locally_matched:true;official_store_verified:false;independent_witness_verified:false}>;
export type R19Outcome=Readonly<{status:'disabled'|'blocked'|'retry'|'review_only';reason:string;receipt:R19Receipt|null;may_ack_queue:false;may_regrant:false;may_restore:false;may_publish:false;live:false}>;
type DB=Readonly<{prepare:(sql:string)=>Readonly<{bind:(...a:string[])=>Readonly<{first:<T extends Record<string,unknown>>()=>Promise<T|null>}>}>}>;
export type R19Ports=Readonly<{lawfulProcessingAndRetention:()=>Promise<boolean>;readDeletedAuth:(v:R19Request)=>Promise<unknown>;readStoreCandidate:(v:R19Request)=>Promise<unknown>;readIndependentFloorCandidate:(v:R19Request)=>Promise<unknown>}>;
const R=/^r_[a-f0-9]{64}$/,M=/^m_[a-f0-9]{64}$/,E=/^[A-Za-z0-9._:-]{20,180}$/,H=/^[a-f0-9]{64}$/;
const int=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const K=['brand_id','environment','app_ref','store_app_ref','member_ref','source_event_id','source_commit_ref','event_ref','event_digest','auth_version','occurred_at_sec','store','transaction_ref','refund_event_ref','refund_source_version','refund_kind'] as const;
const AK=['status','brand_id','environment','app_ref','member_ref','source_event_id','source_commit_ref','event_ref','event_digest','auth_version','occurred_at_sec','active_sessions','revoked_before_or_at_deletion'] as const;
const SK=['status','brand_id','environment','app_ref','store_app_ref','store','transaction_ref','refund_event_ref','refund_source_version','refund_kind'] as const;
const FK=['status','brand_id','environment','member_ref','source_event_id','event_ref','auth_version','refund_event_ref','refund_source_version'] as const;
const DK=['source_event_id','source_commit_ref','member_ref','event_ref','event_digest','auth_version','occurred_at_sec','tombstone_version','tombstone_event_ref','tombstone_digest','active_candidates'] as const;
const BK=['refund_event_ref','source_version','refund_kind','floor_event_ref','floor_source_version','floor_kind','member_ref','active_count','battery_count'] as const;
function exact(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{if(!x||typeof x!=='object'||Array.isArray(x))return null;const p=Object.getPrototypeOf(x);if(p!==Object.prototype&&p!==null)return null;
 const ds=Object.getOwnPropertyDescriptors(x);if(Reflect.ownKeys(x).length!==keys.length)return null;
 const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
 for(const k of keys){if(!Object.hasOwn(ds,k)||!ds[k].enumerable||!('value'in ds[k]))return null;o[k]=ds[k].value;}return o;}catch{return null;}
}
function parse(x:unknown,s:R19Scope):R19Request|null{
 const a=exact(x,K);
 if(!a||a.brand_id!=='starry'||a.environment!==s.environment||a.app_ref!==s.app_ref||a.store_app_ref!==s.store_app_ref
 ||typeof a.member_ref!=='string'||!M.test(a.member_ref)
 ||typeof a.source_event_id!=='string'||!E.test(a.source_event_id)
 ||typeof a.source_commit_ref!=='string'||!R.test(a.source_commit_ref)
 ||typeof a.event_ref!=='string'||!R.test(a.event_ref)
 ||typeof a.event_digest!=='string'||!H.test(a.event_digest)
 ||!int(a.auth_version)||a.auth_version<2||!int(a.occurred_at_sec)
 ||(a.store!=='apple'&&a.store!=='google')
 ||typeof a.transaction_ref!=='string'||!R.test(a.transaction_ref)
 ||typeof a.refund_event_ref!=='string'||!R.test(a.refund_event_ref)
 ||!int(a.refund_source_version)
 ||(a.refund_kind!=='REFUNDED'&&a.refund_kind!=='CHARGEBACK'&&a.refund_kind!=='REVOKED'))return null;
 return Object.freeze({...a}) as R19Request;
}
function equal(a:Record<string,unknown>,v:R19Request,keys:readonly (keyof R19Request)[]){return keys.every(k=>a[k]===v[k]);}
function auth(x:unknown,v:R19Request){const a=exact(x,AK);return a!==null&&a.status==='deleted'&&a.active_sessions===0&&a.revoked_before_or_at_deletion===1&&equal(a,v,['brand_id','environment','app_ref','member_ref','source_event_id','source_commit_ref','event_ref','event_digest','auth_version','occurred_at_sec']);}
function store(x:unknown,v:R19Request){const a=exact(x,SK);return a!==null&&a.status==='offline_store_candidate_only'&&equal(a,v,['brand_id','environment','app_ref','store_app_ref','store','transaction_ref','refund_event_ref','refund_source_version','refund_kind']);}
function floor(x:unknown,v:R19Request){const a=exact(x,FK);return a!==null&&a.status==='unapproved_test_floor'&&equal(a,v,['brand_id','environment','member_ref','source_event_id','event_ref','auth_version','refund_event_ref','refund_source_version']);}
function deleted(x:unknown,v:R19Request){const a=exact(x,DK);return a!==null&&equal(a,v,['source_event_id','source_commit_ref','member_ref','event_ref','event_digest','auth_version','occurred_at_sec'])&&a.tombstone_version===v.auth_version&&a.tombstone_event_ref===v.event_ref&&a.tombstone_digest===v.event_digest&&a.active_candidates===0;}
function refunded(x:unknown,v:R19Request){const a=exact(x,BK);return a!==null&&a.refund_event_ref===v.refund_event_ref&&a.source_version===v.refund_source_version&&a.refund_kind===v.refund_kind&&a.floor_event_ref===v.refund_event_ref&&a.floor_source_version===v.refund_source_version&&a.floor_kind===v.refund_kind&&a.member_ref===v.member_ref&&a.active_count===0&&a.battery_count===0;}
const reply=(status:R19Outcome['status'],reason:string,receipt:R19Receipt|null=null):R19Outcome=>Object.freeze({status,reason,receipt,may_ack_queue:false,may_regrant:false,may_restore:false,may_publish:false,live:false});
export const R19_BILLING_REFUND_SELECT=[
 'SELECT i.event_ref AS refund_event_ref,i.source_version AS source_version,i.kind AS refund_kind,',
 'f.event_ref AS floor_event_ref,f.source_version AS floor_source_version,f.kind AS floor_kind,i.member_ref,',
 "(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c WHERE c.member_ref=i.member_ref AND c.environment=i.environment AND c.candidate_state='candidate_active') AS active_count,",
 "(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c WHERE c.member_ref=i.member_ref AND c.environment=i.environment AND lower(c.offer_id) LIKE '%battery%') AS battery_count",
 'FROM billing_r18_refund_inbox_DRAFT i JOIN billing_r18_refund_floor_DRAFT f ON f.brand_id=i.brand_id AND f.environment=i.environment AND f.store=i.store AND f.store_app_ref=i.store_app_ref AND f.transaction_ref=i.transaction_ref',
 "WHERE i.brand_id='starry' AND i.environment=? AND i.store=? AND i.store_app_ref=? AND i.transaction_ref=? AND i.event_ref=? AND i.member_ref=?"
].join(' ');
export function createOfflineBillingR19ReceiptReview(d:Readonly<{enabled?:boolean;scope:R19Scope;billingDb:DB;ports:R19Ports}>){
 const s=exact(d?.scope,['brand_id','environment','app_ref','store_app_ref']);
 if(!s||s.brand_id!=='starry'||(s.environment!=='development'&&s.environment!=='staging')||typeof s.app_ref!=='string'||!R.test(s.app_ref)||typeof s.store_app_ref!=='string'||!R.test(s.store_app_ref)||typeof d.billingDb?.prepare!=='function'||typeof d.ports?.lawfulProcessingAndRetention!=='function'||typeof d.ports?.readDeletedAuth!=='function'||typeof d.ports?.readStoreCandidate!=='function'||typeof d.ports?.readIndependentFloorCandidate!=='function')throw Error('R19_INVALID_CONFIG');
 const scope=Object.freeze({...s}) as R19Scope;
 return Object.freeze({async inspect(input:unknown):Promise<R19Outcome>{
  if(d.enabled!==true)return reply('disabled','DISABLED');
  const v=parse(input,scope);if(!v)return reply('blocked','INVALID_OR_FOREIGN_RECEIPT');
  try{
   if(await d.ports.lawfulProcessingAndRetention()!==true)return reply('blocked','LEGAL_REQUIRED');
   if(!store(await d.ports.readStoreCandidate(v),v))return reply('retry','STORE_ORIGIN_MISSING');
   if(!auth(await d.ports.readDeletedAuth(v),v))return reply('blocked','AUTH_OR_SESSION_STALE');
   if(!floor(await d.ports.readIndependentFloorCandidate(v),v))return reply('retry','FLOOR_MISSING');
   const b=await d.billingDb.prepare(BILLING_R17_READBACK_SQL).bind(v.environment,v.source_event_id).first<Record<string,unknown>>();
   if(!b)return reply('retry','DELETE_INBOX_MISSING');
   if(!deleted(b,v))return reply('blocked','DELETE_OR_PAID_RIGHTS_DIVERGED');
   const q=()=>d.billingDb.prepare(R19_BILLING_REFUND_SELECT).bind(v.environment,v.store,v.store_app_ref,v.transaction_ref,v.refund_event_ref,v.member_ref).first<Record<string,unknown>>();
   const row=await q();if(!row)return reply('retry','REFUND_INBOX_MISSING');
   if(!refunded(row,v))return reply('blocked','REFUND_FLOOR_DIVERGED');
   if(await d.ports.lawfulProcessingAndRetention()!==true)return reply('blocked','LAW_CHANGED');
   if(!store(await d.ports.readStoreCandidate(v),v))return reply('retry','STORE_CHANGED');
   if(!auth(await d.ports.readDeletedAuth(v),v))return reply('blocked','AUTH_CHANGED');
   if(!floor(await d.ports.readIndependentFloorCandidate(v),v))return reply('retry','FLOOR_CHANGED');
   if(!refunded(await q(),v))return reply('blocked','BILLING_CHANGED');
   return reply('review_only','LOCAL_CANDIDATE_MATCH',Object.freeze({kind:'offline_candidate_only',brand_id:'starry',environment:v.environment,member_ref:v.member_ref,app_ref:v.app_ref,source_event_id:v.source_event_id,auth_version:v.auth_version,refund_event_ref:v.refund_event_ref,refund_source_version:v.refund_source_version,locally_matched:true,official_store_verified:false,independent_witness_verified:false}));
  }catch{return reply('retry','DB_OR_PORT_UNAVAILABLE');}
 }});
}
