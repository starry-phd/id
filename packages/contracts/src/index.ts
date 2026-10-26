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
const SCOPE_FIELDS = new Set(['brand_id', 'app_id', 'environment']);
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Short machine labels only; forbid control characters and free-form data. */
function safeLabel(value: unknown): value is string {
  return typeof value === 'string' && SAFE_LABEL.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false; // e.g. revoked proxy: malformed input must fail closed.
  }
}
/**
 * Check ALL own keys, including symbols and non-enumerable properties.
 * Accessor properties are never trusted because evaluating them can produce
 * side effects or inconsistent validation. No object field is read until
 * descriptors have been confirmed to be plain data properties.
 */
function allowedOwnKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  try {
    return Reflect.ownKeys(value).every(key => {
      if (typeof key !== 'string' || !keys.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
}

export function isStarryEnvironment(value: unknown): value is StarryEnvironment {
  return value === 'development' || value === 'staging' || value === 'production';
}

/**
 * Require RFC3339 timezone and real calendar values. Offset-less times,
 * invalid dates, leap seconds, and 24:00 rollover are intentionally rejected.
 * Fractional seconds may use 1–9 digits.
 */
export function isRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1] && Number.isFinite(Date.parse(value));
}

/**
 * Reject unknown metadata fields and labels containing free-form content.
 * This prevents accidental extras, but is NOT a universal PII/secret scanner.
 */
export function isStarryEventEnvelope(value: unknown): value is StarryEventEnvelope {
  if (!isRecord(value) || !allowedOwnKeys(value, EVENT_FIELDS)) return false;
  const required = [
    'event_id', 'event_type', 'schema_version', 'app_id', 'occurred_at',
    'correlation_id', 'resource_type', 'resource_id', 'result',
  ] as const;
  return required.every(field => Object.hasOwn(value, field)
    && (field === 'occurred_at' ? isRfc3339Timestamp(value[field]) : safeLabel(value[field])))
    && Object.hasOwn(value, 'brand_id')
    && Object.hasOwn(value, 'environment')
    && value.brand_id === STARRY_BRAND_ID
    && isStarryEnvironment(value.environment)
    && (!Object.hasOwn(value, 'idempotency_key') || safeLabel(value.idempotency_key));
}

/**
 * `trusted` MUST come from trusted server configuration, not an HTTP request.
 * Auth, RBAC, MFA and actual permission enforcement are AI-1 responsibilities.
 */
export function assertStarryResourceScope(
  trusted: StarryResourceScope,
  actual: unknown,
): asserts actual is StarryResourceScope {
  if (!isRecord(trusted) || !isRecord(actual)
    || !allowedOwnKeys(actual, SCOPE_FIELDS)
    || !safeLabel(trusted.app_id)
    || !safeLabel(actual.app_id)
    || trusted.brand_id !== STARRY_BRAND_ID
    || actual.brand_id !== STARRY_BRAND_ID
    || !isStarryEnvironment(trusted.environment)
    || !isStarryEnvironment(actual.environment)
    || actual.app_id !== trusted.app_id
    || actual.environment !== trusted.environment) {
    throw new Error('STARRY_RESOURCE_SCOPE_DENIED');
  }
}

/** Bind a valid event to the server-derived Starry app/environment. */
export function assertStarryEventForScope(
  trusted: StarryResourceScope,
  actual: unknown,
): asserts actual is StarryEventEnvelope {
  if (!isStarryEventEnvelope(actual)) throw new Error('STARRY_EVENT_ENVELOPE_DENIED');
  assertStarryResourceScope(trusted, {
    brand_id: actual.brand_id,
    app_id: actual.app_id,
    environment: actual.environment,
  });
}
