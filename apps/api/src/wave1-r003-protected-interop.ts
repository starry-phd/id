/**
 * AI-4 Wave1 Round-003: an inert, versioned review of the *ordering* of
 * future protected OpenAPI/SDK and P05/Queue trust ports.
 *
 * NOT imported by the live Worker. NOT an Auth verifier, signer, D1 reader,
 * Queue implementation, HTTP route or a way to turn caller assertions into
 * authority. Even a flawless-looking trace is NEVER permission to ACK.
 */
import {
  R002_PROTECTED_API_VERSION,
  R002_PROPOSED_ROUTES
} from './wave1-r002-protected-route-proposal.ts';

export const R003_INTEROP_VERSION =
  'starry.ai4.wave1.r003.protected-interop.v1-offline-candidate' as const;
export const R003_UPSTREAM_CANDIDATES = Object.freeze({
  inherited_api: R002_PROTECTED_API_VERSION,
  auth: 'starry.auth.identity-authority.r003.v1-candidate',
  p05: 'starry.ai3.p05.commit-before-ack.r003.v1-candidate',
  authority: 'AI-0_SINGLE_CANONICAL_P05_ISSUER_PENDING'
} as const);
export const R003_REVIEW_ONLY = Object.freeze({
  protected_routes_registered: false,
  verified_signed_auth_live: false,
  canonical_p05_issuer_approved: false,
  lawful_q104_q119_approved: false,
  real_d1_commit_verified: false,
  independent_anti_pitr_verified: false,
  queue_ack_authorized: false,
  cloudflare_preview_authorized: false,
  may_write_d1: false,
  may_send: false,
  may_charge: false,
  may_grant: false,
  may_deploy: false
} as const);

/** Versioned server-side future ports: NO implementations, no trust supplied
 * by an HTTP body, no boolean "signature_verified" acceptance.
 * AI-0 owns issuer approval; AI-1 Auth; AI-3 receipt/legal; AI-4 transport.
 */
export type R003FutureAuthorityPorts = Readonly<{
  ai0_verifyCanonicalP05Source: (opaqueDelivery: unknown) => Promise<unknown>;
  ai1_readFreshEventBoundSession: (opaqueDelivery: unknown) => Promise<unknown>;
  ai3_readApprovedLawfulRetention: (opaqueDelivery: unknown) => Promise<unknown>;
  ai3_readCommittedDedupeReceipt: (opaqueDelivery: unknown) => Promise<unknown>;
  ai0_readIndependentAntiPitrWitness: (opaqueDelivery: unknown) => Promise<unknown>;
  ai4_ackOnlyAfterApprovedCommit: (opaqueDelivery: unknown) => Promise<never>;
}>;

export const R003_PROPOSED_HTTP = Object.freeze(R002_PROPOSED_ROUTES.map(route =>
  Object.freeze({
    path: route.path,
    method: route.method,
    domain_owner: route.owner,
    owner_contract: route.owner_contract,
    status: 'PROPOSED_NOT_REGISTERED' as const,
    server_signed_identity_required: true as const,
    public_openapi_path: false as const,
    executable_adapter: false as const
  })
));

export const R003_P05_ORDER = Object.freeze([
  'canonical-p05-verify',
  'current-session-fence',
  'lawful-q104-q119',
  'durable-receipt-read',
  'independent-anti-pitr-read',
  'commit-confirmed',
  'queue-ack'
] as const);

export type R003Reason =
  'INVALID_TRACE' | 'SCOPE_DENIED' | 'PRODUCTION_DISABLED' |
  'PREMATURE_QUEUE_ACK' | 'DUPLICATE_OR_REORDERED_STAGE' |
  'UNVERIFIED_CANONICAL_AUTHORITY' | 'GATE_NOT_AUTHORIZED';

export type R003Review = Readonly<{
  contract: typeof R003_INTEROP_VERSION;
  state: 'blocked';
  reason: R003Reason;
  stage_count: number;
  evidence_level: 'untrusted_offline_sequence_only';
  authorized: false;
  may_ack_queue: false;
  may_emit_p05: false;
  may_send_notification: false;
  may_write_d1: false;
  verified_live: false;
  publishable: false;
}>;

const DENY_FLAGS = Object.freeze({
  evidence_level: 'untrusted_offline_sequence_only',
  authorized: false, may_ack_queue: false, may_emit_p05: false,
  may_send_notification: false, may_write_d1: false,
  verified_live: false, publishable: false
} as const);

function denial(reason: R003Reason, stage_count = 0): R003Review {
  return Object.freeze({
    contract: R003_INTEROP_VERSION, state: 'blocked',
    reason, stage_count, ...DENY_FLAGS
  });
}

/** Read only own data descriptors. Getters, prototypes, proxies throwing,
 * unexpected keys and prototype pollution are never accepted as proofs.
 */
function exactOwnData(raw: unknown, keys: readonly string[]):
  Record<string, unknown> | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const actual = Reflect.ownKeys(raw);
    if (actual.length !== keys.length ||
      actual.some(k => typeof k !== 'string' || !keys.includes(k))) return null;
    const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const k of keys) {
      const d = Object.getOwnPropertyDescriptor(raw, k);
      if (!d || !d.enumerable || !('value' in d)) return null;
      value[k] = d.value;
    }
    return value;
  } catch {
    return null;
  }
}

/** Copy array entries by own data descriptors; do not run accessor code. */
function safeStageArray(raw: unknown): string[] | null {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype)
      return null;
    const len = Object.getOwnPropertyDescriptor(raw, 'length');
    if (!len || !('value' in len) || typeof len.value !== 'number' ||
      len.value > R003_P05_ORDER.length) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== len.value + 1) return null;
    const copy: string[] = [];
    for (let i = 0; i < len.value; i++) {
      const d = Object.getOwnPropertyDescriptor(raw, String(i));
      if (!d || !d.enumerable || !('value' in d) ||
        typeof d.value !== 'string') return null;
      copy.push(d.value);
    }
    return copy;
  } catch {
    return null;
  }
}

/** Review a deliberately UNTRUSTED description of order, not the evidence
 * itself. No future port is invoked here. Even every stage in order cannot
 * authorize a Queue ACK or imply actual physical D1 / independent witness.
 */
export function reviewR003QueueSequence(raw: unknown): R003Review {
  const x = exactOwnData(raw, [
    'brand_id', 'app_id', 'environment', 'event_ref', 'actor_ref', 'stages'
  ]);
  if (!x || typeof x.brand_id !== 'string' ||
    typeof x.app_id !== 'string' || typeof x.environment !== 'string' ||
    typeof x.event_ref !== 'string' || typeof x.actor_ref !== 'string' ||
    !Array.isArray(x.stages)) return denial('INVALID_TRACE');
  if (x.environment === 'production') return denial('PRODUCTION_DISABLED');
  if (x.brand_id !== 'starry' || x.app_id !== 'starry-id' ||
    (x.environment !== 'development' && x.environment !== 'staging'))
    return denial('SCOPE_DENIED');
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(x.event_ref) ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(x.actor_ref)) return denial('INVALID_TRACE');
  const stages = safeStageArray(x.stages);
  if (!stages) return denial('INVALID_TRACE');
  if (stages.length > R003_P05_ORDER.length ||
    stages.some(s => typeof s !== 'string' ||
      !(R003_P05_ORDER as readonly string[]).includes(s)))
    return denial('INVALID_TRACE');
  if (new Set(stages).size !== stages.length ||
    stages.some((stage, i) => stage !== R003_P05_ORDER[i])) {
    const ack = stages.indexOf('queue-ack');
    const commit = stages.indexOf('commit-confirmed');
    return denial(ack >= 0 && (commit < 0 || commit > ack)
      ? 'PREMATURE_QUEUE_ACK' : 'DUPLICATE_OR_REORDERED_STAGE', stages.length);
  }
  if (stages.length < R003_P05_ORDER.length)
    return denial('UNVERIFIED_CANONICAL_AUTHORITY', stages.length);
  // This string array is supplied by an untrusted caller, not by cryptographic
  // source verification, session recheck or transactional commit evidence.
  return denial('GATE_NOT_AUTHORIZED', stages.length);
}

export type R003PublicError = Readonly<{
  http_status: 400 | 401 | 403 | 404 | 405 | 409 | 503;
  body: Readonly<{
    error: Readonly<{
      code: 'INVALID_REQUEST' | 'AUTH_REQUIRED' | 'SCOPE_DENIED' |
        'ROUTE_NOT_AVAILABLE' | 'METHOD_NOT_ALLOWED' |
        'VERSION_CONFLICT' | 'OWNER_GATE_PENDING';
      message: 'Operation unavailable';
    }>;
  }>;
  source: 'sdk_error_proposal_not_worker_response';
  may_dispatch: false;
}>;
const STATUS_CODE = Object.freeze({
  400: 'INVALID_REQUEST', 401: 'AUTH_REQUIRED', 403: 'SCOPE_DENIED',
  404: 'ROUTE_NOT_AVAILABLE', 405: 'METHOD_NOT_ALLOWED',
  409: 'VERSION_CONFLICT', 503: 'OWNER_GATE_PENDING'
} as const);

/** Public SDK error-only serializer proposal. Takes a number, never returns
 * tokens, identities, request bodies, internal digests or live success status.
 */
export function proposeR003PublicError(status: unknown): R003PublicError {
  const code = typeof status === 'number' &&
    Number.isInteger(status) &&
    Object.prototype.hasOwnProperty.call(STATUS_CODE, status)
    ? status as keyof typeof STATUS_CODE : 503;
  return Object.freeze({
    http_status: code,
    body: Object.freeze({
      error: Object.freeze({
        code: STATUS_CODE[code], message: 'Operation unavailable' as const
      })
    }),
    source: 'sdk_error_proposal_not_worker_response' as const,
    may_dispatch: false as const
  });
}
