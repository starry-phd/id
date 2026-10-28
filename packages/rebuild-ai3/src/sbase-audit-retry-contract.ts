/**
 * AI-3 SBASE-20261028 P05/P06 candidate replay/retry planning.
 * Reuses existing AI-3 CANDIDATE_VERSION, AuditMetadata and assertEvent:
 * does NOT establish a second AI-0 P05 authority or emit notifications.
 * Trust signatures/KMS/PITR floor must come from approved external owners.
 */
import {assertEvent,CANDIDATE_VERSION} from './index.ts';
import type {AuditMetadata,Scope} from './index.ts';
export const SBASE_AUDIT_COMPAT_VERSION=CANDIDATE_VERSION;
export const SBASE_AUDIT_LIVE_ENABLED=false as const;
export type AuditRetryOutcome=Readonly<{
 disposition:'blocked'|'review_only'|'dead_letter_review';
 reason:'INVALID_EVENT_OR_SCOPE'|'POLICY_UNAVAILABLE'|
 'SOURCE_UNSIGNED_OR_UNVERIFIED'|'DUPLICATE_OR_UNKNOWN'|
 'PERMANENT_FAILURE'|'RETRY_LIMIT'|'EVIDENCE_CHANGED'|
 'CANDIDATE_ONLY'|'PORT_UNAVAILABLE';
 next_delay_ms:number|null;
 /** No policy/fixture can authorize actual Queue ACK, retry or P05 publish. */
 may_ack_queue:false;may_publish:false;may_send_notification:false;
 may_change_battery:false;may_restore:false;live:false;
}>;
const outcome=(disposition:AuditRetryOutcome['disposition'],
 reason:AuditRetryOutcome['reason'],next_delay_ms:number|null=null):
 AuditRetryOutcome=>Object.freeze({disposition,reason,next_delay_ms,
 may_ack_queue:false,may_publish:false,may_send_notification:false,
 may_change_battery:false,may_restore:false,live:false});
export type AuditCanonicalPorts=Readonly<{
 /** AI-0/AI-4 eventual authoritative validator; NOT implemented by AI-3. */
 validateCandidate:(scope:Scope,event:AuditMetadata)=>Promise<'candidate_valid'|'denied'|'unknown'>;
 /** Signed issuer / legal policy of event is NOT assertEvent alone. */
 verifySource:(scope:Scope,event:AuditMetadata)=>Promise<'candidate_signed'|'unsigned'|'unknown'>;
 /** Durable authoritative dedupe not provided by this candidate. */
 readDedupe:(scope:Scope,idempotencyKey:string)=>Promise<'unseen'|'seen'|'unknown'>;
 lawfulRetentionNow:(scope:Scope)=>Promise<boolean>;
}>;
export function createCandidateAuditRetryPlanner(config:Readonly<{
 enabled?:boolean;scope:Scope;ports:AuditCanonicalPorts;
 retry:Readonly<{max_attempts:number;base_delay_ms:number;max_delay_ms:number}>;
}>){
 if(!config||!config.ports||!config.retry||
  !['validateCandidate','verifySource','readDedupe','lawfulRetentionNow']
   .every(k=>typeof config.ports[k as keyof AuditCanonicalPorts]==='function'))
  throw Error('AI3_SBASE_AUDIT_PORT_REQUIRED');
 const p=config.retry;
 if(!Number.isSafeInteger(p.max_attempts)||p.max_attempts<1||p.max_attempts>5||
  !Number.isSafeInteger(p.base_delay_ms)||p.base_delay_ms<1||
  !Number.isSafeInteger(p.max_delay_ms)||p.max_delay_ms<p.base_delay_ms||
  p.max_delay_ms>86_400_000)throw Error('AI3_SBASE_RETRY_CONFIG_DENIED');
 return Object.freeze({
  async plan(input:Readonly<{
   event:unknown;attempt:number;failure:'transient'|'permanent';
  }>):Promise<AuditRetryOutcome>{
   if(config.enabled!==true)return outcome('blocked','POLICY_UNAVAILABLE');
   const scope=config.scope;
   if(scope?.environment==='production')return outcome('blocked','POLICY_UNAVAILABLE');
   try{assertEvent(scope,input?.event);}catch{return outcome('blocked','INVALID_EVENT_OR_SCOPE');}
   if(!Number.isSafeInteger(input?.attempt)||input.attempt<1||
    input.attempt>p.max_attempts+1||
    !['transient','permanent'].includes(input.failure))
    return outcome('blocked','POLICY_UNAVAILABLE');
   const event=input.event as AuditMetadata;
   if(input.failure==='permanent')return outcome('blocked','PERMANENT_FAILURE');
   if(input.attempt>=p.max_attempts)
    return outcome('dead_letter_review','RETRY_LIMIT');
   try{
    if(await config.ports.lawfulRetentionNow(scope)!==true)
     return outcome('blocked','POLICY_UNAVAILABLE');
    const read=async()=>{
     const a=await config.ports.validateCandidate(scope,event);
     const b=await config.ports.verifySource(scope,event);
     const c=await config.ports.readDedupe(scope,event.idempotency_key);
     return [a,b,c] as const;
    };
    const first=await read();
    if(first[0]!=='candidate_valid'||first[1]!=='candidate_signed')
     return outcome('blocked','SOURCE_UNSIGNED_OR_UNVERIFIED');
    if(first[2]!=='unseen')return outcome('blocked','DUPLICATE_OR_UNKNOWN');
    const second=await read();
    if(second.some((v,i)=>v!==first[i]))
     return outcome('blocked','EVIDENCE_CHANGED');
    if(await config.ports.lawfulRetentionNow(scope)!==true)
     return outcome('blocked','POLICY_UNAVAILABLE');
    // Delay is a PROPOSED offline backoff, not a running timer/Queue push.
    const delay=Math.min(p.max_delay_ms,p.base_delay_ms*2**(input.attempt-1));
    return outcome('review_only','CANDIDATE_ONLY',delay);
   }catch{return outcome('blocked','PORT_UNAVAILABLE');}
  }
 });
}
