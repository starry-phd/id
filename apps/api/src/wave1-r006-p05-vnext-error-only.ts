/**
 * AI-4 Wave1 Round006: P05 vNext error-only public SDK & structural checker.
 * Follows AI-0 Issue #1 #6474929122 exactly. NOT a cryptographic verifier,
 * signer, trusted actor resolver, HTTP handler, D1 writer or Queue transport.
 * ALL incoming metadata is untrusted. Every returned outcome is blocked.
 */
import {AI0_R005_P05_VERSION,AI0_R005_P05_LIVE} from
  '../../../packages/integration/src/ai0-r005-p05-canonical-offline-verifier.ts';
import {R005_ENVELOPE_AUTH_VERSION,R005_ENVELOPE_AUTH_LIVE} from
  '../../../modules/starry-id-v1/src/wave1-round005-sealed-event-session-authority.ts';
import {R005_VERSION as R005_ADS_VERSION,R005_OFFLINE_ONLY,
  R005_PROTECTED_ROUTE_PINS} from './wave1-r005-admob-native-consent-gate.ts';
import {proposeR003PublicError} from './wave1-r003-protected-interop.ts';

export const R006_VERSION=
  'starry.ai4.r006.p05-vnext-error-only.v1-offline-candidate' as const;
export const R006_CANONICAL_VERSION=
  'starry.p05.canonical.vnext.offline-candidate' as const;
export const R006_CANONICAL_PURPOSE='p05_delivery_review_only' as const;
export const R006_HMAC_DOMAIN=
  'starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1' as const;
export const R006_FIELDS=Object.freeze([
  'version','purpose','brand_id','app_id','environment','event_id','event_type',
  'actor_ref','auth_version','session_version','idempotency_key','issuer_kid',
  'issuer_epoch','issued_at','expires_at','nonce','payload_sha256'
] as const);
export const R006_P05_DEPENDENCIES=Object.freeze({
  ai0_legacy_r005:AI0_R005_P05_VERSION,
  ai1_legacy_r005:R005_ENVELOPE_AUTH_VERSION,
  ai0_new_proposal:R006_CANONICAL_VERSION,
  auth_fence_approval:'PENDING_AI0_CANONICAL_GATE',
  ads:R005_ADS_VERSION,
  old_ai0_live:AI0_R005_P05_LIVE,
  old_ai1_live:R005_ENVELOPE_AUTH_LIVE,
  new_signer_authorized:false,
  new_crypto_verifier_authorized:false,
  new_hmac_key_installed:false,
  session_replay_ledger_authorized:false,
  live_ack_authorized:false
} as const);
/** No implementations. A claimed signature in a request is never a key lease. */
export type R006FutureP05Ports=Readonly<{
  ai0VerifyCanonicalEnvelope:(opaqueEvent:unknown)=>Promise<unknown>;
  ai1ReadFreshEventBoundSession:(opaqueEvent:unknown)=>Promise<unknown>;
  ai3ReadLawfulDurableReceipt:(opaqueEvent:unknown)=>Promise<unknown>;
  ai0ReadIndependentAntiPitrWitness:(opaqueEvent:unknown)=>Promise<unknown>;
  ai4AckOnlyAfterRealCommit:(gate:never)=>Promise<never>;
}>;

export type R006Reason=
 'INVALID_WRAPPER'|'INVALID_ENVELOPE'|'LEGACY_DIALECT_REJECTED'|
 'SCOPE_DENIED'|'PRODUCTION_BLOCKED'|'EVENT_TYPE_DENIED'|
 'BAD_TIME_OR_TTL'|'MAC_NOT_TRUSTED'|'OWNER_GATE_REQUIRED';
export type R006Review=Readonly<{
 contract:typeof R006_VERSION; status:'blocked'; reason:R006Reason;
 input_trust:'untrusted_offline_schema_only'; field_count:0|17;
 schema_candidate:boolean; may_verify_p05:false;
 may_authenticate:false; may_send:false; may_ack_queue:false;
 may_claim_receipt:false; may_charge:false; may_grant:false;
 may_initialize_ads:false; may_request_ad:false; may_deploy:false;
 publishable:false;
}>;
const DENIED=Object.freeze({
 input_trust:'untrusted_offline_schema_only',
 may_verify_p05:false,may_authenticate:false,may_send:false,
 may_ack_queue:false,may_claim_receipt:false,may_charge:false,
 may_grant:false,may_initialize_ads:false,may_request_ad:false,
 may_deploy:false,publishable:false
} as const);
function blocked(reason:R006Reason,schema_candidate=false):R006Review{
 return Object.freeze({
  contract:R006_VERSION,status:'blocked',reason,
  field_count:schema_candidate?17 as const:0 as const,
  schema_candidate,...DENIED
 });
}
/** No accessor reads; data-only strict structural review. */
function ownData(raw:unknown,keys:readonly string[],
 ordered=false):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  const names=Reflect.ownKeys(raw);
  if(names.length!==keys.length||
    names.some((v,i)=>typeof v!=='string'||
      (ordered?v!==keys[i]:!keys.includes(v))))return null;
  const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of keys){
   const d=Object.getOwnPropertyDescriptor(raw,key);
   if(!d||!d.enumerable||!('value' in d))return null;
   result[key]=d.value;
  }
  return result;
 }catch{return null;}
}
const ID=/^[A-Za-z0-9._:-]{8,120}$/;
const APP=/^[A-Za-z0-9._:-]{3,120}$/;
const KID=/^[a-z0-9][a-z0-9._-]{2,63}$/;
const NONCE=/^[A-Za-z0-9_-]{16,64}$/;
const HEX=/^[0-9a-f]{64}$/;
const EVENTS=new Set([
 'notification.delivery.queued','identity.session.revoked',
 'identity.member.deleted','privacy.erasure.requested'
]);
const safeNonnegative=(v:unknown):v is number=>
 typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;

/** Does NOT check cryptography or invoke any injected port. Passing schema
 * can NEVER produce may_verify_p05 true, Queue ACK or read Auth.
 */
export function reviewR006P05VNextSchema(raw:unknown,nowSeconds:unknown):R006Review{
 const w=ownData(raw,['envelope','mac_hex']);
 if(!w){
  const old=ownData(raw,['event','signature_hex'])||
    ownData(raw,['envelope','mac']);
  return blocked(old?'LEGACY_DIALECT_REJECTED':'INVALID_WRAPPER');
 }
 const e=ownData(w.envelope,R006_FIELDS,true);
 if(!e)return blocked('INVALID_ENVELOPE');
 if(e.version!==R006_CANONICAL_VERSION||
   e.purpose!==R006_CANONICAL_PURPOSE||
   typeof w.mac_hex!=='string'||!HEX.test(w.mac_hex)||
   typeof e.app_id!=='string'||!APP.test(e.app_id)||
   typeof e.event_id!=='string'||!ID.test(e.event_id)||
   typeof e.actor_ref!=='string'||!ID.test(e.actor_ref)||
   typeof e.idempotency_key!=='string'||!ID.test(e.idempotency_key)||
   typeof e.issuer_kid!=='string'||!KID.test(e.issuer_kid)||
   typeof e.nonce!=='string'||!NONCE.test(e.nonce)||
   typeof e.payload_sha256!=='string'||!HEX.test(e.payload_sha256)||
   !safeNonnegative(e.auth_version)||e.auth_version===0||
   !safeNonnegative(e.session_version)||e.session_version===0||
   !safeNonnegative(e.issuer_epoch)||e.issuer_epoch===0)
  return blocked('INVALID_ENVELOPE');
 if(e.environment==='production')return blocked('PRODUCTION_BLOCKED');
 if(e.brand_id!=='starry'||
   (e.environment!=='development'&&e.environment!=='staging'))
  return blocked('SCOPE_DENIED');
 if(typeof e.event_type!=='string'||!EVENTS.has(e.event_type))
  return blocked('EVENT_TYPE_DENIED');
 if(!safeNonnegative(e.issued_at)||!safeNonnegative(e.expires_at)||
   !safeNonnegative(nowSeconds)||e.expires_at<=e.issued_at||
   e.expires_at-e.issued_at>120||
   e.issued_at>nowSeconds+5||e.expires_at<nowSeconds)
  return blocked('BAD_TIME_OR_TTL');
 // Lowercase 64-hex matching a shape is not a verified MAC.
 return blocked('OWNER_GATE_REQUIRED',true);
}

export const R006_PUBLIC_ROUTES=Object.freeze(
 R005_PROTECTED_ROUTE_PINS.map(r=>Object.freeze({
  path:r.path,method:r.method,owner:r.owner,
  lifecycle:'UNREGISTERED_ERROR_ONLY_PROPOSAL' as const,
  p05_version:R006_CANONICAL_VERSION,
  ai1_auth_version:R005_ENVELOPE_AUTH_VERSION,
  public_success_authorized:false as const,
  real_worker_registered:false as const
 }))
);
export const R006_ADS_OFF=Object.freeze({
 provider:'google-admob-mediation',
 native_consent_trusted:R005_OFFLINE_ONLY.consent_ump_trusted,
 ads_sdk_initialized:R005_OFFLINE_ONLY.sdk_initialized,
 ad_requests_enabled:R005_OFFLINE_ONLY.ad_requests_allowed,
 native_app_id_authorized:false,
 ad_unit_authorized:false,
 cross_app_remove_ads_authorized:false
});
export type R006PublicError=Readonly<{
 contract:typeof R006_VERSION;
 http_status:400|401|403|404|405|409|503;
 body:Readonly<{error:Readonly<{code:string;message:'Operation unavailable'}>}>;
 origin:'sdk_proposal_not_worker_response';may_dispatch:false;may_ack:false;
 may_send:false;may_grant:false;may_charge:false;
}>;
/** No identifiers, MACs, sessions or raw error body ever escape. */
export function proposeR006PublicError(status:unknown):R006PublicError{
 const safe=proposeR003PublicError(status);
 return Object.freeze({
  contract:R006_VERSION,http_status:safe.http_status,
  body:safe.body,origin:'sdk_proposal_not_worker_response' as const,
  may_dispatch:false as const,may_ack:false as const,
  may_send:false as const,may_grant:false as const,
  may_charge:false as const
 });
}
