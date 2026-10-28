/**
 * AI-3 WAVE1 Round-001: read-only security notification review fence.
 * Reuses existing AI-3 P05 candidate AuditMetadata/assertEvent authority.
 * True AI-0 canonical signed issuer, AI-1 Auth and AI-4 Queue remain external.
 * NO dispatch, Inbox/D1 write, Queue ACK or payment is possible here.
 */
import {assertEvent,assertScope} from './index.ts';
import type {AuditMetadata,Scope} from './index.ts';
export const WAVE1_SECURITY_FENCE_VERSION='starry.ai3.wave1.security-fence.v1-candidate' as const;
export const WAVE1_SECURITY_FENCE_LIVE=false as const;
export type Wave1NotificationChannel='inbox'|'push'|'email';
export type Wave1SecurityDecision=Readonly<{
 schema_version:typeof WAVE1_SECURITY_FENCE_VERSION;
 status:'blocked'|'review_only';
 reason:'DISABLED'|'INVALID_SCOPE_OR_EVENT'|'NON_DELIVERABLE_SECURITY_EVENT'|
 'AUTH_REVOKED_OR_DELETED'|'AUTH_UNKNOWN'|'SOURCE_UNVERIFIED'|
 'DUPLICATE_OR_UNKNOWN'|'CONSENT_DENIED_OR_UNKNOWN'|
 'LAWFUL_RETENTION_UNAPPROVED'|'STATE_CHANGED'|'PORT_UNAVAILABLE'|
 'CANDIDATE_REQUIRES_APPROVED_BACKEND';
 purpose:'notification_audit_preflight_only';
 may_send:false;may_enqueue:false;may_ack_queue:false;may_retry:false;
 may_replay:false;may_grant_battery:false;may_purchase_battery:false;
 may_restore_member:false;may_purge:false;live:false;
}>;
type SessionProof=Readonly<{state:'active'|'revoked'|'deleted'|'unknown';
 auth_version:number;session_version:number}>;
type Wave1Ports=Readonly<{
 /** AI-1 authoritative trust domain. Not supplied by HTTP body. */
 readSessionFence:(scope:Scope)=>Promise<unknown>;
 /** AI-0/AI-4 future P05 signed issuer, not this module. */
 verifyCanonicalSource:(scope:Scope,event:AuditMetadata)=>Promise<'verified'|'unverified'|'unknown'>;
 /** Persisted receipt from AI-3 audit inbox (not an in-memory Set). */
 readDedupe:(scope:Scope,key:string)=>Promise<'unseen'|'committed'|'unknown'>;
 /** AI-3 Q104/Q119 lawful purpose and retention, not guessed defaults. */
 lawfulRetentionNow:(scope:Scope)=>Promise<boolean>;
 /** AI-1/DEV-H permission; never infer from UI or app request. */
 notificationPreference:(scope:Scope,event:AuditMetadata,channel:Wave1NotificationChannel)=>
 Promise<'allow'|'deny'|'unknown'>;
}>;
const FREE=Object.freeze({
 may_send:false,may_enqueue:false,may_ack_queue:false,may_retry:false,
 may_replay:false,may_grant_battery:false,may_purchase_battery:false,
 may_restore_member:false,may_purge:false,live:false
} as const);
function output(status:Wave1SecurityDecision['status'],
 reason:Wave1SecurityDecision['reason']):Wave1SecurityDecision{
 return Object.freeze({schema_version:WAVE1_SECURITY_FENCE_VERSION,status,reason,
 purpose:'notification_audit_preflight_only',...FREE});
}
const validSession=(v:unknown):v is SessionProof=>{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return false;
  const keys=Reflect.ownKeys(v),allowed=['state','auth_version','session_version'];
  if(keys.length!==allowed.length||keys.some(k=>typeof k!=='string'||!allowed.includes(k)))return false;
  const x:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of allowed){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||!d.enumerable||!('value' in d))return false;
   x[k]=d.value;
  }
  return ['active','revoked','deleted','unknown'].includes(x.state as string)
   &&Number.isSafeInteger(x.auth_version)&&Number(x.auth_version)>0
   &&Number.isSafeInteger(x.session_version)&&Number(x.session_version)>=0;
 }catch{return false;}
};
const isChannel=(v:unknown):v is Wave1NotificationChannel=>
 v==='inbox'||v==='email'||v==='push';
export function createWave1SecurityNotificationFence(config:Readonly<{
 enabled?:boolean;scope:Scope;ports:Wave1Ports;
}>){
 if(!config?.ports||!['readSessionFence','verifyCanonicalSource','readDedupe',
  'lawfulRetentionNow','notificationPreference'].every(k=>
   typeof config.ports[k as keyof Wave1Ports]==='function'))
  throw Error('AI3_WAVE1_PORT_REQUIRED');
 const s=config.scope;
 if(!s||s.environment==='production')throw Error('AI3_WAVE1_SCOPE_DENIED');
 try{assertScope(s,s);}catch{throw Error('AI3_WAVE1_SCOPE_DENIED');}
 const scope:Scope=Object.freeze({brand_id:'starry',app_id:s.app_id,environment:s.environment});
 const ports=config.ports;
 return Object.freeze({
  async review(input:Readonly<{event:unknown;channel:unknown}>):Promise<Wave1SecurityDecision>{
   if(config.enabled!==true)return output('blocked','DISABLED');
   if(!input||!isChannel(input.channel))return output('blocked','INVALID_SCOPE_OR_EVENT');
   try{assertEvent(scope,input.event);}catch{return output('blocked','INVALID_SCOPE_OR_EVENT');}
   const e=input.event as AuditMetadata;
   // identity revocation/erasure is an invalidation EVENT, never a
   // notification-delivery permission, even when it is authentic.
   if(e.event_type!=='notification.delivery.queued')
    return output('blocked','NON_DELIVERABLE_SECURITY_EVENT');
   try{
    if(await ports.lawfulRetentionNow(scope)!==true)
     return output('blocked','LAWFUL_RETENTION_UNAPPROVED');
    const first=await ports.readSessionFence(scope);
    if(!validSession(first))return output('blocked','AUTH_UNKNOWN');
    if(first.state==='revoked'||first.state==='deleted')
     return output('blocked','AUTH_REVOKED_OR_DELETED');
    if(first.state!=='active')return output('blocked','AUTH_UNKNOWN');
    const signed=await ports.verifyCanonicalSource(scope,e);
    if(signed!=='verified')return output('blocked','SOURCE_UNVERIFIED');
    const receipt=await ports.readDedupe(scope,e.idempotency_key);
    if(receipt!=='unseen')return output('blocked','DUPLICATE_OR_UNKNOWN');
    const preference=await ports.notificationPreference(scope,e,input.channel);
    if(preference!=='allow')return output('blocked','CONSENT_DENIED_OR_UNKNOWN');
    const second=await ports.readSessionFence(scope);
    if(!validSession(second))return output('blocked','AUTH_UNKNOWN');
    if(second.state!=='active')return output('blocked','AUTH_REVOKED_OR_DELETED');
    if(second.auth_version!==first.auth_version||
       second.session_version!==first.session_version)
     return output('blocked','STATE_CHANGED');
    const signedAgain=await ports.verifyCanonicalSource(scope,e);
    const receiptAgain=await ports.readDedupe(scope,e.idempotency_key);
    const preferenceAgain=await ports.notificationPreference(scope,e,input.channel);
    if(signedAgain!==signed||receiptAgain!==receipt||preferenceAgain!==preference)
     return output('blocked','STATE_CHANGED');
    if(await ports.lawfulRetentionNow(scope)!==true)
     return output('blocked','LAWFUL_RETENTION_UNAPPROVED');
    // Existing candidate shape is NOT the single approved P05 schema
    // or proof of actual D1/Queue commit. Never grant send/ACK permission.
    return output('review_only','CANDIDATE_REQUIRES_APPROVED_BACKEND');
   }catch{return output('blocked','PORT_UNAVAILABLE');}
  }
 });
}
