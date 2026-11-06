/** Stable machine-readable error codes returned by the API. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'APP_NOT_FOUND'
  | 'APP_UNAVAILABLE'
  | 'AUTH_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'INVALID_TOKEN'
  | 'INVALID_NONCE'
  | 'UNAUTHORIZED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_PENDING_DELETION'
  | 'FORBIDDEN'
  | 'REAUTH_REQUIRED'
  | 'CONFLICT'
  | 'IDENTITY_IN_USE'
  | 'PROVIDER_ALREADY_LINKED'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INVALID_REFRESH'
  | 'REFRESH_REUSED'
  | 'PRECONDITION_REQUIRED'
  | 'VERSION_CONFLICT'
  | 'CONSENT_VERSION_MISMATCH'
  | 'TASK_TYPE_NOT_FOUND'
  | 'BATTERY_INSUFFICIENT'
  | 'BATTERY_APP_CAP'
  | 'RESERVATION_EXPIRED'
  | 'RESERVATION_CLOSED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE';

export interface ErrorBody {
  error: { code: ErrorCode; message: string; request_id?: string };
}

export function errorBody(code: ErrorCode, message: string, requestId?: string): ErrorBody {
  return { error: requestId ? { code, message, request_id: requestId } : { code, message } };
}
