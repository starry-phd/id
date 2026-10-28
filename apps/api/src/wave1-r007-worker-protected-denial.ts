/**
 * AI-4 R007: OFFLINE-ONLY status evidence for unregistered protected transport.
 * This is not an HTTP handler, verification authority, deployment gate, or
 * release permission. Do not wire it into Workers routes or live SDKs.
 * Caller input is untrusted and deliberately never inspected or forwarded.
 */
import {R006_CANONICAL_VERSION, R006_PUBLIC_ROUTES} from
  './wave1-r006-p05-vnext-error-only.ts';

export const R007_VERSION=
  'starry.ai4.r007.worker-protected-denial.v1-offline-candidate' as const;

export const R007_PROTECTED_PINS=Object.freeze(
  R006_PUBLIC_ROUTES.map(r=>Object.freeze({
    path:r.path,method:r.method,owner:r.owner,
    canonical_p05:R006_CANONICAL_VERSION,
    actual_worker_registered:false as const,
    public_success_authorized:false as const
  }))
);

export type R007Blocked=Readonly<{
  contract:typeof R007_VERSION;
  state:'blocked';
  reason:'PROTECTED_ROUTE_NOT_REGISTERED';
  authority:'offline_review_only';
  may_verify:false;may_authenticate:false;may_dispatch:false;
  may_send:false;may_ack_queue:false;may_grant:false;
  may_initialize_ads:false;may_request_ad:false;
  may_deploy:false;publishable:false;
}>;

const BLOCKED=Object.freeze({
  contract:R007_VERSION,
  state:'blocked',
  reason:'PROTECTED_ROUTE_NOT_REGISTERED',
  authority:'offline_review_only',
  may_verify:false,may_authenticate:false,may_dispatch:false,
  may_send:false,may_ack_queue:false,may_grant:false,
  may_initialize_ads:false,may_request_ad:false,
  may_deploy:false,publishable:false
} as const);

/** Always returns a frozen, redact-safe refusal; no getters or network I/O. */
export function reviewR007UnregisteredTransport(_untrusted:unknown):R007Blocked{
  return BLOCKED;
}
