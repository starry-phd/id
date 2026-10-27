/**
 * AI-4 R17: isolated OFFLINE readback gate for account-deletion fanout.
 * It wraps R16's actual Auth-source-validated local delivery; it never publishes,
 * performs a Queue ACK/DLQ operation, grants rights, or asserts cross-D1 atomicity.
 * All authority/policy/sink projections below are unapproved local test ports.
 */
import type {DeliveryResult} from './round16-single-publisher-deletion-sync.ts';

export const LIVE_R17_DELETION_FANOUT=false as const;
export const R17_FANOUT_CONTRACT='starry.deletion-fanout-review.v0-draft' as const;
const AUTH_FIELDS=['brand_id','environment','event_id','member_ref','auth_version','deleted'] as const;
const POLICY_FIELDS=['revision','processing_approved'] as const;
const SINK_FIELDS=['sink','brand_id','environment','event_id','member_ref','auth_version','policy_revision','local_inbox_applied','blocked_from_regrant','pending_operations'] as const;
const DELIVERY_FIELDS=['status','reason','may_ack_queue','may_regrant','live','sole_publisher'] as const;
const EVENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
const MEMBER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const REVISION=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/;
const SINKS=['battery','billing','task'] as const;
type Sink=typeof SINKS[number];
type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
type Candidate=Readonly<{brand_id:string;environment:string;event_id:string;member_ref:string;auth_version:number;deleted:true}>;
type Policy=Readonly<{revision:string;processing_approved:true}>;
export type OfflineFanoutPorts=Readonly<{
 readPolicy:()=>Promise<unknown>;
 readCurrentDeletion:(eventRef:string)=>Promise<unknown>;
 deliverLocal:(eventRef:string,nowSec:number)=>Promise<DeliveryResult>;
 readLocalSink:(sink:Sink,eventRef:string)=>Promise<unknown>;
}>;
export type OfflineFanoutResult=Readonly<{
 status:'blocked'|'retry'|'candidate_consistent';
 reason:string;
 may_ack_queue:false;may_dlq:false;may_regrant:false;may_release_task:false;
 publishable:false;live:false;
}>;
function result(status:OfflineFanoutResult['status'],reason:string):OfflineFanoutResult{
 return Object.freeze({status,reason,may_ack_queue:false,may_dlq:false,
  may_regrant:false,may_release_task:false,publishable:false,live:false});
}
function exact(v:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const names=Reflect.ownKeys(v);
  if(names.length!==fields.length||names.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const row:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of fields){
   const descriptor=Object.getOwnPropertyDescriptor(v,key);
   if(!descriptor||!descriptor.enumerable||!('value' in descriptor))return null;
   row[key]=descriptor.value;
  }
  return row;
 }catch{return null;}
}
function readPolicy(raw:unknown,pinned:string):Policy|null{
 const p=exact(raw,POLICY_FIELDS);
 return p&&p.revision===pinned&&p.processing_approved===true
  ?{revision:pinned,processing_approved:true}:null;
}
function readAuth(raw:unknown,scope:Scope,eventRef:string):Candidate|null{
 const a=exact(raw,AUTH_FIELDS);
 return a&&a.brand_id===scope.brand_id&&a.environment===scope.environment&&
  a.event_id===eventRef&&typeof a.member_ref==='string'&&MEMBER.test(a.member_ref)&&
  typeof a.auth_version==='number'&&Number.isSafeInteger(a.auth_version)&&
  a.auth_version>=2&&a.deleted===true
  ?{brand_id:scope.brand_id,environment:scope.environment,event_id:eventRef,
    member_ref:a.member_ref,auth_version:a.auth_version,deleted:true}:null;
}
function sameAuth(a:Candidate,b:Candidate|null):boolean{
 return !!b&&a.event_id===b.event_id&&a.member_ref===b.member_ref&&
  a.auth_version===b.auth_version&&a.environment===b.environment;
}
function sinkValid(raw:unknown,sink:Sink,scope:Scope,auth:Candidate,revision:string):boolean{
 const r=exact(raw,SINK_FIELDS);
 return !!r&&r.sink===sink&&r.brand_id===scope.brand_id&&
  r.environment===scope.environment&&r.event_id===auth.event_id&&
  r.member_ref===auth.member_ref&&r.auth_version===auth.auth_version&&
  r.policy_revision===revision&&r.local_inbox_applied===true&&
  r.blocked_from_regrant===true&&r.pending_operations===0;
}
function verifiedR16Result(raw:unknown):'confirmed'|'blocked'|'retry'{
 const r=exact(raw,DELIVERY_FIELDS);
 if(!r||r.may_ack_queue!==false||r.may_regrant!==false||r.live!==false||
  r.sole_publisher!=='AI-1_AUTH_COMMITTED_OUTBOX')return 'retry';
 if(r.status==='blocked')return 'blocked';
 if(r.status==='retry')return 'retry';
 return (r.status==='local_recorded'||r.status==='duplicate_local')?'confirmed':'retry';
}
/**
 * Candidate review cannot authorize ACK even if every *local* readback matches.
 * Before invoking the R16 Battery writer, a pinned test policy + Auth projection
 * must be present. R16 separately checks the sealed AI-1 Auth source itself.
 */
export function createOfflineDeletionFanoutReview(
 scope:Scope,pinnedPolicyRevision:string,ports:OfflineFanoutPorts
){
 const s=exact(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(String(s.environment)))
  throw Error('AI4_R17_SCOPE_DENIED');
 if(typeof pinnedPolicyRevision!=='string'||!REVISION.test(pinnedPolicyRevision))
  throw Error('AI4_R17_POLICY_REVISION_REQUIRED');
 if(!ports||typeof ports.readPolicy!=='function'||
  typeof ports.readCurrentDeletion!=='function'||
  typeof ports.deliverLocal!=='function'||typeof ports.readLocalSink!=='function')
  throw Error('AI4_R17_PORTS_REQUIRED');
 const stable:Scope=Object.freeze({brand_id:'starry',
  environment:s.environment as 'development'|'staging'});
 return Object.freeze({
  async review(eventRef:unknown,nowSec:unknown):Promise<OfflineFanoutResult>{
   if(typeof eventRef!=='string'||!EVENT.test(eventRef)||
    typeof nowSec!=='number'||!Number.isSafeInteger(nowSec)||nowSec<=0||
    !Number.isSafeInteger(nowSec*1000))
    return result('blocked','INVALID_EVENT_OR_CLOCK');
   try{
    // A candidate local policy is not a legal approval or independent attestation.
    if(!readPolicy(await ports.readPolicy(),pinnedPolicyRevision))
     return result('blocked','NO_CURRENT_LOCAL_POLICY');
    const before=readAuth(await ports.readCurrentDeletion(eventRef),stable,eventRef);
    if(!before)return result('blocked','AUTH_PROJECTION_UNAVAILABLE');
    const delivered=verifiedR16Result(await ports.deliverLocal(eventRef,nowSec));
    if(delivered==='blocked')return result('blocked','R16_DELIVERY_BLOCKED');
    if(delivered!=='confirmed')return result('retry','R16_DELIVERY_NOT_DURABLE');
    // The sink may already have committed here. Never claim rollback or ACK.
    if(!readPolicy(await ports.readPolicy(),pinnedPolicyRevision))
     return result('retry','POLICY_CHANGED_AFTER_LOCAL_DELIVERY');
    for(const sink of SINKS){
     if(!sinkValid(await ports.readLocalSink(sink,eventRef),sink,stable,before,pinnedPolicyRevision))
      return result('retry','DEPENDENT_LOCAL_RECEIPT_MISSING_OR_MISMATCHED');
    }
    if(!readPolicy(await ports.readPolicy(),pinnedPolicyRevision))
     return result('retry','POLICY_CHANGED_AFTER_READBACK');
    const current=readAuth(await ports.readCurrentDeletion(eventRef),stable,eventRef);
    if(!sameAuth(before,current))
     return result('retry','AUTH_CHANGED_AFTER_READBACK');
    return result('candidate_consistent','ONLY_LOCAL_CANDIDATE_NOT_AN_ACK');
   }catch{return result('retry','LOCAL_SOURCE_OR_READBACK_UNAVAILABLE');}
  }
 });
}
