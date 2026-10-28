/**
 * AI-3 Wave1 R004: canonical-P05/Session/receipt/Queue *handshake proposal*.
 * Pure synthetic review. Never execute a provider, sign, persist, send or ACK.
 * An "all consistent" report is NOT cryptographic/physical evidence.
 */
import {assertEvent,assertScope} from './index.ts';
import type {AuditMetadata,Scope} from './index.ts';

export const R004_P05_HANDSHAKE='starry.ai3.p05.canonical-claim-handshake.r004.v1-candidate' as const;
export const R004_P05_LIVE=false as const;
export const R004_SIBLING_CONTRACTS=Object.freeze({
 auth:'starry.auth.identity-authority.r003.v1-candidate',
 transport:'starry.ai4.wave1.r003.protected-interop.v1-offline-candidate',
 issuer:'AI0_CANONICAL_P05_UNAPPROVED'
} as const);
/** Future server-only ports. None of these is implemented or invoked here. */
export type R004OwnerPorts=Readonly<{
 ai0VerifySignedCanonicalEnvelope:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai1ReadCurrentEventActorSession:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai3ReadApprovedQ104Q119:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai3ClaimReceiptByDurableCAS:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai0ReadIndependentAntiPitrFloor:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 ai4AckAfterRealCommit:(scope:Scope,event:AuditMetadata)=>Promise<never>;
}>;
type Reason='INVALID_INPUT'|'SCOPE_DENIED'|'ISSUER_UNTRUSTED'|'ACTOR_OR_SESSION_INVALID'|
 'LEGAL_POLICY_PENDING'|'RECEIPT_OR_CAS_PENDING'|'COMPETING_CLAIM'|
 'WITNESS_OR_PITR_UNVERIFIED'|'ACK_PREMATURE'|'UPSTREAM_PORT_OUTAGE'|
 'LATE_CHANGE_OR_REORDER'|'CANDIDATE_ONLY';
export type R004Review=Readonly<{
 contract:typeof R004_P05_HANDSHAKE;state:'blocked'|'review_only';reason:Reason;
 may_ack:false;may_send:false;may_retry:false;may_enqueue:false;may_write_d1:false;
 may_grant_battery:false;may_sell_battery:false;may_publish:false;live:false;
}>;
const NO=Object.freeze({may_ack:false,may_send:false,may_retry:false,may_enqueue:false,
 may_write_d1:false,may_grant_battery:false,may_sell_battery:false,
 may_publish:false,live:false} as const);
const result=(state:R004Review['state'],reason:Reason):R004Review=>
 Object.freeze({contract:R004_P05_HANDSHAKE,state,reason,...NO});
const REF=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX=/^[a-f0-9]{64}$/;
const NONCE=/^[A-Za-z0-9_-]{8,96}$/;
const ident=(x:unknown)=>typeof x==='string'&&REF.test(x);
const pos=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0;
const nonneg=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
/** Data descriptors only: hostile getters/proxies and extra PII are denied. */
function exact(raw:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const proto=Object.getPrototypeOf(raw);
  if(proto!==Object.prototype&&proto!==null)return null;
  const names=Reflect.ownKeys(raw);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(raw,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   out[k]=d.value;
  }
  return out;
 }catch{return null;}
}
const PREFIX=['brand_id','app_id','environment','event_id'] as const;
function bound(raw:unknown,extra:readonly string[],scope:Scope,event:AuditMetadata){
 const x=exact(raw,[...PREFIX,...extra]);
 return x&&x.brand_id==='starry'&&x.app_id===scope.app_id&&
  x.environment===scope.environment&&x.event_id===event.event_id?x:null;
}
type Snapshot=Readonly<{reason:Reason|null;fingerprint:string|null;claim_ref:string|null}>;
function verify(raw:unknown,scope:Scope,event:AuditMetadata):Snapshot{
 const s=exact(raw,['issuer','session','legal','receipt','claim','witness','queue','ports']);
 if(!s)return {reason:'INVALID_INPUT',fingerprint:null,claim_ref:null};
 const issuer=bound(s.issuer,['actor_ref','idempotency_key','envelope_version',
  'kid','epoch','nonce','nonce_state','digest','signature_state'],scope,event);
 if(!issuer||issuer.actor_ref!==event.actor_ref||issuer.idempotency_key!==event.idempotency_key||
  issuer.envelope_version!=='p05.canonical.v1-proposal'||!ident(issuer.kid)||
  !pos(issuer.epoch)||!NONCE.test(String(issuer.nonce))||
  issuer.nonce_state!=='unverified_unique_candidate'||
  typeof issuer.digest!=='string'||!HEX.test(issuer.digest)||
  issuer.signature_state!=='unverified_candidate')
  return {reason:'ISSUER_UNTRUSTED',fingerprint:null,claim_ref:null};
 const session=bound(s.session,['actor_ref','auth_version','session_version',
  'state','authority_contract'],scope,event);
 const expected=event.event_type==='identity.session.revoked'?'revoked':
  event.event_type==='identity.member.deleted'?'deleted':'active';
 if(!session||session.actor_ref!==event.actor_ref||!pos(session.auth_version)||
  !nonneg(session.session_version)||session.state!==expected||
  session.authority_contract!==R004_SIBLING_CONTRACTS.auth)
  return {reason:'ACTOR_OR_SESSION_INVALID',fingerprint:null,claim_ref:null};
 const legal=bound(s.legal,['policy_version','lawful_now','erasure_hold'],scope,event);
 if(!legal||!pos(legal.policy_version)||legal.lawful_now!==true||
  !['none','active'].includes(String(legal.erasure_hold))||
  (expected==='deleted'&&legal.erasure_hold!=='active'))
  return {reason:'LEGAL_POLICY_PENDING',fingerprint:null,claim_ref:null};
 const receipt=bound(s.receipt,['idempotency_key','event_digest','claim_ref',
  'claim_revision','ledger_ref','cas_state'],scope,event);
 if(!receipt||receipt.idempotency_key!==event.idempotency_key||
  receipt.event_digest!==issuer.digest||!ident(receipt.claim_ref)||
  !pos(receipt.claim_revision)||!ident(receipt.ledger_ref)||
  receipt.cas_state!=='committed_unverified_candidate')
  return {reason:'RECEIPT_OR_CAS_PENDING',fingerprint:null,claim_ref:null};
 const claim=bound(s.claim,['claim_ref','attempt_ref','attempt_revision',
  'competing_claim'],scope,event);
 if(!claim||claim.claim_ref!==receipt.claim_ref||!ident(claim.attempt_ref)||
  !pos(claim.attempt_revision)||claim.attempt_revision!==receipt.claim_revision||
  claim.competing_claim!=='none_observed_candidate')
  return {reason:'COMPETING_CLAIM',fingerprint:null,claim_ref:null};
 const witness=bound(s.witness,['claim_ref','event_digest','floor_revision',
  'ledger_ref','witness_ref','independence'],scope,event);
 if(!witness||witness.claim_ref!==receipt.claim_ref||
  witness.event_digest!==issuer.digest||!pos(witness.floor_revision)||
  Number(witness.floor_revision)<Number(receipt.claim_revision)||
  !ident(witness.ledger_ref)||witness.ledger_ref===receipt.ledger_ref||
  !ident(witness.witness_ref)||witness.independence!=='external_unverified_candidate')
  return {reason:'WITNESS_OR_PITR_UNVERIFIED',fingerprint:null,claim_ref:null};
 const queue=bound(s.queue,['delivery_ref','ack_attempted','phase'],scope,event);
 if(!queue||!ident(queue.delivery_ref)||queue.ack_attempted!==false||
  queue.phase!=='awaiting_real_commit')
  return {reason:'ACK_PREMATURE',fingerprint:null,claim_ref:null};
 const ports=exact(s.ports,['canonical','auth','legal','receipt','witness','queue']);
 if(!ports||Object.values(ports).some(v=>v!=='unconnected_candidate'))
  return {reason:'UPSTREAM_PORT_OUTAGE',fingerprint:null,claim_ref:null};
 // Every component above is untrusted metadata, NEVER a verified signature,
 // real CAS commit, independent witness, or usable authorization.
 return {reason:null,fingerprint:JSON.stringify([issuer,session,legal,receipt,
  claim,witness,queue,ports]),claim_ref:String(receipt.claim_ref)};
}
/** No trusted ports are called. A consistent mock can ONLY be review_only. */
export function reviewR004P05Handshake(raw:unknown):R004Review{
 try{
  const x=exact(raw,['scope','event','before','after']);
  if(!x)return result('blocked','INVALID_INPUT');
  const scope=x.scope as Scope;
  if(!scope||scope.environment==='production')return result('blocked','SCOPE_DENIED');
  assertScope(scope,scope);
  assertEvent(scope,x.event);
  const event=x.event as AuditMetadata;
  if(!['notification.delivery.queued','identity.session.revoked',
   'identity.member.deleted','privacy.erasure.requested'].includes(event.event_type))
   return result('blocked','INVALID_INPUT');
  const before=verify(x.before,scope,event);
  if(before.reason)return result('blocked',before.reason);
  const after=verify(x.after,scope,event);
  if(after.reason)return result('blocked',after.reason);
  if(before.claim_ref!==after.claim_ref||before.fingerprint!==after.fingerprint)
   return result('blocked','LATE_CHANGE_OR_REORDER');
  return result('review_only','CANDIDATE_ONLY');
 }catch{return result('blocked','INVALID_INPUT');}
}
