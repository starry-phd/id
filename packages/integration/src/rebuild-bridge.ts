/**
 * AI-4 composition-only contract: bridges AI-1 server-issued opaque principal to
 * AI-2 sandbox planner; no HTTP-to-principal casting or issued store rights.
 * Billing -> Audit envelope remains a pending AI-0 P05 proposal (not publishable).
 */
import {isTrustedPrincipal} from '../../../modules/starry-id-v1/src/index.ts';
import type {TrustedScope} from '../../../modules/starry-id-v1/src/index.ts';
import type {VerifiedStarryIdentity} from '../../../modules/starry-id-v1/src/billing-bridge.ts';
import type {OutboxCandidate} from '../../rebuild-billing/src/index.ts';
export function verifiedBillingIdentity(
  principal: unknown, scope: TrustedScope, now: number,
  lookupServerBinding: (sUserId:string)=>string|null,
):VerifiedStarryIdentity {
  if(!isTrustedPrincipal(principal)||scope.brand_id!=='starry'
    ||principal.brand_id!=='starry'||principal.member_status!=='active'
    ||principal.app_id!==scope.app_id||principal.environment!==scope.environment
    ||!Number.isSafeInteger(now)||now<principal.checked_at||now-principal.checked_at>60
    ||now>=principal.expires_at) throw new Error('AI4_BILLING_TRUST_DENIED');
  const binding=lookupServerBinding(principal.s_user_id);
  if(typeof binding!=='string'||!/^[A-Za-z0-9._:-]{1,180}$/.test(binding))
    throw new Error('AI4_ACCOUNT_BINDING_DENIED');
  return Object.freeze({brandId:'starry' as const,appId:principal.app_id,
    environment:principal.environment,userId:principal.s_user_id,accountBinding:binding});
}
export const P05_REBUILD_GATE_STATUS='CANDIDATE_NOT_APPROVED' as const;
export type ProposedBillingAuditEnvelope=Readonly<{
  schema_version: 'candidate-not-approved'; event_id:string;
  event_type:'billing.store_state_observed'; brand_id:'starry'; app_id:string;
  environment:'development'|'staging'; store_environment:'sandbox';
  correlation_id:string; idempotency_key:string; resource_type:'billing_transaction';
  resource_ref:string; result:'observed'|'historical';
  classification:'metadata_only'; publishable:false;
}>;
/** Never enqueue or write this candidate. AI-3 schema intentionally does NOT accept it. */
export function proposeBillingAuditEnvelope(
  outbox:OutboxCandidate,scope:TrustedScope,
):ProposedBillingAuditEnvelope {
  const keys=['eventId','eventType','brandId','appId','environment','storeEnvironment',
    'idempotencyKey','correlationId','resourceType','resourceId','result'];
  if(!outbox || typeof outbox!=='object'||Array.isArray(outbox)
    || Object.getPrototypeOf(outbox)!==Object.prototype
    || Reflect.ownKeys(outbox).length!==keys.length
    || Reflect.ownKeys(outbox).some(k=>typeof k!=='string'||!keys.includes(k))) throw new Error('AI4_P05_QUARANTINE');
  if(scope.brand_id!=='starry'||scope.app_id!==outbox.appId
    ||scope.environment!==outbox.environment
    ||(outbox.environment!=='development'&&outbox.environment!=='staging')
    ||outbox.brandId!=='starry'||outbox.eventType!=='billing.store_state_observed'
    ||outbox.storeEnvironment!=='sandbox'||outbox.resourceType!=='billing_transaction'
    ||!['observed','historical'].includes(outbox.result)
    ||![outbox.eventId,outbox.correlationId,outbox.resourceId].every(x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(x))
    ||!/^b_[a-f0-9]{64}$/.test(outbox.idempotencyKey)) throw new Error('AI4_P05_QUARANTINE');
  return Object.freeze({schema_version:'candidate-not-approved' as const,event_id:outbox.eventId,
    event_type:'billing.store_state_observed' as const,brand_id:'starry' as const,app_id:outbox.appId,
    environment:outbox.environment as 'development'|'staging',store_environment:'sandbox' as const,
    correlation_id:outbox.correlationId,idempotency_key:outbox.idempotencyKey,
    resource_type:'billing_transaction' as const,resource_ref:outbox.resourceId,
    result:outbox.result,classification:'metadata_only' as const,publishable:false as const});
}
