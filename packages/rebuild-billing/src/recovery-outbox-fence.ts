/**
 * AI-2 R11 Q116 | Billing-owned, isolated OFFLINE outbox anti-resurrection review.
 * An independent authenticated monotone witness MUST live outside restored D1.
 * Never restore, publish P05, ACK a Queue, grant entitlements or call Store.
 */
export const LIVE_BILLING_RECOVERY_ENABLED=false as const;
export const BILLING_OUTBOX_RESTORE_ALLOWED=false as const;
export type BillingScope=Readonly<{
 brand_id:'starry';environment:'development'|'staging';
}>;
export type BillingWitness=Readonly<{
 brand_id:'starry';environment:'development'|'staging';
 source:'independent_append_only';witness_ref:string;
 observed_at_sec:number;sequence:number;head_digest:string;
}>;
type State='PAID'|'RENEWED'|'REFUNDED'|'CHARGEBACK'|'EXPIRED'|'GRACE_PERIOD'|'ON_HOLD'|'REVOKED';
export type BillingEvent=Readonly<{
 seq:number;event_ref:string;app_id:string;store:'apple'|'google';
 store_app_id:string;offer_id:string;kind:'monthly'|'yearly'|'one_time';
 event_state:State;source_version:number;
 store_effective_sec:number;committed_sec:number;source_digest:string;
}>;
export type BillingRecoveryDecision=Readonly<{
 disposition:'blocked'|'review_only';reason:string;
 billing_outbox:number|null;head_digest:string|null;may_restore:false;
}>;
type SqlArg=number|string;
export type ReadOnlyBillingDb=Readonly<{
 prepare:(sql:string)=>Readonly<{bind:(...values:SqlArg[])=>Readonly<{
  all:<T extends Record<string,unknown>>()=>Promise<{results:T[]}>;
  first:<T extends Record<string,unknown>>()=>Promise<T|null>;
 }> }>;
}>;
export type BillingRecoveryPorts=Readonly<{
 privacyAndRecoveryApprovedNow:()=>Promise<boolean>;
 readLegalHold:()=>Promise<'clear'|'held'|'unknown'>;
 readIndependentWitness:()=>Promise<BillingWitness|null>;
 verifyIndependentAttestation:(witness:BillingWitness)=>Promise<boolean>;
 recordDurableReview:(witness:BillingWitness,head_digest:string)=>Promise<boolean>;
}>;
const HEX=/^[a-f0-9]{64}$/;
const REF=/^r_[a-f0-9]{64}$/;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const ZERO='0'.repeat(64);
const STATES=new Set<State>(['PAID','RENEWED','REFUNDED','CHARGEBACK','EXPIRED','GRACE_PERIOD','ON_HOLD','REVOKED']);
function integer(x:unknown):x is number{return typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;}
function data(x:unknown):x is Record<string,unknown>{
 try{return x!==null&&typeof x==='object'&&!Array.isArray(x)
   &&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)
   &&Reflect.ownKeys(x).every(k=>{
     const d=Object.getOwnPropertyDescriptor(x,k);
     return typeof k==='string'&&d!==undefined&&'value' in d&&d.enumerable;
   });}catch{return false;}
}
function exact(x:unknown,names:readonly string[]):x is Record<string,unknown>{
 return data(x)&&Reflect.ownKeys(x).length===names.length&&names.every(k=>Object.hasOwn(x,k));
}
const SCOPE_KEYS=['brand_id','environment'];
const WITNESS_KEYS=['brand_id','environment','source','witness_ref','observed_at_sec','sequence','head_digest'];
const EVENT_KEYS=['seq','event_ref','app_id','store','store_app_id','offer_id','kind','event_state','source_version','store_effective_sec','committed_sec','source_digest'];
function scopeOk(x:unknown):x is BillingScope{
 return exact(x,SCOPE_KEYS)&&x.brand_id==='starry'&&(x.environment==='development'||x.environment==='staging');
}
function witnessOk(x:unknown,s:BillingScope,now:number):x is BillingWitness{
 return exact(x,WITNESS_KEYS)&&x.brand_id==='starry'&&x.environment===s.environment
  &&x.source==='independent_append_only'
  &&typeof x.witness_ref==='string'&&REF.test(x.witness_ref)
  &&integer(x.observed_at_sec)&&x.observed_at_sec<=now&&now-x.observed_at_sec<=30
  &&integer(x.sequence)&&x.sequence<=Number.MAX_SAFE_INTEGER
  &&typeof x.head_digest==='string'&&HEX.test(x.head_digest)
  &&(x.sequence!==0||x.head_digest===ZERO);
}
function eventOk(x:unknown,s:BillingScope,previous:number,now:number):x is BillingEvent{
 return exact(x,EVENT_KEYS)&&integer(x.seq)&&x.seq===previous+1
  &&typeof x.event_ref==='string'&&REF.test(x.event_ref)
  &&typeof x.app_id==='string'&&ID.test(x.app_id)
  &&(x.store==='apple'||x.store==='google')
  &&typeof x.store_app_id==='string'&&ID.test(x.store_app_id)
  &&typeof x.offer_id==='string'&&ID.test(x.offer_id)&&!x.offer_id.toLowerCase().includes('battery')
  &&(x.kind==='monthly'||x.kind==='yearly'||x.kind==='one_time')
  &&typeof x.event_state==='string'&&STATES.has(x.event_state as State)
  &&integer(x.source_version)&&x.source_version>=1
  &&integer(x.store_effective_sec)&&x.store_effective_sec<=now
  &&integer(x.committed_sec)&&x.committed_sec<=now
  &&typeof x.source_digest==='string'&&HEX.test(x.source_digest)
  &&s.brand_id==='starry';
}
async function sha256(s:string):Promise<string>{
 const bytes=new TextEncoder().encode(s);
 const v=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return Array.from(v,b=>b.toString(16).padStart(2,'0')).join('');
}
/** Offline canonical algorithm only; not a Store signature or independent attestation. */
export async function calculateOfflineBillingChain(scope:BillingScope,events:readonly BillingEvent[],now:number){
 if(!scopeOk(scope)||!integer(now)||events.length>128)throw Error('BILLING_CHAIN_DENIED');
 let previous=0,lastCommitted=0,digest=ZERO;
 for(const event of events){
  if(!eventOk(event,scope,previous,now)||event.committed_sec<lastCommitted)
   throw Error('BILLING_CHAIN_DENIED');
  digest=await sha256(JSON.stringify([
   'starry.billing.outbox.v1',scope.brand_id,scope.environment,digest,
   event.seq,event.event_ref,event.app_id,event.store,event.store_app_id,
   event.offer_id,event.kind,event.event_state,event.source_version,
   event.store_effective_sec,event.committed_sec,event.source_digest,
  ]));
  previous=event.seq;lastCommitted=event.committed_sec;
 }
 return Object.freeze({count:previous,headDigest:digest,lastCommitted});
}
export const BILLING_RECOVERY_SQL=Object.freeze({
 events:"SELECT seq,event_ref,app_id,store,store_app_id,offer_id,kind,event_state,source_version,store_effective_sec,committed_sec,source_digest FROM billing_recovery_outbox_DRAFT WHERE brand_id='starry' AND environment=? ORDER BY seq ASC LIMIT ?",
 count:"SELECT COUNT(*) AS total FROM billing_recovery_outbox_DRAFT WHERE brand_id='starry' AND environment=?",
});
const blocked=(reason:string):BillingRecoveryDecision=>Object.freeze({
 disposition:'blocked',reason,billing_outbox:null,head_digest:null,may_restore:false,
});
/**
 * A monotone external witness MUST already be independently authenticated.
 * In-memory fake verifyIndependentAttestation() returning true only tests a
 * contract; an actual signature/key rotation/replay-proof source is NOT wired.
 */
export function createOfflineBillingOutboxRecoveryFence(deps:Readonly<{
 enabled?:boolean;scope:BillingScope;db:ReadOnlyBillingDb;ports:BillingRecoveryPorts;
 maxEvents?:number;
}>){
 if(!scopeOk(deps?.scope)||typeof deps.db?.prepare!=='function'
  ||!deps.ports||typeof deps.ports.privacyAndRecoveryApprovedNow!=='function'
  ||typeof deps.ports.readLegalHold!=='function'
  ||typeof deps.ports.readIndependentWitness!=='function'
  ||typeof deps.ports.verifyIndependentAttestation!=='function'
  ||typeof deps.ports.recordDurableReview!=='function'
  ||(deps.maxEvents!==undefined&&(!integer(deps.maxEvents)
   ||deps.maxEvents<1||deps.maxEvents>128)))throw Error('BILLING_RECOVERY_CONFIG_DENIED');
 const s=Object.freeze({...deps.scope});
 const enabled=deps.enabled===true;
 const limit=deps.maxEvents??128;
 return Object.freeze({
  async review(now:number):Promise<BillingRecoveryDecision>{
   if(!enabled)return blocked('DISABLED');
   if(!integer(now)||now<=0)return blocked('INVALID_CLOCK');
   try{
    // No D1, external witness or customer-linked data before lawful approval.
    if(await deps.ports.privacyAndRecoveryApprovedNow()!==true)return blocked('PRIVACY_GATE');
    if(await deps.ports.readLegalHold()!=='clear')return blocked('LEGAL_HOLD');
    const witness=await deps.ports.readIndependentWitness();
    if(!witnessOk(witness,s,now))return blocked('WITNESS_MISSING_OR_STALE');
    if(await deps.ports.verifyIndependentAttestation(witness)!==true)
     return blocked('WITNESS_NOT_AUTHENTICATED');
    if(witness.sequence>limit)return blocked('PAGINATION_REQUIRED');
    // Read twice to catch append races, not a cross-DB snapshot guarantee.
    const readCount=async()=>{
     const v=await deps.db.prepare(BILLING_RECOVERY_SQL.count).bind(s.environment)
      .first<Record<string,unknown>>();
     if(!data(v)||!integer(v.total))throw Error('INVALID_HEAD');
     return v.total;
    };
    const firstCount=await readCount();
    if(firstCount>limit||firstCount!==witness.sequence)
     return blocked('WITNESS_OR_COUNT_DIVERGED');
    const result=await deps.db.prepare(BILLING_RECOVERY_SQL.events)
     .bind(s.environment,limit+1).all<Record<string,unknown>>();
    if(!data(result)||!Array.isArray(result.results)||result.results.length!==firstCount)
     return blocked('INCOMPLETE_OR_CONFLICTING_PAGE');
    // Validate all event data before hashing; rejected Proxy, accessors,
    // missing, duplicated, moved or altered rows cannot become review evidence.
    const checked:BillingEvent[]=[];
    let last=0;
    for(const event of result.results){
     if(!eventOk(event,s,last,now))return blocked('INVALID_OR_GAPPED_EVENT');
     checked.push(event);
     last=event.seq;
    }
    const chain=await calculateOfflineBillingChain(s,checked,now);
    if(chain.headDigest!==witness.head_digest||chain.count!==witness.sequence
     ||chain.lastCommitted>witness.observed_at_sec)
     return blocked('INDEPENDENT_DIGEST_DIVERGED');
    if(await readCount()!==firstCount)return blocked('CONCURRENT_OUTBOX_CHANGE');
    if(await deps.ports.recordDurableReview(witness,chain.headDigest)!==true)
     return blocked('REVIEW_AUDIT_NOT_DURABLE');
    return Object.freeze({disposition:'review_only' as const,
     reason:'BILLING_OUTBOX_REVIEW_ONLY',billing_outbox:chain.count,
     head_digest:chain.headDigest,may_restore:false as const});
   }catch{return blocked('AUTHORITY_UNAVAILABLE');}
  },
 });
}
