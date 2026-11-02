/** Stable machine-readable error codes returned by the API. */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'APP_NOT_FOUND'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE';

export interface ErrorBody {
  error: { code: ErrorCode; message: string; request_id?: string };
}

export function errorBody(code: ErrorCode, message: string, requestId?: string): ErrorBody {
  return { error: requestId ? { code, message, request_id: requestId } : { code, message } };
}
