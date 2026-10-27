/** AI-2 R9: offline D1-shaped reconciliation ports only. No Store, D1 deploy or paid grants. */
import type {ClaimedJob,CommittedSource,Ports,ProviderObservation,SafeReconcileReceipt,Scope} from './reconciliation.ts';
type V=string|number|null;
export interface Prepared {bind(...args:V[]):Prepared;first<T extends Record<string,unknown>>():Promise<T|null>;all<T extends Record<string,unknown>>():Promise<{results:T[]}>;}
export interface D1Like {prepare(sql:string):Prepared;}
export const RECONCILIATION_D1_PUBLISHABLE=false as const;
const REF=/^r_[0-9a-f]{64}$/,ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function check(v:unknown,msg:string):asserts v{if(!v)throw new Error(msg);}
function integer(v:unknown):v is number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;}
function plain(v:unknown):v is Record<string,unknown>{
 try{return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype
  &&Reflect.ownKeys(v).every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return typeof k==='string'&&d!==undefined&&'value'in d;});}
 catch{return false;}
}
function validScope(s:unknown):s is Scope{
 return plain(s)&&s.brandId==='starry'&&typeof s.appId==='string'&&ID.test(s.appId)
  &&typeof s.storeAppId==='string'&&ID.test(s.storeAppId)
  &&(s.environment==='development'||s.environment==='staging')
  &&s.storeEnvironment==='sandbox'&&(s.store==='apple'||s.store==='google');
}
function leaseToken():string{
 const b=new Uint8Array(32);crypto.getRandomValues(b);
 return 'r_'+Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
}
export const RECONCILIATION_SQL=Object.freeze({
 due:[
  'SELECT job_ref,source_version FROM billing_reconcile_job_DRAFT',
  "WHERE brand_id='starry' AND app_id=? AND environment=? AND store_environment='sandbox'",
  "AND store=? AND store_app_id=? AND is_deleted=0 AND next_due_sec<=? AND attempts<?",
  "AND (status='pending' OR (status='leased' AND lease_until_sec<=?))",
  'ORDER BY next_due_sec,job_ref LIMIT ?',
 ].join(' '),
 claim:[
  'UPDATE billing_reconcile_job_DRAFT',
  "SET lease_token=?,lease_until_sec=?,attempts=attempts+1,status='leased'",
  "WHERE job_ref=? AND brand_id='starry' AND app_id=? AND environment=?",
  "AND store_environment='sandbox' AND store=? AND store_app_id=?",
  'AND source_version=? AND is_deleted=0 AND next_due_sec<=? AND attempts<?',
  "AND (status='pending' OR (status='leased' AND lease_until_sec<=?))",
  'RETURNING job_ref,offer_id,kind,app_id,store,store_app_id,',
  'next_due_sec AS due_at_sec,lease_token,lease_until_sec,source_version AS version,attempts',
 ].join(' '),
 review:[
  'UPDATE billing_reconcile_job_DRAFT',
  "SET status=CASE WHEN ?='review_required' THEN 'review_only' ELSE 'pending' END,",
  'next_due_sec=?,lease_token=NULL,lease_until_sec=NULL,',
  "attempts=CASE WHEN ?='candidate_observation' THEN 0 ELSE attempts END,",
  'last_review_result=?,last_review_digest=?,last_review_at_sec=?',
  'WHERE job_ref=? AND lease_token=? AND source_version=?',
  "AND brand_id='starry' AND app_id=? AND environment=?",
  "AND store_environment='sandbox' AND store=? AND store_app_id=?",
  "AND is_deleted=0 AND status='leased' AND lease_until_sec>?",
  'RETURNING job_ref',
 ].join(' '),
});
export function createOfflineReconciliationD1Ports(opts:Readonly<{
 db:D1Like;scope:Scope;enabledSandbox:true;maxAttempts:number;retryAfterSeconds:number;
 nowSeconds:()=>number;readCommittedSource:(job:ClaimedJob)=>Promise<CommittedSource|null>;
 requerySandbox:(job:ClaimedJob)=>Promise<ProviderObservation>;
}>):Ports {
 check(opts?.enabledSandbox===true&&validScope(opts.scope)
  &&integer(opts.maxAttempts)&&opts.maxAttempts>=1&&opts.maxAttempts<=5
  &&integer(opts.retryAfterSeconds)&&opts.retryAfterSeconds>=60&&opts.retryAfterSeconds<=86400
  &&typeof opts.db?.prepare==='function'&&typeof opts.nowSeconds==='function'
  &&typeof opts.readCommittedSource==='function'&&typeof opts.requerySandbox==='function',
  'RECONCILE_D1_CONFIG_DENIED');
 const s=Object.freeze({...opts.scope});
 const now=()=>{const t=opts.nowSeconds();check(integer(t)&&t>0,'RECONCILE_D1_CLOCK_DENIED');return t;};
 const one=<T extends Record<string,unknown>>(sql:string,...a:V[])=>opts.db.prepare(sql).bind(...a).first<T>();
 return Object.freeze({
  nowSeconds:now,readCommittedSource:opts.readCommittedSource,requerySandbox:opts.requerySandbox,
  async leaseDueJobs(asked:Scope,t:number,limit:number,seconds:number){
   check(validScope(asked)&&asked.appId===s.appId&&asked.environment===s.environment
    &&asked.store===s.store&&asked.storeAppId===s.storeAppId
    &&integer(t)&&t===now()&&integer(limit)&&limit>=1&&limit<=25
    &&integer(seconds)&&seconds>=10&&seconds<=300
    &&t+seconds<=Number.MAX_SAFE_INTEGER,'RECONCILE_D1_SCOPE_DENIED');
   const listing=await opts.db.prepare(RECONCILIATION_SQL.due)
    .bind(s.appId,s.environment,s.store,s.storeAppId,t,opts.maxAttempts,t,limit)
    .all<Record<string,unknown>>();
   check(plain(listing)&&Array.isArray(listing.results)
    &&listing.results.length<=limit,'RECONCILE_D1_LIST_DENIED');
   // Validate EVERY candidate before issuing even the first D1 write.
   const seen=new Set<string>();
   for(const candidate of listing.results){
    check(plain(candidate)&&typeof candidate.job_ref==='string'
     &&REF.test(candidate.job_ref)&&integer(candidate.source_version)
     &&candidate.source_version>=1&&!seen.has(candidate.job_ref),
     'RECONCILE_D1_LIST_DENIED');
    seen.add(candidate.job_ref);
   }
   const out:ClaimedJob[]=[];
   for(const candidate of listing.results){
    const lease=leaseToken();
    const row=await one<Record<string,unknown>>(RECONCILIATION_SQL.claim,lease,t+seconds,
     candidate.job_ref,s.appId,s.environment,s.store,s.storeAppId,
     candidate.source_version,t,opts.maxAttempts,t);
    if(row===null)continue; // race loser
    check(plain(row)&&row.job_ref===candidate.job_ref&&row.lease_token===lease
     &&row.app_id===s.appId&&row.store===s.store&&row.store_app_id===s.storeAppId
     &&typeof row.offer_id==='string'&&ID.test(row.offer_id)
     &&!row.offer_id.toLowerCase().includes('battery')
     &&(row.kind==='monthly'||row.kind==='yearly'||row.kind==='one_time')
     &&integer(row.due_at_sec)&&row.due_at_sec<=t
     &&row.lease_until_sec===t+seconds&&row.version===candidate.source_version
     &&integer(row.attempts)&&row.attempts>=1&&row.attempts<=opts.maxAttempts,
     'RECONCILE_D1_CLAIM_DENIED');
    out.push(Object.freeze({jobRef:row.job_ref,leaseToken:lease,offerId:row.offer_id,
     appId:s.appId,store:s.store,storeAppId:s.storeAppId,kind:row.kind,
     dueAtSec:row.due_at_sec,leaseUntilSec:t+seconds,version:row.version,
     attempts:row.attempts}));
   }
   return Object.freeze(out);
  },
  async recordReviewCAS(receipt:SafeReconcileReceipt){
   const t=now();
   check(plain(receipt)&&receipt.publishable===false
    &&typeof receipt.jobRef==='string'&&REF.test(receipt.jobRef)
    &&typeof receipt.leaseToken==='string'&&REF.test(receipt.leaseToken)
    &&integer(receipt.expectedVersion)&&receipt.expectedVersion>=1
    &&integer(receipt.observedAtSec)&&receipt.observedAtSec<=t
    &&(receipt.result==='candidate_observation'||receipt.result==='review_required')
    &&(
     receipt.result==='candidate_observation'&&receipt.reason==='SANDBOX_REQUERY_OBSERVED'
      &&typeof receipt.newState==='string'
      &&['PAID','RENEWED','REFUNDED','CHARGEBACK','EXPIRED','GRACE_PERIOD','ON_HOLD','REVOKED'].includes(receipt.newState)
      &&typeof receipt.eventDigest==='string'&&/^[0-9a-f]{64}$/.test(receipt.eventDigest)
     ||receipt.result==='review_required'
      &&(
        receipt.reason==='REORDERED_OR_CONFLICT'
         &&typeof receipt.newState==='string'
         &&['PAID','RENEWED','REFUNDED','CHARGEBACK','EXPIRED','GRACE_PERIOD','ON_HOLD','REVOKED'].includes(receipt.newState)
         &&typeof receipt.eventDigest==='string'
         &&/^[0-9a-f]{64}$/.test(receipt.eventDigest)
        ||receipt.reason==='DELETED_OR_FOREIGN'
         &&receipt.eventDigest===null&&receipt.newState===null
      )
    )&&t+opts.retryAfterSeconds<=Number.MAX_SAFE_INTEGER,
    'RECONCILE_D1_RECEIPT_DENIED');
   const row=await one<Record<string,unknown>>(RECONCILIATION_SQL.review,receipt.result,
    t+opts.retryAfterSeconds,receipt.result,receipt.result,receipt.eventDigest,t,
    receipt.jobRef,receipt.leaseToken,receipt.expectedVersion,
    s.appId,s.environment,s.store,s.storeAppId,t);
   check(row===null||plain(row)&&row.job_ref===receipt.jobRef,'RECONCILE_D1_REVIEW_DENIED');
   return row!==null;
  },
 });
}
