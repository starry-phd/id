/** AI-3 Starry-only design contracts. Not an Auth service or deployed API. */
export const BATTERY_POLICY = Object.freeze({
  brand_id: 'starry', pricing: 'free', purchasable: false,
  billing_grants_enabled: false, wallet_enabled: false,
  reserve_enabled: false, debit_enabled: false,
  expiry_enabled: false, overdraft_enabled: false,
});
export type Environment = 'development' | 'staging' | 'production';
export type Scope = Readonly<{ brand_id: 'starry'; app_id: string; environment: Environment }>;
export type EventEnvelope = Scope & Readonly<{
  event_id: string; event_type: string; schema_version: string;
  occurred_at: string; correlation_id: string;
  resource_type: string; resource_id: string; result: string;
  idempotency_key?: string;
}>;
export type AuditRecord = EventEnvelope & Readonly<{
  actor_kind: 'user' | 'service' | 'system' | 'anonymous';
  actor_id: string | null; permission: string; action: string;
  approval_ref?: string;
}>;
export type NotificationRequest = Readonly<{
  event: EventEnvelope; recipient_ref: string;
  channel: 'inbox' | 'email' | 'push'; template_id: string;
}>;
const EVENT_KEYS = new Set([
  'event_id', 'event_type', 'schema_version', 'brand_id', 'app_id',
  'environment', 'occurred_at', 'correlation_id', 'resource_type',
  'resource_id', 'result', 'idempotency_key',
]);
const AUDIT_KEYS = new Set([...EVENT_KEYS, 'actor_kind', 'actor_id', 'permission', 'action', 'approval_ref']);
const OPAQUE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_LABEL = /^[A-Za-z0-9._:-]{1,128}$/;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function allowedKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => keys.has(key));
}
function safeLabel(value: unknown): value is string {
  return typeof value === 'string' && SAFE_LABEL.test(value);
}
function opaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID.test(value);
}
/** Candidate #19's RFC3339 predicate; single shared owner remains AI-0. */
function rfc3339Timestamp(value: unknown): boolean {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
function environment(value: unknown): value is Environment {
  return value === 'development' || value === 'staging' || value === 'production';
}
/** Parity candidate for AI-0 PR #19 P05 envelope. Unknown/PII keys rejected. */
export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (!record(value) || !allowedKeys(value, EVENT_KEYS)) return false;
  return value.brand_id === 'starry' && environment(value.environment)
    && safeLabel(value.app_id) && opaqueId(value.event_id)
    && safeLabel(value.event_type) && safeLabel(value.schema_version)
    && rfc3339Timestamp(value.occurred_at) && opaqueId(value.correlation_id)
    && safeLabel(value.resource_type) && opaqueId(value.resource_id)
    && safeLabel(value.result)
    && (value.idempotency_key === undefined || opaqueId(value.idempotency_key));
}
/** Strict append-only metadata: no freeform notes, tokens, emails, or before/after PII. */
export function isAuditRecord(value: unknown): value is AuditRecord {
  if (!record(value) || !allowedKeys(value, AUDIT_KEYS)) return false;
  const envelope = Object.fromEntries(Object.entries(value).filter(([key]) => EVENT_KEYS.has(key)));
  const actorKinds = ['user', 'service', 'system', 'anonymous'];
  return isEventEnvelope(envelope)
    && actorKinds.includes(String(value.actor_kind))
    && ((value.actor_kind === 'anonymous' && value.actor_id === null)
      || (value.actor_kind !== 'anonymous' && opaqueId(value.actor_id)))
    && safeLabel(value.permission) && safeLabel(value.action)
    && (value.approval_ref === undefined || opaqueId(value.approval_ref));
}
/** Trusted scope must originate from server settings, never a request parameter. */
export function assertScope(trusted: Scope, actual: unknown): void {
  if (!record(actual) || trusted.brand_id !== 'starry'
    || !safeLabel(trusted.app_id) || !environment(trusted.environment)
    || actual.brand_id !== trusted.brand_id || actual.app_id !== trusted.app_id
    || actual.environment !== trusted.environment) throw new Error('AI3_SCOPE_DENIED');
}
/** Battery's only approved draft capability is read-only free-policy status. */
export function assertBatteryCapability(trusted: Scope, actual: unknown, capability: string): void {
  assertScope(trusted, actual);
  if (capability !== 'battery.policy.read') throw new Error('BATTERY_OPERATION_NOT_APPROVED');
}
/** SERVER ONLY. AI-1 cryptographically verifies principals and reads live session/member/grant/consent state before returning these decisions. This is not an Auth service. */
export type Ai1PolicyDecision = Readonly<{ allowed: boolean; reason?: string }>;
export type Ai1ServerTrustGateway = Readonly<{
  authorizeAdmin: (scope: Scope, operation: Readonly<{resource:'system';action:'read'}>) => Promise<Ai1PolicyDecision>;
  authorizeSession: (scope: Scope) => Promise<Ai1PolicyDecision>;
  resolveNotificationDelivery: (scope: Scope, event: EventEnvelope) => Promise<Readonly<{
    recipient_ref: string; allowed_channels: readonly ('inbox'|'email'|'push')[];
  }> | null>;
}>;
const NOTIFICATION_KEYS = new Set(['event','recipient_ref','channel','template_id']);
function denial(code:string):never { throw new Error(code); }
/** Dependency injection MUST be done by trusted Worker composition, never from an HTTP request/body. */
export function bindAi3TrustedOperations(trusted:Scope, ai1:Ai1ServerTrustGateway) {
  assertScope(trusted,trusted);
  return Object.freeze({
    async assertAuditRead(actual:unknown):Promise<void> {
      assertScope(trusted,actual);
      const decision=await ai1.authorizeAdmin(trusted,{resource:'system',action:'read'});
      if(!record(decision)||decision.allowed!==true)denial('AUDIT_ACCESS_DENIED');
    },
    async assertNotificationDelivery(request:unknown):Promise<void> {
      if(!record(request)||!allowedKeys(request,NOTIFICATION_KEYS)||!isEventEnvelope(request.event))
        denial('NOTIFICATION_DENIED');
      const event=request.event as EventEnvelope;
      assertScope(trusted,event);
      if(!opaqueId(request.recipient_ref)||!safeLabel(request.template_id)
        ||!['inbox','email','push'].includes(String(request.channel)))denial('NOTIFICATION_DENIED');
      const session=await ai1.authorizeSession(trusted);
      if(!record(session)||session.allowed!==true)denial('NOTIFICATION_DENIED');
      const prefs=await ai1.resolveNotificationDelivery(trusted,event);
      if(!record(prefs)||!opaqueId(prefs.recipient_ref)
        ||!Array.isArray(prefs.allowed_channels)
        ||!prefs.allowed_channels.every(x=>['inbox','email','push'].includes(x))
        ||request.recipient_ref!==prefs.recipient_ref
        ||!prefs.allowed_channels.includes(request.channel))
        denial('NOTIFICATION_DENIED');
    }
  });
}
export type BillingAuditDisposition='ready'|'duplicate'|'stale_audit_only'|'quarantine';
export type BillingAuditPlan=Readonly<{ disposition:BillingAuditDisposition; event_id?:string; dedupe_key?:string }>;
/** AI-2 is the only writer of billing transactions/entitlements and its verified provider outbox. AI-3 owns only redacted audit append/receipt. No client paid/verified/refund booleans allowed. */
export type Ai2VerifiedBillingOutboxEntry=Readonly<{
  envelope:EventEnvelope; store:'apple'|'google'; store_environment:'sandbox';
  provider_event_id:string; transaction_ref:string;
}>;
export type Ai2ServerBillingGateway=Readonly<{
  readVerifiedOutbox:(outboxRef:string)=>Promise<unknown>;
  alreadyAudited:(scope:Scope,providerEventId:string)=>Promise<boolean>;
  latestAuditedAt:(scope:Scope,transactionRef:string)=>Promise<string|null>;
  refundIsProviderVerified:(outboxRef:string)=>Promise<boolean>;
}>;
const BILLING_EVENTS=new Set([
  'billing.purchase_verified','billing.renewed','billing.refund_recorded','billing.entitlement_changed',
]);
/** No D1 or Billing writes. The final caller must atomic-insert both provider event ID and event ID in AI-3's own redacted inbox before append/side effects. */
export function bindAi3BillingAudit(trusted:Scope,ai2:Ai2ServerBillingGateway) {
  assertScope(trusted,trusted);
  return Object.freeze({
    async plan(outboxRef:string):Promise<BillingAuditPlan> {
      if(!opaqueId(outboxRef))return {disposition:'quarantine'};
      const entry=await ai2.readVerifiedOutbox(outboxRef);
      if(!record(entry)||!record(entry.envelope)||!isEventEnvelope(entry.envelope)
        ||!['apple','google'].includes(String(entry.store))||entry.store_environment!=='sandbox'
        ||!opaqueId(entry.provider_event_id)||!opaqueId(entry.transaction_ref)
        ||!BILLING_EVENTS.has(entry.envelope.event_type))return {disposition:'quarantine'};
      const event=entry.envelope;
      try{assertScope(trusted,event)}catch{return {disposition:'quarantine'}}
      if(!opaqueId(event.idempotency_key))return {disposition:'quarantine'};
      if(event.event_type==='billing.refund_recorded'
        &&await ai2.refundIsProviderVerified(outboxRef)!==true)return {disposition:'quarantine'};
      const key=idempotencyNamespace(event);
      if(await ai2.alreadyAudited(trusted,entry.provider_event_id))
        return {disposition:'duplicate',event_id:event.event_id,dedupe_key:key};
      const last=await ai2.latestAuditedAt(trusted,entry.transaction_ref);
      if(last!==null&&(!rfc3339Timestamp(last)||Date.parse(event.occurred_at)<=Date.parse(last)))
        return {disposition:'stale_audit_only',event_id:event.event_id,dedupe_key:key};
      return {disposition:'ready',event_id:event.event_id,dedupe_key:key};
    }
  });
}

export type RetryDecision = Readonly<{
  disposition: 'retry' | 'dead_letter' | 'reject'; delay_ms: number;
}>;
/** Queue delivery retry plan only; no queue, network, or D1 side effect here. */
export function planRetry(input: Readonly<{
  attempt: number; status?: number; failure?: 'timeout' | 'network' | 'invalid_payload' | 'scope_denied';
  idempotency_key?: string;
}>): RetryDecision {
  if (!Number.isInteger(input.attempt) || input.attempt < 1) return { disposition: 'reject', delay_ms: 0 };
  if (input.failure === 'invalid_payload' || input.failure === 'scope_denied'
    || !opaqueId(input.idempotency_key)) return { disposition: 'reject', delay_ms: 0 };
  const transient = input.failure === 'timeout' || input.failure === 'network'
    || [408, 425, 429, 500, 502, 503, 504].includes(input.status ?? -1);
  if (!transient) return { disposition: 'reject', delay_ms: 0 };
  if (input.attempt >= 5) return { disposition: 'dead_letter', delay_ms: 0 };
  return { disposition: 'retry', delay_ms: Math.min(60_000, 1000 * 2 ** (input.attempt - 1)) };
}
/** Must be atomically unique with domain owner in D1 before any side effect. */
export function idempotencyNamespace(event: EventEnvelope): string {
  if (!isEventEnvelope(event) || !opaqueId(event.idempotency_key))
    throw new Error('IDEMPOTENCY_REQUIRED');
  return [event.brand_id, event.app_id, event.environment, event.event_type, event.idempotency_key].join('|');
}
