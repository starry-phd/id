/**
 * AI-3 Wave1 R003: pure, untrusted evidence compatibility review.
 * This is NOT a P05 signature verifier, D1 transaction, or Queue consumer.
 * NEVER wire this module into a live Worker route or ACK handler.
 */
import {assertEvent, assertScope} from './index.ts';
import type {AuditMetadata, Scope} from './index.ts';
export const R003_P05_ACK_CONTRACT='starry.ai3.p05.commit-before-ack.r003.v1-candidate' as const;
export const R003_LIVE_ENABLED=false as const;
/** Future server-only ports; each implementation belongs to the named Owner.
 * None are implemented here, and no input flag can substitute for them.
 */
export type R003AuthorityPorts=Readonly<{
 ai0_ai4_verifyCanonicalSignedP05:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai1_readEventBoundCurrentSession:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai3_readLawfulPolicyQ104Q119:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai3_readCommittedDurableReceipt:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai0_readIndependentAntiPitrWitness:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai4_ackAfterVerifiedCommit:(scope:Scope,event:AuditMetadata)=>Promise<never>;
}>;
type DecisionReason='INVALID_SCOPE_OR_METADATA'|'INVALID_EVIDENCE_SHAPE'|
 'CANONICAL_SIGNER_PENDING'|'SESSION_NOT_CURRENT'|'LAWFUL_POLICY_PENDING'|
 'RECEIPT_NOT_COMMITTED'|'INDEPENDENT_WITNESS_MISSING'|
 'ACK_ALREADY_ATTEMPTED'|'EVIDENCE_RACE'|'OFFLINE_ONLY_NO_ACK';
export type R003AckDecision=Readonly<{
 contract:typeof R003_P05_ACK_CONTRACT;status:'blocked'|'review_only';
 reason:DecisionReason;may_ack_queue:false;may_send:false;
 may_enqueue:false;may_retry:false;may_write_d1:false;
 may_grant_battery:false;may_sell_battery:false;may_publish:false;live:false;
}>;
const FLAGS=Object.freeze({may_ack_queue:false,may_send:false,may_enqueue:false,
 may_retry:false,may_write_d1:false,may_grant_battery:false,
 may_sell_battery:false,may_publish:false,live:false} as const);
const decide=(status:R003AckDecision['status'],reason:DecisionReason):R003AckDecision=>
 Object.freeze({contract:R003_P05_ACK_CONTRACT,status,reason,...FLAGS});
const HEX=/^[a-f0-9]{64}$/;
const ref=(x:unknown)=>typeof x==='string'&&/^[a-zA-Z0-9._:-]{1,128}$/.test(x);
const integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
function fields(raw:unknown,names:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  const own=Reflect.ownKeys(raw);
  if(own.length!==names.length||own.some(k=>typeof k!=='string'||!names.includes(k)))return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of names){
   const d=Object.getOwnPropertyDescriptor(raw,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   out[k]=d.value;
  }
  return out;
 }catch{return null;}
}
const SCOPE=['brand_id','app_id','environment','event_id'] as const;
const bound=(o:Record<string,unknown>,s:Scope,e:AuditMetadata)=>
 o.brand_id==='starry'&&o.app_id===s.app_id&&
 o.environment===s.environment&&o.event_id===e.event_id;
function checkSnapshot(scope:Scope,event:AuditMetadata,raw:unknown):DecisionReason|null{
 const snapshot=fields(raw,['source','session','legal','receipt','witness','queue']);
 if(!snapshot)return 'INVALID_EVIDENCE_SHAPE';
 const source=fields(snapshot.source,[...SCOPE,'issuer_version','issuer_state','event_digest']);
 if(!source||!bound(source,scope,event)||!integer(source.issuer_version)||
  source.issuer_state!=='candidate_unverified'||typeof source.event_digest!=='string'||
  !HEX.test(source.event_digest))return 'CANONICAL_SIGNER_PENDING';
 // This is a *candidate descriptor*, never a cryptographic proof or trusted issuer.
 const session=fields(snapshot.session,[...SCOPE,'actor_ref','auth_version','session_version','state']);
 if(!session||!bound(session,scope,event)||session.actor_ref!==event.actor_ref||
  !integer(session.auth_version)||!Number.isSafeInteger(session.session_version)||
  Number(session.session_version)<0||
  session.state!==(event.event_type==='identity.member.deleted'?'deleted':
   event.event_type==='identity.session.revoked'?'revoked':'active'))
  return 'SESSION_NOT_CURRENT';
 const legal=fields(snapshot.legal,[...SCOPE,'policy_version','lawful_now','erasure_hold']);
 if(!legal||!bound(legal,scope,event)||!integer(legal.policy_version)||
  legal.lawful_now!==true||
  (legal.erasure_hold!=='none'&&legal.erasure_hold!=='active')||
  (event.event_type==='identity.member.deleted'&&legal.erasure_hold!=='active'))
  return 'LAWFUL_POLICY_PENDING';
 const receipt=fields(snapshot.receipt,[...SCOPE,'idempotency_key','event_digest',
  'commit_ref','commit_revision','ledger_ref','state']);
 if(!receipt||!bound(receipt,scope,event)||receipt.idempotency_key!==event.idempotency_key||
  receipt.event_digest!==source.event_digest||!ref(receipt.commit_ref)||
  !ref(receipt.ledger_ref)||!integer(receipt.commit_revision)||
  receipt.state!=='committed')return 'RECEIPT_NOT_COMMITTED';
 const witness=fields(snapshot.witness,[...SCOPE,'commit_ref','event_digest',
  'witness_ref','witness_revision','ledger_ref','kind']);
 if(!witness||!bound(witness,scope,event)||witness.commit_ref!==receipt.commit_ref||
  witness.event_digest!==source.event_digest||!ref(witness.witness_ref)||
  !ref(witness.ledger_ref)||witness.ledger_ref===receipt.ledger_ref||
  !integer(witness.witness_revision)||
  Number(witness.witness_revision)<Number(receipt.commit_revision)||
  witness.kind!=='independent_anti_pitr_candidate')
  return 'INDEPENDENT_WITNESS_MISSING';
 const queue=fields(snapshot.queue,[...SCOPE,'delivery_ref','ack_attempted','phase']);
 if(!queue||!bound(queue,scope,event)||!ref(queue.delivery_ref)||
  queue.ack_attempted!==false||queue.phase!=='unacknowledged')
  return 'ACK_ALREADY_ATTEMPTED';
 return null;
}
/** Both snapshots are untrusted offline data; even a matching result cannot ACK. */
export function reviewR003CommitBeforeAck(input:Readonly<{
 scope:Scope;event:unknown;before:unknown;after:unknown;
}>):R003AckDecision{
 try{
  if(!input||input.scope?.environment==='production')return decide('blocked','INVALID_SCOPE_OR_METADATA');
  assertScope(input.scope,input.scope);
  assertEvent(input.scope,input.event);
  const event=input.event as AuditMetadata;
  if(!['notification.delivery.queued','identity.session.revoked',
   'identity.member.deleted','privacy.erasure.requested'].includes(event.event_type))
   return decide('blocked','INVALID_SCOPE_OR_METADATA');
  const first=checkSnapshot(input.scope,event,input.before);
  if(first)return decide('blocked',first);
  const second=checkSnapshot(input.scope,event,input.after);
  if(second)return decide('blocked',second);
  if(JSON.stringify(input.before)!==JSON.stringify(input.after))
   return decide('blocked','EVIDENCE_RACE');
  // No key custody, actual D1 transaction, independent witness, or Queue authority.
  return decide('review_only','OFFLINE_ONLY_NO_ACK');
 }catch{return decide('blocked','INVALID_SCOPE_OR_METADATA');}
}
