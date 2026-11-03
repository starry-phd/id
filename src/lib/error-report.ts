/**
 * Error monitoring for the Worker (spec tech stack: Sentry, free plan). Off until a DSN is set
 * as the SENTRY_DSN variable (a DSN is a public key, not a secret). No SDK: unexpected errors are
 * sent as a minimal Sentry event over HTTP. Events carry the error type, message and stack, the
 * environment and the request ID only: no URLs with query strings, headers, tokens, member IDs
 * or other personal data.
 */

export interface SentryTarget {
  endpoint: string;
  publicKey: string;
}

/** https://<public key>@<host>/<project id> → the project's store endpoint; null when malformed. */
export function parseDsn(dsn: string | undefined): SentryTarget | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const projectId = url.pathname.replace(/^\/+|\/+$/g, '');
  if (url.protocol !== 'https:' || !url.username || !/^\d+$/.test(projectId)) return null;
  return { endpoint: `https://${url.host}/api/${projectId}/store/`, publicKey: url.username };
}

export interface ErrorContext {
  kind: 'request' | 'scheduled';
  environment: string;
  requestId?: string | null;
  /** Route pattern or cron name, never a URL with query string. */
  where?: string | null;
}

const MAX_MESSAGE = 500;

function randomEventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function sentryEvent(error: unknown, context: ErrorContext, now: number): Record<string, unknown> {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error thrown');
  return {
    event_id: randomEventId(),
    timestamp: now / 1000,
    platform: 'javascript',
    level: 'error',
    logger: 'starry-id',
    server_name: 'starry-id',
    environment: context.environment,
    exception: {
      values: [{ type: err.name || 'Error', value: err.message.slice(0, MAX_MESSAGE), ...(err.stack ? { stacktrace: { frames: stackFrames(err.stack) } } : {}) }],
    },
    tags: { kind: context.kind, ...(context.where ? { where: context.where.slice(0, 200) } : {}), ...(context.requestId ? { request_id: context.requestId } : {}) },
  };
}

/** Sentry wants frames oldest first; keeps function and file names only. */
function stackFrames(stack: string): { function: string; filename: string; lineno?: number; colno?: number }[] {
  return stack
    .split('\n')
    .slice(1, 30)
    .map((line) => /at (?:(.+?) )?\(?([^()\s]+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ function: m[1] ?? '?', filename: m[2] ?? '?', lineno: Number(m[3]), colno: Number(m[4]) }))
    .reverse();
}

/** Sends one error to Sentry; never throws. Returns whether Sentry accepted it. */
export async function reportError(
  dsn: string | undefined,
  error: unknown,
  context: ErrorContext,
  fetchFn: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
  now = Date.now(),
): Promise<boolean> {
  const target = parseDsn(dsn);
  if (!target) return false;
  try {
    const res = await fetchFn(target.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_client=starry-id/1.0, sentry_key=${target.publicKey}`,
      },
      body: JSON.stringify(sentryEvent(error, context, now)),
    });
    return res.ok;
  } catch {
    return false;
  }
}
