/**
 * AI-4 Wave1 Round-002: PROPOSAL ONLY for protected Starry OpenAPI routes.
 * NEVER import this file from the Cloudflare Worker entrypoint or publish
 * these paths in apps/api/openapi.yaml before AI-0's cross-owner Gate.
 * No fetch, auth token parsing, Store SDK, D1, Queue or dispatch.
 */
import {WAVE1_PURCHASE_AUTH_SCHEMA} from '../../../modules/starry-id-v1/src/wave1-purchase-entry-auth-gate.ts';
import {WAVE1_BILLING_CONTRACT} from '../../../packages/rebuild-billing/src/wave1-billing-revenuecat-review.ts';
import {WAVE1_SECURITY_FENCE_VERSION} from '../../../packages/rebuild-ai3/src/wave1-security-notification-fence.ts';

export const R002_PROTECTED_API_VERSION='starry.api.wave1.r002.protected-proposal.v1-offline' as const;
export const R002_PUBLIC_ROUTES_APPROVED=false as const;
export const R002_QUEUE_ACK_APPROVED=false as const;
export const R002_LIVE_AUTH_APPROVED=false as const;
export const R002_STORE_APPROVED=false as const;

export const R002_OWNER_CONTRACTS=Object.freeze({
 identity:WAVE1_PURCHASE_AUTH_SCHEMA,
 billing:WAVE1_BILLING_CONTRACT,
 notification:WAVE1_SECURITY_FENCE_VERSION
});
export type ProtectedRoute='purchase_entry'|'entitlement_review'|'notification_review';
export type RouteOwner='AI-1'|'AI-2'|'AI-3';
export type ProposedRoute=Readonly<{
 kind:ProtectedRoute;method:'POST';path:string;owner:RouteOwner;
 owner_contract:string;authentication:'SERVER_SIGNED_STARRY_SESSION_REQUIRED';
 lifecycle:'PROPOSED_NOT_REGISTERED';response_success_disabled:true;
 requires_ai0_gate:true;has_openapi_live_path:false;
 errors:readonly ['400','401','403','404','405','409','503'];
}>;
const ERRORS=Object.freeze(['400','401','403','404','405','409','503'] as const);
export const R002_PROPOSED_ROUTES:readonly ProposedRoute[]=Object.freeze([
 Object.freeze({kind:'purchase_entry',method:'POST',path:'/v1/identity/purchase-entry-review',
  owner:'AI-1',owner_contract:R002_OWNER_CONTRACTS.identity,
  authentication:'SERVER_SIGNED_STARRY_SESSION_REQUIRED',
  lifecycle:'PROPOSED_NOT_REGISTERED',response_success_disabled:true,
  requires_ai0_gate:true,has_openapi_live_path:false,errors:ERRORS}),
 Object.freeze({kind:'entitlement_review',method:'POST',path:'/v1/billing/entitlement-review',
  owner:'AI-2',owner_contract:R002_OWNER_CONTRACTS.billing,
  authentication:'SERVER_SIGNED_STARRY_SESSION_REQUIRED',
  lifecycle:'PROPOSED_NOT_REGISTERED',response_success_disabled:true,
  requires_ai0_gate:true,has_openapi_live_path:false,errors:ERRORS}),
 Object.freeze({kind:'notification_review',method:'POST',path:'/v1/notifications/delivery-review',
  owner:'AI-3',owner_contract:R002_OWNER_CONTRACTS.notification,
  authentication:'SERVER_SIGNED_STARRY_SESSION_REQUIRED',
  lifecycle:'PROPOSED_NOT_REGISTERED',response_success_disabled:true,
  requires_ai0_gate:true,has_openapi_live_path:false,errors:ERRORS})
] as const);

export type R002ReviewCode='INVALID_CANDIDATE_SHAPE'|'SCOPE_DENIED'|
 'PRODUCTION_DISABLED'|'ROUTE_NOT_REGISTERED'|'METHOD_NOT_ALLOWED'|
 'SERVER_SIGNED_SESSION_REQUIRED'|'OWNER_GATE_PENDING';
export type R002ProtectedReview=Readonly<{
 contract:typeof R002_PROTECTED_API_VERSION;
 status:'blocked';proposed_http_status:400|401|403|404|405|503;
 error_code:R002ReviewCode;owner:RouteOwner|null;
 owner_contract:string|null;
 source_level:'offline_proposal_not_an_http_route';
 may_authenticate:false;may_charge:false;may_grant:false;
 may_remove_ads:false;may_send_notification:false;may_ack_queue:false;
 may_write_d1:false;may_deploy:false;live:false;publishable:false;
}>;
const FLAGS=Object.freeze({
 source_level:'offline_proposal_not_an_http_route',
 may_authenticate:false,may_charge:false,may_grant:false,
 may_remove_ads:false,may_send_notification:false,may_ack_queue:false,
 may_write_d1:false,may_deploy:false,live:false,publishable:false
} as const);
const result=(status:R002ProtectedReview['proposed_http_status'],
 code:R002ReviewCode,route?:ProposedRoute):R002ProtectedReview=>Object.freeze({
 contract:R002_PROTECTED_API_VERSION,status:'blocked',proposed_http_status:status,
 error_code:code,owner:route?.owner??null,owner_contract:route?.owner_contract??null,
 ...FLAGS
});
function plain(input:unknown):Record<string,unknown>|null{
 try{
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const p=Object.getPrototypeOf(input);
  if(p!==Object.prototype&&p!==null)return null;
  const keys=['brand_id','app_id','environment','path','method','caller'];
  const own=Reflect.ownKeys(input);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(input,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   o[k]=d.value;
  }
  return o;
 }catch{return null;}
}
/** A proposed status-code review, NOT an HTTP handler or request authenticator.
 * All browser/UI claims and even "server_asserted" metadata stay untrusted.
 * Owner-signed session, D1, Store receipt and P05 issuer verification are
 * mandatory future GATE dependencies and NOT accepted from this input.
 */
export function reviewR002ProtectedProposal(input:unknown):R002ProtectedReview{
 const x=plain(input);
 if(!x||typeof x.brand_id!=='string'||typeof x.app_id!=='string'||
  typeof x.environment!=='string'||typeof x.path!=='string'||
  typeof x.method!=='string'||typeof x.caller!=='string')
  return result(400,'INVALID_CANDIDATE_SHAPE');
 if(x.environment==='production')return result(503,'PRODUCTION_DISABLED');
 if(x.brand_id!=='starry'||!/^starry-[a-z0-9-]{2,60}$/.test(x.app_id)||
  (x.environment!=='development'&&x.environment!=='staging'))
  return result(403,'SCOPE_DENIED');
 const route=R002_PROPOSED_ROUTES.find(r=>r.path===x.path);
 if(!route)return result(404,'ROUTE_NOT_REGISTERED');
 if(route.method!==x.method)return result(405,'METHOD_NOT_ALLOWED',route);
 if(x.caller!=='server_asserted')
  return result(401,'SERVER_SIGNED_SESSION_REQUIRED',route);
 return result(503,'OWNER_GATE_PENDING',route);
}

/** Explicit trust ordering only. No adapters, issuers or queues exist here. */
export const R002_P05_QUEUE_BOUNDARY=Object.freeze({
 proposed_schema:'starry.ai4.wave1.r002.p05-queue-boundary.v1-candidate',
 event_source:'AI-0_SINGLE_CANONICAL_SIGNED_P05_ISSUER_PENDING',
 auth_fence:'AI-1_SIGNED_EVENT_BOUND_SESSION_REVALIDATION_PENDING',
 notification_fence:R002_OWNER_CONTRACTS.notification,
 durable_receipt:'AI-3_DURABLE_INBOX_AND_DEDUPE_PENDING',
 legal_retention:'Q104_Q119_APPROVAL_PENDING',
 queue_commit:'ATOMIC_COMMIT_BEFORE_ACK_PENDING',
 real_queue_binding:false,may_ack:false,may_enqueue:false,
 may_emit_signed_event:false,verified_live:false
});
