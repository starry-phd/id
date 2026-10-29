/**
 * AI-1 W1: Auth-owned contract CHECK, not another self-profile handler.
 * Reflects #244/#245 reviewed real HMAC/SQLite read. No public route, DB, token,
 * issuer, external side effect or approval. This is a fail-closed design guard
 * for future AI-4 shared-route / D06 field-name review.
 */
export const W1_AUTH_CONTRACT_VERSION = 'starry.ai1.w1.auth-boundary.review.v1' as const;
export const W1_AUTH_SELF_PATH = '/v1/starry-id/members/me' as const;
export const W1_AUTH_PROFILE_FIELDS = Object.freeze([
  's_user_id','display_name','directory_opt_in','display_name_public','profile_revision'
] as const);
export const W1_AUTH_EVENT_CORE_NAMES = Object.freeze([
  'event_id','event_type','schema_version','brand_id','app_id','environment',
  'occurred_at','correlation_id','resource_type','resource_id','result'
] as const);
export const W1_AUTH_EVENT_CONDITIONAL_NAME = 'idempotency_key' as const;
/** These names are review proposals for the *private* envelope, not G06 schema. */
export const W1_AUTH_PRIVATE_ENVELOPE_CANDIDATES = Object.freeze([
  'issuer','kid','issued_at','nonce','signature','auth_version',
  'session_version','session_ref_hash','actor_ref_hash'
] as const);
export const W1_AUTH_LIVE_ENABLED = false as const;
export type W1AuthReview = Readonly<{
  status:'review_only'|'denied'; reason:'EXACT_PUBLIC_FIELD_SET'|'UNAPPROVED_OR_PRIVATE_FIELD';
  may_publish:false; may_ack:false; may_write_live_d1:false; may_grant:false; verified_live:false;
}>;
const result=(status:W1AuthReview['status'],reason:W1AuthReview['reason']):W1AuthReview=>
 Object.freeze({status,reason,may_publish:false,may_ack:false,
  may_write_live_d1:false,may_grant:false,verified_live:false});
const deny=()=>result('denied','UNAPPROVED_OR_PRIVATE_FIELD');
/**
 * Accept ONLY an array of own literal field-NAMES for a design-level mapping.
 * Never accept field values, raw auth evidence, claims or arbitrary objects.
 * Status 'review_only' NEVER authorizes serialization, publishing or ACK.
 */
export function reviewW1AuthPublicCoreNames(value:unknown):W1AuthReview{
 try{
  if(!Array.isArray(value)||value.length<11||value.length>12)return deny();
  const allowed=new Set<string>(W1_AUTH_EVENT_CORE_NAMES);
  allowed.add(W1_AUTH_EVENT_CONDITIONAL_NAME);
  // Read indices directly, rejecting sparse arrays, accessors and proxy traps.
  const values:string[]=[];
  for(let i=0;i<value.length;i++){
   const own=Object.getOwnPropertyDescriptor(value,String(i));
   if(!own||!('value'in own)||typeof own.value!=='string'||!allowed.has(own.value))return deny();
   values.push(own.value);
  }
  const distinct=new Set(values);
  if(distinct.size!==value.length)return deny();
  if(W1_AUTH_EVENT_CORE_NAMES.some(x=>!distinct.has(x)))return deny();
  return result('review_only','EXACT_PUBLIC_FIELD_SET');
 }catch{return deny();}
}
/** Metadata-only candidate route shape; never accepts bearer/PII or client identity. */
export function reviewW1AuthReadRouteMetadata(value:unknown):W1AuthReview {
 if(!value||typeof value!=='object'||Array.isArray(value))return deny();
 try{
  if(Object.getPrototypeOf(value)!==Object.prototype)return deny();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(value).some(k=>typeof k!=='string')
    ||Object.values(descriptors).some(x=>!('value'in x)))return deny();
  const keys=Object.keys(value);
  if(keys.length!==4||!['method','path','brand_id','app_id'].every(k=>Object.hasOwn(value,k)))return deny();
  const raw=value as Record<string,unknown>;
  if(raw.method!=='GET'||raw.path!==W1_AUTH_SELF_PATH||raw.brand_id!=='starry'
    ||raw.app_id!=='starry-id')return deny();
  return result('review_only','EXACT_PUBLIC_FIELD_SET');
 }catch{return deny();}
}
