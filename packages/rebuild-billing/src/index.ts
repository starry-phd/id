/** Starry rebuild BILL-001 sandbox contract ONLY. Never use this as a store verifier. */
import { isTrustedPrincipal } from '../../../modules/starry-id-v1/src/index.ts';
export type RuntimeEnvironment = 'development' | 'staging' | 'production';
export type StoreEnvironment = 'sandbox' | 'production';
export type Store = 'apple' | 'google';
export type ProductKind = 'subscription' | 'non_consumable';
export type StoreState = 'PAID' | 'RENEWED' | 'REFUNDED' | 'CHARGEBACK' | 'EXPIRED' | 'GRACE_PERIOD' | 'ON_HOLD' | 'REVOKED';
export type Right = 'active' | 'inactive';

export interface ServerRegistry {
  readonly brandId: 'starry';
  readonly appId: string;
  readonly environment: RuntimeEnvironment; // Worker runtime, never the store state
  readonly storeEnvironment: StoreEnvironment;
  readonly store: Store;
  readonly storeAppId: string;
  readonly catalog: Readonly<Record<string, ProductKind>>; // server-owned, approved test SKUs only
}
/** No exportable VerifiedStarryIdentity DTO: principal must be issued inside AI-1 WeakSet. */
/** Must be constructed exclusively by a *real* authoritative store adapter in production.
 * This round uses a fake verifier solely in offline tests. */
export interface AuthoritativeStoreSnapshot {
  readonly brandId: 'starry'; readonly appId: string;
  readonly store: Store; readonly storeEnvironment: StoreEnvironment;
  readonly storeAppId: string; readonly sku: string; readonly kind: ProductKind;
  readonly originalTransactionId: string; readonly transactionId: string;
  readonly providerEventId: string; readonly accountBinding: string;
  readonly periodStartedAt: string; readonly expiresAt: string | null;
  readonly effectiveAt: string; readonly state: StoreState;
}
export interface PreviousPurchase {
  readonly userId: string; readonly accountBinding: string;
}
export interface EntitlementProjection {
  readonly userId: string; readonly appId: string; readonly sku: string;
  readonly originalTransactionId: string; readonly periodStartedAt: string;
  readonly transactionId: string; readonly state: StoreState; readonly lastEffectiveAt: string;
  readonly validUntil: string | null; readonly right: Right;
}
export interface ExistingEvent {
  readonly payloadDigest: string;
}
export interface DomainLedgerRead {
  /** The first-claim lock and ALL writes must later be atomic within the Billing D1 owner. */
  ownerForOriginalTransaction(s: AuthoritativeStoreSnapshot): PreviousPurchase | null;
  latestEntitlement(s: AuthoritativeStoreSnapshot, userId: string): EntitlementProjection | null;
  existingEvent(eventKey: string): ExistingEvent | null;
}
export interface StarryAuthPort {
  /** Must call AI-1 createServerIdentityResolver on this request; never trust HTTP JSON. */
  resolveTrustedPrincipal(): Promise<unknown>;
  /** From server-owned Starry ID to provider binding mapping, never a client-supplied ID. */
  accountBindingFor(sUserId: string, registry: ServerRegistry): Promise<string | null>;
  /** Pseudonymous audit actor ref issued by trusted server, NOT raw s_user_id. */
  opaqueActorRefFor(sUserId: string, registry: ServerRegistry): Promise<string | null>;
}
export interface StorePort {
  /** In real integration verify Apple JWS / Apple API or Google API, NOT client markers. */
  verifySandboxEvidence(opaqueEvidence: unknown, store: Store): AuthoritativeStoreSnapshot;
}
export interface BillingPorts {
  readonly registry: ServerRegistry; readonly auth: StarryAuthPort;
  readonly store: StorePort; readonly ledger: DomainLedgerRead;
}
export interface OutboxCandidate {
  readonly eventId: string; readonly eventType: 'billing.store_state_observed';
  readonly brandId: 'starry'; readonly appId: string;
  readonly environment: RuntimeEnvironment; readonly storeEnvironment: 'sandbox';
  readonly idempotencyKey: string; readonly correlationId: string;
  readonly resourceType: 'billing_transaction'; readonly resourceId: string;
  readonly result: 'observed' | 'historical';
}
/** Candidate only: AI-0/AI-3 must approve a single shared P05 schema and audit receiver. */
export interface BillingP05Candidate {
  readonly brand_id: 'starry'; readonly app_id: string; readonly environment: RuntimeEnvironment;
  readonly schema_version: 'billing.p05.v1-candidate';
  readonly event_id: string; readonly event_type: 'billing.store_state_observed';
  readonly occurred_at: string; readonly correlation_id: string; readonly idempotency_key: string;
  readonly actor_ref: string; readonly resource_ref: string; readonly result: 'recorded';
  readonly classification: 'metadata_only';
}
export type Plan =
  | {readonly disposition: 'duplicate'; readonly idempotencyKey: string}
  | {readonly disposition: 'new'; readonly idempotencyKey: string; readonly payloadDigest: string;
     readonly owner: PreviousPurchase; readonly snapshot: AuthoritativeStoreSnapshot;
     readonly entitlement: EntitlementProjection; readonly outbox: OutboxCandidate;
     readonly p05: BillingP05Candidate; readonly entitlementChanged: boolean};
function ensure(condition:unknown, error:string):asserts condition { if(!condition)throw new Error(error); }
function identifier(value:unknown):value is string {
  return typeof value==='string' && /^[A-Za-z0-9._:-]{1,180}$/.test(value);
}
/** RFC3339 with mandatory timezone, validity checked including calendar and offset bounds. */
function parseTime(value:unknown):number {
  ensure(typeof value==='string', 'INVALID_TIME');
  const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(Z|([+-])(\d\d):(\d\d))$/.exec(value);
  ensure(m!==null, 'INVALID_TIME');
  const [year,month,day,hour,min,sec]=m.slice(1,7).map(Number);
  const zoneHour=m[9]?Number(m[9]):0,zoneMin=m[10]?Number(m[10]):0;
  ensure(year>=1 && month>=1 && month<=12 && day>=1 && day<=31 && hour<=23 && min<=59 && sec<=59 && zoneHour<=23 && zoneMin<=59,'INVALID_TIME');
  const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
  ensure(day<=daysInMonth,'INVALID_TIME');
  const parsed=Date.parse(value);
  ensure(Number.isFinite(parsed),'INVALID_TIME');
  return parsed;
}
function checkRegistry(c:ServerRegistry):void {
  ensure(c.brandId==='starry' && identifier(c.appId) && identifier(c.storeAppId), 'REGISTRY_DENIED');
  ensure((c.environment==='development'||c.environment==='staging')&&c.storeEnvironment==='sandbox','SANDBOX_ONLY');
  ensure(c.store==='apple'||c.store==='google','STORE_DENIED');
}
function snapshotCanonical(s:AuthoritativeStoreSnapshot,c:ServerRegistry):string {
  // Stable schema version and explicit ordered fields; never include raw receipt/token/PII.
  return JSON.stringify(['billing-v1',c.brandId,c.appId,c.environment,c.storeEnvironment,c.store,c.storeAppId,
    s.sku,s.kind,s.originalTransactionId,s.transactionId,s.providerEventId,s.accountBinding,
    s.periodStartedAt,s.expiresAt,s.effectiveAt,s.state]);
}
/** WebCrypto SHA256 works in Node 22 and Workers. Both ids are safe hex, replay stable. */
async function digest(value:string):Promise<string> {
  const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
}
const DANGEROUS=new Set<StoreState>(['REFUNDED','CHARGEBACK','REVOKED']);
function chooseEntitlement(
  s:AuthoritativeStoreSnapshot,prior:EntitlementProjection|null,userId:string,nowMs:number,
):{projection:EntitlementProjection;changed:boolean;historical:boolean} {
  const eventPeriod=parseTime(s.periodStartedAt),eventTime=parseTime(s.effectiveAt);
  const priorPeriod=prior?parseTime(prior.periodStartedAt):null;
  const old=priorPeriod!==null && eventPeriod<priorPeriod;
  // An event for an old renewal period never revokes a later renewal period.
  if(old) return {projection:prior!,changed:false,historical:true};
  const sticky=prior!==null && eventPeriod===priorPeriod && DANGEROUS.has(prior.state)
    && !DANGEROUS.has(s.state);
  // A refund/chargeback/revoke is sticky for the same period until a separately-approved restore policy.
  if(sticky) return {projection:prior!,changed:false,historical:true};
  if(prior && eventPeriod===priorPeriod && eventTime<parseTime(prior.lastEffectiveAt))
    return {projection:prior,changed:false,historical:true};
  const expiresMs=s.expiresAt===null?null:parseTime(s.expiresAt);
  const isActive=(s.state==='PAID'||s.state==='RENEWED') &&
    (s.kind==='non_consumable'||(expiresMs!==null&&expiresMs>nowMs));
  const next:EntitlementProjection={userId,appId:s.appId,sku:s.sku,
    originalTransactionId:s.originalTransactionId,periodStartedAt:s.periodStartedAt,
    transactionId:s.transactionId,state:s.state,lastEffectiveAt:s.effectiveAt,validUntil:s.expiresAt,
    right:isActive?'active':'inactive'};
  return {projection:next,changed:JSON.stringify(prior)!==JSON.stringify(next),historical:false};
}
/** Pure-orchestration sandbox plan: NO DB write, no real verifier and NO right issuance. */
export async function planSandboxPurchase(
  untrustedRequest:unknown,ports:BillingPorts,serverNow:string,
):Promise<Plan> {
  checkRegistry(ports.registry);
  const nowMs=parseTime(serverNow);
  ensure(typeof untrustedRequest==='object'&&untrustedRequest!==null&&!Array.isArray(untrustedRequest), 'CLIENT_CLAIMS_DENIED');
  const request=untrustedRequest as Record<string,unknown>;
  ensure(Object.keys(request).sort().join('|')==='evidence|store' && request.store===ports.registry.store
    && typeof request.evidence==='string' && request.evidence.length>0, 'CLIENT_CLAIMS_DENIED');
  const rawPrincipal=await ports.auth.resolveTrustedPrincipal();
  // WeakSet-attestation in actual AI-1 module: structured clones/client JSON cannot mint identity.
  ensure(isTrustedPrincipal(rawPrincipal)
    && rawPrincipal.brand_id==='starry' && rawPrincipal.member_status==='active'
    && rawPrincipal.app_id===ports.registry.appId
    && rawPrincipal.environment===ports.registry.environment
    && rawPrincipal.expires_at>Math.floor(nowMs/1000)
    && rawPrincipal.checked_at<=Math.floor(nowMs/1000)
    && Math.floor(nowMs/1000)-rawPrincipal.checked_at<=60
    && identifier(rawPrincipal.s_user_id), 'AUTH_DENIED');
  const userId=rawPrincipal.s_user_id;
  const accountBinding=await ports.auth.accountBindingFor(userId,ports.registry);
  const actorRef=await ports.auth.opaqueActorRefFor(userId,ports.registry);
  ensure(identifier(accountBinding) && identifier(actorRef) && actorRef!==userId
    && actorRef!==accountBinding,'SERVER_BINDING_DENIED');
  const s=ports.store.verifySandboxEvidence(request.evidence,ports.registry.store);
  ensure(s.brandId==='starry' && s.appId===ports.registry.appId
    && s.store===ports.registry.store && s.storeEnvironment==='sandbox'
    && s.storeAppId===ports.registry.storeAppId,'PROVIDER_SCOPE_DENIED');
  for(const id of [s.sku,s.originalTransactionId,s.transactionId,s.providerEventId,s.accountBinding])
    ensure(identifier(id),'PROVIDER_ID_DENIED');
  ensure(!/battery/i.test(s.sku) && s.kind===ports.registry.catalog[s.sku], 'SKU_DENIED');
  ensure(['PAID','RENEWED','REFUNDED','CHARGEBACK','EXPIRED','GRACE_PERIOD','ON_HOLD','REVOKED'].includes(s.state), 'STATE_DENIED');
  ensure(s.accountBinding===accountBinding,'ACCOUNT_BINDING_DENIED');
  const started=parseTime(s.periodStartedAt), effective=parseTime(s.effectiveAt);
  ensure(started<=effective,'EVENT_TIME_DENIED');
  if(s.kind==='subscription'&&(s.state==='PAID'||s.state==='RENEWED'))
    ensure(s.expiresAt!==null&&parseTime(s.expiresAt)>started,'EXPIRY_REQUIRED');
  if(s.expiresAt!==null) parseTime(s.expiresAt);
  if(s.kind==='non_consumable')ensure(s.state!=='RENEWED','STATE_DENIED');
  const existingOwner=ports.ledger.ownerForOriginalTransaction(s);
  ensure(existingOwner===null ||(existingOwner.userId===userId
    && existingOwner.accountBinding===accountBinding),'PURCHASE_ALREADY_BOUND');
  const owner:PreviousPurchase=existingOwner??{
    userId,accountBinding};
  // Unique domain-scoped key must NOT come from client, raw evidence, or a fake paid flag.
  const eventKey='b_'+await digest(JSON.stringify(['rebuild-billing-event-v1',
    ports.registry.brandId,ports.registry.appId,ports.registry.environment,
    ports.registry.storeEnvironment,ports.registry.store,ports.registry.storeAppId,
    s.originalTransactionId,s.transactionId,s.providerEventId]));
  const payloadDigest=await digest(snapshotCanonical(s,ports.registry));
  const seen=ports.ledger.existingEvent(eventKey);
  if(seen){
    ensure(seen.payloadDigest===payloadDigest,'IDEMPOTENCY_CONFLICT');
    return {disposition:'duplicate',idempotencyKey:eventKey};
  }
  const previous=ports.ledger.latestEntitlement(s,userId);
  if(previous)ensure(previous.userId===userId&&previous.appId===s.appId
    && previous.originalTransactionId===s.originalTransactionId,'ENTITLEMENT_OWNER_DENIED');
  const chosen=chooseEntitlement(s,previous,userId,nowMs);
  const outbox:OutboxCandidate={eventId:s.providerEventId,eventType:'billing.store_state_observed',
    brandId:'starry',appId:ports.registry.appId,environment:ports.registry.environment,
    storeEnvironment:'sandbox',idempotencyKey:eventKey,
    correlationId:eventKey,resourceType:'billing_transaction',resourceId:s.transactionId,
    result:chosen.historical?'historical':'observed'};
  const p05:BillingP05Candidate={
    brand_id:'starry',app_id:ports.registry.appId,environment:ports.registry.environment,
    schema_version:'billing.p05.v1-candidate',
    event_id:eventKey,event_type:'billing.store_state_observed',
    occurred_at:s.effectiveAt,correlation_id:eventKey,idempotency_key:eventKey,
    actor_ref:actorRef,resource_ref:eventKey,result:'recorded',
    classification:'metadata_only',
  };
  return {disposition:'new',idempotencyKey:eventKey,payloadDigest,owner,
    snapshot:s,entitlement:chosen.projection,outbox,p05,entitlementChanged:chosen.changed};
}
