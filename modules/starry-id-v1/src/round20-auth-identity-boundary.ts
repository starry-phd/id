/**
 * AI-1 R20 offline-only Auth source versus Billing/Task/digest namespace review.
 * R19 is the ONLY raw Auth data reader. No raw member_ref leaves this boundary.
 * Other DB observations are not identity links or accepted legal HMAC evidence.
 */
import {createOfflineAuthCrossDomainDTO} from './round19-auth-cross-domain-dto.ts';
import type {StarryDeletionEventScope} from './round15-deletion-source-contract.ts';
import type {D1Database} from './d1-ports.ts';

export const R20_LIVE_CROSS_DOMAIN_MAPPING_ENABLED=false as const;
export const R20_SIGNED_P05_SOURCE_APPROVED=false as const;
export const R20_HMAC_MEMBER_MAPPING_APPROVED=false as const;
export const R20_QUEUE_ACK_ALLOWED=false as const;
export const R20_SCHEMA_VERSION='starry.auth.identity-boundary.v0-offline' as const;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:-]{19,179}$/;
type Consumer='saga'|'battery';
type Scope=StarryDeletionEventScope;
type NamespacedInput=Readonly<{
 reader:Consumer;scope:Scope;auth_event_ref:string;
 store_refund_ref:string;task_ref:string;digest_ref:string;
}>;
const NS=['billing.store_refund','task.execution','member.pseudonymous_digest'] as const;
type Namespace=typeof NS[number];
export type R20AuthBoundaryResult=Readonly<{
 status:'blocked'|'review_only';reason:string;schema_version:typeof R20_SCHEMA_VERSION;
 source?:Readonly<{namespace:'auth.account_deleted';event_id:string;
 auth_version:number;policy_revision:string}>;
 identity_mapping_approved:false;may_publish:false;may_ack_queue:false;
 may_restore:false;may_regrant:false;may_release_task:false;live:false;
}>;
const outcome=(status:R20AuthBoundaryResult['status'],reason:string,
 source?:R20AuthBoundaryResult['source']):R20AuthBoundaryResult=>
 Object.freeze({status,reason,schema_version:R20_SCHEMA_VERSION,
  ...(source?{source}:{}),identity_mapping_approved:false as const,
  may_publish:false as const,may_ack_queue:false as const,
  may_restore:false as const,may_regrant:false as const,
  may_release_task:false as const,live:false as const});
function own(raw:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const o=raw as object,proto=Object.getPrototypeOf(o);
  if(proto!==Object.prototype&&proto!==null)return null;
  const ks=Reflect.ownKeys(o);if(ks.length!==keys.length||ks.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const desc=Object.getOwnPropertyDescriptors(o),v:Record<string,unknown>=Object.create(null);
  for(const key of keys){
   if(!desc[key]?.enumerable||!('value' in desc[key]))return null;
   v[key]=desc[key].value;
  }
  return v;
 }catch{return null;}
}
const safe=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=2;
function parse(raw:unknown,scope:Scope):NamespacedInput|null{
 const x=own(raw,['reader','scope','auth_event_ref','store_refund_ref','task_ref','digest_ref']);
 if(!x||(x.reader!=='saga'&&x.reader!=='battery'))return null;
 const sc=own(x.scope,['brand_id','environment']);
 if(!sc||sc.brand_id!=='starry'||sc.environment!==scope.environment)return null;
 const refs=[x.auth_event_ref,x.store_refund_ref,x.task_ref,x.digest_ref];
 // Equal strings across semantic namespaces NEVER prove identity; reject.
 if(!refs.every(v=>typeof v==='string'&&REF.test(v))||new Set(refs).size!==4)return null;
 const [authEvent,refundEvent,taskRef,digestRef]=refs as string[];
 return {reader:x.reader,scope,auth_event_ref:authEvent!,
  store_refund_ref:refundEvent!,task_ref:taskRef!,digest_ref:digestRef!};
}
function candidate(raw:unknown,namespace:Namespace,ref:string,scope:Scope):boolean{
 const x=own(raw,['namespace','ref','environment','provenance']);
 return !!x&&x.namespace===namespace&&x.ref===ref&&
  x.environment===scope.environment&&x.provenance==='unapproved_mock';
}
/** Test-only cross-DB readbacks; never claim that a candidate proves linkage. */
export function createOfflineR20AuthIdentityBoundary(deps:Readonly<{
 enabled?:boolean;scope:Scope;authDb:D1Database;
 lawfulDeletionProcessingApprovedNow:()=>Promise<boolean>;
 lawfulMinimalRetentionApprovedNow:()=>Promise<boolean>;
 readApprovedPolicyRevisionNow:()=>Promise<unknown>;
 readServerNow:()=>number;
 readRefundCandidate:(ref:string,scope:Scope)=>Promise<unknown>;
 readTaskCandidate:(ref:string,scope:Scope)=>Promise<unknown>;
 readDigestCandidate:(ref:string,scope:Scope)=>Promise<unknown>;
}>) {
 if(typeof deps.readRefundCandidate!=='function'||
    typeof deps.readTaskCandidate!=='function'||
    typeof deps.readDigestCandidate!=='function')
  throw Error('AUTH_R20_READ_ONLY_PORTS_REQUIRED');
 // R19 validates Starry scope and lawful/policy server ports itself.
 const auth=createOfflineAuthCrossDomainDTO({
  enabled:deps.enabled===true,scope:deps.scope,db:deps.authDb,
  lawfulDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  lawfulMinimalRetentionApprovedNow:deps.lawfulMinimalRetentionApprovedNow,
  readApprovedPolicyRevisionNow:deps.readApprovedPolicyRevisionNow,
  readServerNow:deps.readServerNow
 });
 const scope:Scope=Object.freeze({...deps.scope}),enabled=deps.enabled===true;
 async function policy():Promise<string|null>{
  if(await deps.lawfulDeletionProcessingApprovedNow()!==true||
   await deps.lawfulMinimalRetentionApprovedNow()!==true)return null;
  const v=await deps.readApprovedPolicyRevisionNow();
  return typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(v)?v:null;
 }
 return Object.freeze({
  async inspect(claim:unknown,request:unknown):Promise<R20AuthBoundaryResult>{
   if(!enabled)return outcome('blocked','OFFLINE_DISABLED');
   const req=parse(request,scope);
   if(!req)return outcome('blocked','UNTRUSTED_OR_COLLIDING_NAMESPACE');
   try{
    // Reject unknown legal/retention BEFORE reading ANY protected DB/port.
    const policyStart=await policy();
    if(!policyStart)return outcome('blocked','LAWFUL_PURPOSE_RETENTION_OR_POLICY_MISSING');
    const first=await auth.readForOfflineConsumer(claim,req.reader,scope);
    if(!first||first.event.event_id!==req.auth_event_ref||
     first.event.event_type!=='account_deleted'||
     first.policy_revision!==policyStart||!safe(first.auth_version))
     return outcome('blocked','COMMITTED_AUTH_SOURCE_OR_LEASE_MISSING');
    const keys=[req.store_refund_ref,req.task_ref,req.digest_ref];
    const ports=[deps.readRefundCandidate,deps.readTaskCandidate,deps.readDigestCandidate];
    const reads=async()=>{
     const items:unknown[]=[];
     // No raw member_ref, session, claim token or member digest passed to ports.
     for(let i=0;i<3;i++)items.push(await ports[i]!(keys[i]!,scope));
     return items.every((v,i)=>candidate(v,NS[i]!,keys[i]!,scope));
    };
    if(!await reads())return outcome('blocked','FOREIGN_OR_MISSING_DOMAIN_CANDIDATE');
    // Re-check at a new Auth source point. No cross-D1 atomicity asserted.
    if(await policy()!==policyStart)return outcome('blocked','LAWFUL_POLICY_DRIFT');
    const next=await auth.readForOfflineConsumer(claim,req.reader,scope);
    if(!next||next.event.event_id!==first.event.event_id||
     next.event.member_ref!==first.event.member_ref||
     next.event.occurred_at_sec!==first.event.occurred_at_sec||
     next.auth_version!==first.auth_version||
     next.source_attempt_no!==first.source_attempt_no||
     next.policy_revision!==first.policy_revision)
     return outcome('blocked','AUTH_SOURCE_CHANGED_DURING_CROSS_DB_READ');
    if(!await reads()||await policy()!==policyStart)
     return outcome('blocked','CROSS_DB_READBACK_OR_POLICY_DRIFT');
    const now=deps.readServerNow();
    if(typeof now!=='number'||!Number.isSafeInteger(now)||now<0)
     return outcome('blocked','TRUSTED_CLOCK_INVALID');
    // Minimal: Auth event version, ID and policy revision only. NEVER
    // return Auth member_ref, token, member digest, Store refund or Task ref.
    return outcome('review_only','UNAPPROVED_IDENTITY_MAPPING_REVIEW_ONLY',
     Object.freeze({namespace:'auth.account_deleted' as const,
      event_id:first.event.event_id,auth_version:first.auth_version,
      policy_revision:first.policy_revision}));
   }catch{return outcome('blocked','SOURCE_PORT_OR_POLICY_UNAVAILABLE');}
  },
  status:'NO_LAWFUL_KMS_OR_SIGNED_P05_IDENTITY_MAPPING' as const
  // No send/ack/publish/markDelivered/restore or database write API.
 });
}
