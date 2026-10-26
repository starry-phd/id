/**
 * Starry first-wave minimal shared contract, version 0.1.
 * Approved ADMIN-PREP P01/P05; NOT a user authentication or admin permission service.
 */
export const STARRY_BRAND_ID = 'starry' as const;
export type StarryEnvironment = 'development' | 'staging' | 'production';

export interface StarryResourceScope {
  readonly brand_id: typeof STARRY_BRAND_ID;
  readonly app_id: string;
  readonly environment: StarryEnvironment;
}

export interface StarryEventEnvelope extends StarryResourceScope {
  readonly event_id: string;
  readonly event_type: string;
  readonly schema_version: string;
  readonly occurred_at: string;
  readonly correlation_id: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly result: string;
  readonly idempotency_key?: string;
}

/** Disabled placeholder ONLY. No actual cross-brand API is wired. */
export const CROSS_BRAND_MEMBER_SYNC_ENABLED = false as const;

const EVENT_FIELDS = new Set([
  'event_id', 'event_type', 'schema_version', 'brand_id', 'app_id',
  'environment', 'occurred_at', 'correlation_id', 'resource_type',
  'resource_id', 'result', 'idempotency_key',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export function isStarryEnvironment(value: unknown): value is StarryEnvironment {
  return value === 'development' || value === 'staging' || value === 'production';
}

/**
 * Reject unknown fields so tokens, secrets and personal data cannot be appended
 * accidentally to the shared envelope; domain payloads need separate schemas.
 */
export function isStarryEventEnvelope(value: unknown): value is StarryEventEnvelope {
  if (!isRecord(value) || Object.keys(value).some(key => !EVENT_FIELDS.has(key))) return false;
  const required = [
    'event_id', 'event_type', 'schema_version', 'app_id', 'occurred_at',
    'correlation_id', 'resource_type', 'resource_id', 'result',
  ] as const;
  if (!required.every(key => Object.hasOwn(value, key) && nonEmpty(value[key]))) return false;
  return Object.hasOwn(value, 'brand_id')
    && Object.hasOwn(value, 'environment')
    && value.brand_id === STARRY_BRAND_ID
    && isStarryEnvironment(value.environment)
    && (value.idempotency_key === undefined || nonEmpty(value.idempotency_key));
}

/**
 * `trusted` MUST come from trusted server configuration, not an HTTP request.
 * Auth, RBAC, MFA and actual permission enforcement are AI-1 responsibilities.
 */
export function assertStarryResourceScope(
  trusted: StarryResourceScope,
  actual: unknown,
): asserts actual is StarryResourceScope {
  if (!isRecord(actual)
    || actual.brand_id !== STARRY_BRAND_ID
    || trusted.brand_id !== STARRY_BRAND_ID
    || !nonEmpty(trusted.app_id)
    || !isStarryEnvironment(trusted.environment)
    || actual.app_id !== trusted.app_id
    || actual.environment !== trusted.environment) {
    throw new Error('STARRY_RESOURCE_SCOPE_DENIED');
  }
}
