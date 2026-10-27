/**
 * AI-2 R8 Q113 | BACKEND-ONLY sandbox reconciliation executor.
 * Ports are isolated offline fixtures. No deployed scheduler, Apple/Play calls,
 * entitlement grant, ACK, P05 publish or real payments are permitted here.
 */
export const BILLING_RECONCILIATION_PUBLISHABLE=false as const;
export const BILLING_RECONCILIATION_VERSION='starry.billing.reconcile.r8-candidate' as const;
export type Provider='apple'|'google';
export type Kind='monthly'|'yearly'|'one_time';
export type ObservationState='PAID'|'RENEWED'|'REFUNDED'|'CHARGEBACK'|'EXPIRED'|'GRACE_PERIOD'|'ON_HOLD'|'REVOKED';
export type Scope=Readonly<{
 brandId:'starry';appId:string;environment:'development'|'staging';
 storeEnvironment:'sandbox';store:Provider;storeAppId:string;
}>;
/** Only AI-2 DB adapter can construct a claimed job; never accept HTTP/Queue body. */
export type ClaimedJob=Readonly<{
 jobRef:string;offerId:string;kind:Kind;leaseToken:string;
 appId:string;store:Provider;storeAppId:string;
 dueAtSec:number;leaseUntilSec:number;attempts:number;version:number;
}>;
export type CommittedSource=Readonly<{
 jobRef:string;brandId:'starry';appId:string;store:Provider;storeAppId:string;
 offerId:string;kind:Kind;version:number;isDeleted:boolean;
 latestEffectiveSec:number;latestEventDigest:string;
}>;
/** Sandbox-only fake store adapter result; never a Store-authoritative verification. */
export type ProviderObservation=Readonly<{
 store:Provider;storeAppId:string;offerId:string;kind:Kind;
 state:ObservationState;effectiveSec:number;eventDigest:string;
}>;
export type SafeReconcileReceipt=Readonly<{
 jobRef:string;leaseToken:string;expectedVersion:number;
 observedAtSec:number;result:'review_required'|'candidate_observation';
 reason:'REORDERED_OR_CONFLICT'|'DELETED_OR_FOREIGN'|'SANDBOX_REQUERY_OBSERVED';
 newState:ObservationState|null;eventDigest:string|null;
 publishable:false;
}>;
export type RunSummary=Readonly<{
 status:'disabled'|'ran';claimed:number;reviewed:number;
 candidateObservations:number;retry:number;publishable:false;
}>;
export type Ports=Readonly<{
 /** Must atomically CAS each due job and assign fresh one-use leaseToken. */
 leaseDueJobs:(scope:Scope,nowSec:number,limit:number,leaseSeconds:number)=>Promise<readonly ClaimedJob[]>;
 /** Billing-owned committed-read; absent/uncommitted -> retry without a receipt. */
 readCommittedSource:(job:ClaimedJob)=>Promise<CommittedSource|null>;
 /** Test-only provider port. Real Store credentials & network are NOT wired. */
 requerySandbox:(job:ClaimedJob)=>Promise<ProviderObservation>;
 /** Persist only metadata in SAME owned Billing DB, guarded by leaseToken and version CAS. */
 recordReviewCAS:(receipt:SafeReconcileReceipt)=>Promise<boolean>;
 nowSeconds:()=>number;
}>;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const REF=/^r_[a-f0-9]{64}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const ALL_STATES=new Set<ObservationState>([
 'PAID','RENEWED','REFUNDED','CHARGEBACK','EXPIRED','GRACE_PERIOD','ON_HOLD','REVOKED',
]);
function requireThat(value:unknown,reason:string):asserts value{
 if(!value)throw new Error(reason);
}
function safeInt(value:unknown):value is number{
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
}
function plainObject(value:unknown):value is Record<string,unknown>{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)
     ||Object.getPrototypeOf(value)!==Object.prototype)return false;
  return Reflect.ownKeys(value).every(k=>{
   const d=Object.getOwnPropertyDescriptor(value,k);
   return typeof k==='string'&&d!==undefined&&'value'in d;
  });
 }catch{return false;}
}
function validScope(s:Scope):boolean{
 return plainObject(s)&&s.brandId==='starry'
  &&ID.test(s.appId)&&ID.test(s.storeAppId)
  &&(s.environment==='development'||s.environment==='staging')
  &&s.storeEnvironment==='sandbox'&&(s.store==='apple'||s.store==='google');
}
function validJob(j:unknown,s:Scope,now:number,limitAttempts:number):j is ClaimedJob{
 if(!plainObject(j))return false;
 return typeof j.jobRef==='string'&&REF.test(j.jobRef)
  &&typeof j.leaseToken==='string'&&REF.test(j.leaseToken)
  &&typeof j.offerId==='string'&&ID.test(j.offerId)
  &&!j.offerId.toLowerCase().includes('battery')
  &&(j.kind==='monthly'||j.kind==='yearly'||j.kind==='one_time')
  &&j.appId===s.appId&&j.store===s.store&&j.storeAppId===s.storeAppId
  &&safeInt(j.dueAtSec)&&j.dueAtSec<=now
  &&safeInt(j.leaseUntilSec)&&j.leaseUntilSec>now
  &&safeInt(j.attempts)&&j.attempts>=1&&j.attempts<=limitAttempts
  &&safeInt(j.version)&&j.version>=1;
}
function validSource(source:unknown,j:ClaimedJob,s:Scope):source is CommittedSource{
 if(!plainObject(source))return false;
 return source.jobRef===j.jobRef&&source.brandId==='starry'
  &&source.appId===s.appId&&source.store===s.store
  &&source.storeAppId===s.storeAppId
  &&source.offerId===j.offerId&&source.kind===j.kind
  &&source.version===j.version&&typeof source.isDeleted==='boolean'
  &&safeInt(source.latestEffectiveSec)
  &&typeof source.latestEventDigest==='string'&&DIGEST.test(source.latestEventDigest);
}
function validObservation(o:unknown,j:ClaimedJob,now:number):o is ProviderObservation{
 if(!plainObject(o))return false;
 return o.store===j.store&&o.storeAppId===j.storeAppId
  &&o.offerId===j.offerId&&o.kind===j.kind
  &&typeof o.state==='string'&&ALL_STATES.has(o.state as ObservationState)
  &&safeInt(o.effectiveSec)&&o.effectiveSec<=now
  &&typeof o.eventDigest==='string'&&DIGEST.test(o.eventDigest);
}
/**
 * Executes read-only store requery candidate → metadata-only CAS review.
 * A paid-looking observation CANNOT update any rights; manual AI-0/Store Gate
 * and real trusted provider adapter are prerequisites for later authorization.
 */
export function createOfflineBillingReconciler(options:Readonly<{
 scope:Scope;enabledSandbox:boolean;batchLimit:number;leaseSeconds:number;
 maxAttempts:number;ports:Ports;
}>){
 requireThat(options!==null&&typeof options==='object'
  &&validScope(options.scope)&&typeof options.enabledSandbox==='boolean'
  &&Number.isSafeInteger(options.batchLimit)&&options.batchLimit>=1&&options.batchLimit<=25
  &&Number.isSafeInteger(options.leaseSeconds)&&options.leaseSeconds>=10&&options.leaseSeconds<=300
  &&Number.isSafeInteger(options.maxAttempts)&&options.maxAttempts>=1&&options.maxAttempts<=5
  &&typeof options.ports?.leaseDueJobs==='function'
  &&typeof options.ports.readCommittedSource==='function'
  &&typeof options.ports.requerySandbox==='function'
  &&typeof options.ports.recordReviewCAS==='function'
  &&typeof options.ports.nowSeconds==='function','RECONCILE_CONFIG_DENIED');
 const scope:Object=Object.freeze({...options.scope});
 const safeScope=scope as Scope;
 return Object.freeze({
  async runOnce():Promise<RunSummary>{
   if(!options.enabledSandbox)return Object.freeze({
    status:'disabled' as const,claimed:0,reviewed:0,
    candidateObservations:0,retry:0,publishable:BILLING_RECONCILIATION_PUBLISHABLE,
   });
   const now=options.ports.nowSeconds();
   requireThat(safeInt(now)&&now>0,'RECONCILE_CLOCK_DENIED');
   let batch:readonly ClaimedJob[];
   try{batch=await options.ports.leaseDueJobs(safeScope,now,
    options.batchLimit,options.leaseSeconds);
   }catch{throw new Error('RECONCILE_LEASE_UNAVAILABLE');}
   requireThat(Array.isArray(batch)&&batch.length<=options.batchLimit,
    'RECONCILE_LEASE_DENIED');
   const unique=new Set<string>();
   for(const job of batch){
    requireThat(validJob(job,safeScope,now,options.maxAttempts)
     &&!unique.has(job.jobRef),'RECONCILE_LEASE_DENIED');
    unique.add(job.jobRef);
   }
   let reviewed=0,candidateObservations=0,retry=0;
   for(const job of batch){
    let source:CommittedSource|null;
    try{source=await options.ports.readCommittedSource(job);}
    catch{retry++;continue;}
    // Uncommitted source is never persisted as a review of a valid purchase.
    if(source===null){retry++;continue;}
    if(!validSource(source,job,safeScope)){retry++;continue;}
    let result:SafeReconcileReceipt;
    if(source.isDeleted){
     result=Object.freeze({jobRef:job.jobRef,leaseToken:job.leaseToken,
      expectedVersion:source.version,observedAtSec:now,
      result:'review_required',reason:'DELETED_OR_FOREIGN',
      newState:null,eventDigest:null,publishable:false});
    }else{
     let obs:ProviderObservation;
     try{obs=await options.ports.requerySandbox(job);}
     catch{retry++;continue;}
     // Unknown provider response cannot refresh a trusted ledger or produce a grant.
     if(!validObservation(obs,job,now)){retry++;continue;}
     const reordered=obs.effectiveSec<source.latestEffectiveSec
      ||obs.effectiveSec===source.latestEffectiveSec
       &&obs.eventDigest!==source.latestEventDigest;
     result=Object.freeze({jobRef:job.jobRef,leaseToken:job.leaseToken,
      expectedVersion:source.version,observedAtSec:now,
      result:reordered?'review_required':'candidate_observation',
      reason:reordered?'REORDERED_OR_CONFLICT':'SANDBOX_REQUERY_OBSERVED',
      newState:obs.state,eventDigest:obs.eventDigest,publishable:false});
    }
    try{
     // MUST be fenced by lease token, source version and current deleted state
     // in the Billing D1 owner; a stale owner cannot overwrite a newer result.
     if(await options.ports.recordReviewCAS(result)){
      if(result.result==='review_required')reviewed++;
      else candidateObservations++;
     }else retry++;
    }catch{retry++;}
   }
   return Object.freeze({status:'ran' as const,claimed:batch.length,reviewed,
    candidateObservations,retry,publishable:BILLING_RECONCILIATION_PUBLISHABLE});
  },
 });
}
