import type { Context, MiddlewareHandler } from 'hono';
import type { AppBindings } from '../env';
import { sha256Hex } from './crypto';
import { errorBody } from './errors';

/** Minimal shape of the Workers Rate Limiting binding (wrangler.jsonc "ratelimits"). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type LimiterName = 'RL_AUTH' | 'RL_API' | 'RL_WEB' | 'RL_APP';

export function clientIp(c: Context<AppBindings>): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

/**
 * Spec S-PLT-05: Cloudflare Rate Limiting per IP and per member. Limits are approximate and
 * per location. Without the binding (local tests) requests pass; errors in the limiter
 * never block traffic.
 */
export async function withinLimit(c: Context<AppBindings>, name: LimiterName, key: string): Promise<boolean> {
  const limiter = c.env[name];
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}

export function tooManyRequests(c: Context<AppBindings>): Response {
  c.header('retry-after', '60');
  return c.json(errorBody('RATE_LIMITED', 'Too many requests, please try again later', c.get('requestId')), 429);
}

/** Middleware keyed by client IP. */
export function limitByIp(name: LimiterName): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (!(await withinLimit(c, name, `ip:${clientIp(c)}`))) return tooManyRequests(c);
    await next();
  };
}

/**
 * /v1 limit. App backends share the IP addresses of Cloudflare's network, so a request that carries a service key
 * (x-starry-app-key) is counted per key in its own, larger bucket (RL_APP); every other request is counted per IP (RL_API).
 * Service keys are long random values, so guessing one by trying many is not possible.
 */
export const limitApi: MiddlewareHandler<AppBindings> = async (c, next) => {
  const key = c.req.header('x-starry-app-key');
  if (key && key.length >= 16 && key.length <= 256) {
    if (!(await withinLimit(c, 'RL_APP', `key:${(await sha256Hex(key)).slice(0, 24)}`))) return tooManyRequests(c);
  } else if (!(await withinLimit(c, 'RL_API', `ip:${clientIp(c)}`))) {
    return tooManyRequests(c);
  }
  await next();
};
