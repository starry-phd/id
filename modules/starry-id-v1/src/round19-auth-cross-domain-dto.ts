/**
 * AI-1 R19: read-only Starry Auth -> Battery/Saga DTO projection.
 * References the real R18 committed-source gate and R15 original four fields.
 * No issuer, KMS, publisher, network, Queue ACK, D1 write or release authority.
 */
import {createOfflineAuthCommittedSagaPreflight} from './round18-auth-committed-saga-preflight.ts';
import {createOfflineAuthDeletionEventSource} from './round15-deletion-source-contract.ts';
import type {BatteryAuthDeletionDTO,StarryDeletionEventScope} from './round15-deletion-source-contract.ts';
import {isSealedAuthDeletionDispatchClaim} from './round16-canonical-deletion-publisher.ts';
import type {AuthDeletionDispatchClaim} from './round16-canonical-deletion-publisher.ts';
import type {D1Database} from './d1-ports.ts';

export const R19_LIVE_AUTH_DTO_ENABLED=false as const;
export const R19_EXTERNAL_AUTH_SIGNATURE_APPROVED=false as const;
export const R19_QUEUE_ACK_ALLOWED=false as const;
export type R19Reader='battery'|'saga';
export type R19OfflineSourceDTO=Readonly<{
 disposition:'offline_untrusted_cross_domain_auth_projection';
 reader:R19Reader;scope:StarryDeletionEventScope;
 event:BatteryAuthDeletionDTO;
 auth_version:number;source_attempt_no:number;policy_revision:string;
 may_publish:false;may_ack_queue:false;may_grant:false;
 may_restore:false;may_regrant:false;live:false;
}>;
const POLICY=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$/;
const safe=(n:unknown):n is number=>typeof n==='number'&&
 Number.isSafeInteger(n)&&n>=0;
function exactScope(raw:unknown):StarryDeletionEventScope|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const o=raw as object,d=Object.getOwnPropertyDescriptors(o);
  const keys=Reflect.ownKeys(o);
  if((Object.getPrototypeOf(o)!==Object.prototype&&Object.getPrototypeOf(o)!==null)||
   keys.length!==2||keys.some(k=>k!=='brand_id'&&k!=='environment')||
   !d.brand_id?.enumerable||!('value' in d.brand_id)||
   !d.environment?.enumerable||!('value' in d.environment)||
   d.brand_id.value!=='starry'||
   !['development','staging'].includes(d.environment.value))return null;
  return Object.freeze({brand_id:'starry',environment:d.environment.value});
 }catch{return null;}
}
function eventEquals(a:BatteryAuthDeletionDTO,b:BatteryAuthDeletionDTO):boolean{
 return a.event_id===b.event_id&&a.member_ref===b.member_ref&&
  a.occurred_at_sec===b.occurred_at_sec&&a.event_type==='account_deleted'&&
  b.event_type==='account_deleted';
}
const exactEvent=(v:unknown):v is BatteryAuthDeletionDTO=>{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const x=v as object,keys=Reflect.ownKeys(x),desc=Object.getOwnPropertyDescriptors(x);
  return (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
   keys.length===4&&keys.every(k=>k==='event_id'||k==='member_ref'||
    k==='occurred_at_sec'||k==='event_type')&&
   ['event_id','member_ref','occurred_at_sec','event_type'].every(k=>
    desc[k]?.enumerable===true&&'value' in desc[k]);
 }catch{return false;}
};
export function createOfflineAuthCrossDomainDTO(deps:Readonly<{
 enabled?:boolean;scope:StarryDeletionEventScope;db:D1Database;
 lawfulDeletionProcessingApprovedNow:()=>Promise<boolean>;
 lawfulMinimalRetentionApprovedNow:()=>Promise<boolean>;
 /** Server-owned policy port; a mere string is NOT certified KMS/legal proof. */
 readApprovedPolicyRevisionNow:()=>Promise<unknown>;
 readServerNow:()=>number;
}>) {
 if(typeof deps.readApprovedPolicyRevisionNow!=='function')
  throw Error('AUTH_R19_POLICY_PORT_REQUIRED');
 const scope=exactScope(deps.scope);
 if(!scope)throw Error('AUTH_R19_SCOPE_DENIED');
 const enabled=deps.enabled===true;
 const source=createOfflineAuthDeletionEventSource({
  enabled,scope,db:deps.db,
  legalDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  readServerNow:deps.readServerNow,
 });
 const gate=createOfflineAuthCommittedSagaPreflight({
  enabled,scope,db:deps.db,
  lawfulDeletionProcessingApprovedNow:deps.lawfulDeletionProcessingApprovedNow,
  lawfulMinimalRetentionApprovedNow:deps.lawfulMinimalRetentionApprovedNow,
  readServerNow:deps.readServerNow
 });
 async function policy():Promise<string|null>{
  if(await deps.lawfulDeletionProcessingApprovedNow()!==true||
     await deps.lawfulMinimalRetentionApprovedNow()!==true)return null;
  const v=await deps.readApprovedPolicyRevisionNow();
  return typeof v==='string'&&POLICY.test(v)?v:null;
 }
 return Object.freeze({
  async readForOfflineConsumer(claim:unknown,reader:unknown,readerScope:unknown):
   Promise<R19OfflineSourceDTO|null>{
   if(!enabled||(reader!=='battery'&&reader!=='saga')||
    !isSealedAuthDeletionDispatchClaim(claim))return null;
   const rScope=exactScope(readerScope);
   if(!rScope||rScope.environment!==scope.environment)return null;
   const c:AuthDeletionDispatchClaim=claim;
   try{
    // Policy and legal decisions are mandatory BEFORE any Auth SQL call.
    const start=await policy();
    if(!start)return null;
    const a=await gate.inspect(c);
    if(!a||a.disposition!=='offline_auth_source_review_only'||a.event_id!==c.event.event_id||
     a.attempt_no!==c.attempt_no||!safe(a.auth_version)||a.auth_version<2)return null;
    // Re-read current original four-field outbox, never a request-supplied DTO.
    const first=await source.readBatteryEvent(a.event_id);
    if(!first||!exactEvent(first)||!exactEvent(c.event)||
     !eventEquals(first,c.event))return null;
    if(await policy()!==start)return null;
    // Re-evaluate the existing REAL Auth gate at a new point in time.
    const b=await gate.inspect(c);
    if(!b||b.event_id!==a.event_id||b.auth_version!==a.auth_version||
     b.attempt_no!==a.attempt_no)return null;
    const last=await source.readBatteryEvent(b.event_id);
    if(!last||!exactEvent(last)||!eventEquals(last,first)||
     await policy()!==start)return null;
    const now=deps.readServerNow();
    if(!safe(now)||now>=c.lease_expires_at)return null;
    const dto=Object.freeze({event_id:last.event_id,member_ref:last.member_ref,
     occurred_at_sec:last.occurred_at_sec,event_type:'account_deleted' as const});
    return Object.freeze({
     disposition:'offline_untrusted_cross_domain_auth_projection' as const,
     reader:reader as R19Reader,scope,event:dto,
     auth_version:a.auth_version,source_attempt_no:a.attempt_no,
     policy_revision:start,
     may_publish:false as const,may_ack_queue:false as const,
     may_grant:false as const,may_restore:false as const,
     may_regrant:false as const,live:false as const
    });
   }catch{return null;}
  },
  status:'OFFLINE_ONLY_NOT_A_SIGNED_OR_PORTABLE_AUTH_PROOF' as const
  // No publish(), send(), ack(), markDelivered() or write() methods.
 });
}
