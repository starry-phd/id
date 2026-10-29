/**
 * W2 / AI-1: per-request typed outcome around the ORIGINAL R23 signed/current
 * Auth boundary. Isolated/offline only. No HTTP route, shared stateful failure
 * flag, global retry, bearer reflection, identity JSON or live capability.
 *
 * The dependency contract is deliberate:
 *   getVerificationKey(kid) => null means unknown kid (denied);
 *   thrown/rejected key or DB operation means dependency_unavailable.
 * Adapters MUST throw on provider outages; silent null cannot attest outage.
 */
import {
  createOfflineStarryRequestAuthBoundary,
} from './r23-signed-session-d1-request-boundary.ts';
import {isTrustedPrincipal} from './index.ts';
import type {TrustedPrincipal, TrustedScope} from './index.ts';
import type {D1Database, D1Prepared} from './d1-ports.ts';

export const W2_AUTH_OUTCOME_CONTRACT = 'starry.ai1.w2.auth-outcome.local-v1' as const;
export const W2_AUTH_OUTCOME_LIVE_ENABLED = false as const;
export type W2AuthStatus = 'verified' | 'denied' | 'dependency_unavailable';
export type W2AuthOutcome = Readonly<{
  status: W2AuthStatus;
  verified_live: false;
  may_publish: false;
  may_write_live_d1: false;
  may_grant: false;
  may_ack: false;
}>;

/**
 * Only actual server-sealed R23 principals are retained, keyed by the returned
 * frozen outcome's *object identity*. Failure state is NOT module-global.
 * A JSON copy, client {status:'verified'} or object-spread cannot recover one.
 */
const sealedSuccess = new WeakMap<object, TrustedPrincipal>();
function outcome(status: W2AuthStatus): W2AuthOutcome {
  return Object.freeze({
    status, verified_live: false as const, may_publish: false as const,
    may_write_live_d1: false as const, may_grant: false as const,
    may_ack: false as const,
  });
}
export function takeW2VerifiedPrincipal(value: unknown): TrustedPrincipal | null {
  if (!value || typeof value !== 'object') return null;
  const principal = sealedSuccess.get(value);
  return principal && isTrustedPrincipal(principal) ? principal : null;
}

/**
 * Observe synchronous and asynchronous failures in only this authenticate call.
 * The underlying R23 resolver owns all signature, session, member and provider
 * checks; never interpret untrusted claims or replace those checks here.
 */
function trackAuthDb(db: D1Database, unavailable: () => void): D1Database {
  function wrap(p: D1Prepared): D1Prepared {
    return {
      bind(...params: (string | number | null)[]): D1Prepared {
        try { return wrap(p.bind(...params)); }
        catch { unavailable(); throw new Error('W2_AUTH_PORT_FAILURE'); }
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        try { return await p.first<T>(); }
        catch { unavailable(); throw new Error('W2_AUTH_PORT_FAILURE'); }
      },
      async run(): Promise<never> {
        // The W2 adapter is strictly read-only, even if a caller later adds a
        // write to the underlying R23 adapter. No real or local mutation here.
        throw new Error('W2_AUTH_READ_ONLY');
      },
    };
  }
  return {
    prepare(sql: string): D1Prepared {
      if (typeof sql !== 'string' || !/^SELECT\s/i.test(sql)) {
        throw new Error('W2_AUTH_READ_ONLY');
      }
      try { return wrap(db.prepare(sql)); }
      catch { unavailable(); throw new Error('W2_AUTH_PORT_FAILURE'); }
    },
  };
}

export function createOfflineW2CurrentAuthOutcomeAdapter(deps: Readonly<{
  enabled?: boolean;
  serverScope: TrustedScope;
  expectedOrigin: string;
  authDb: D1Database;
  getVerificationKey: (kid: string) => Promise<CryptoKey | null>;
  /** Injected trusted server clock; called only once per request. */
  now: () => number;
}>) {
  if (deps.serverScope?.app_id !== 'starry-id' || typeof deps.now !== 'function') {
    throw new Error('W2_AUTH_CONFIG_DENIED');
  }
  const scope = Object.freeze({...deps.serverScope});
  const originalDb = deps.authDb;
  const originalKeyPort = deps.getVerificationKey;
  // Reuse R23's strict Starry/dev-or-staging/HTTPS/DB/key configuration guard;
  // construct disabled so startup alone performs zero authentication I/O.
  createOfflineStarryRequestAuthBoundary({
    serverScope: scope, expectedOrigin: deps.expectedOrigin, authDb: originalDb,
    getVerificationKey: originalKeyPort, enabled: false,
  });
  const enabled = deps.enabled === true;
  return Object.freeze({
    contract: W2_AUTH_OUTCOME_CONTRACT,
    live_enabled: W2_AUTH_OUTCOME_LIVE_ENABLED,
    async authenticate(request: unknown): Promise<W2AuthOutcome> {
      if (!enabled || !(request instanceof Request)) return outcome('denied');
      let currentTime: number;
      try {
        currentTime = deps.now();
        if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
          return outcome('dependency_unavailable');
        }
      } catch { return outcome('dependency_unavailable'); }
      // This is deliberately allocated inside the call, never on the factory.
      let failedDependency = false;
      const markFailed = () => { failedDependency = true; };
      const db = trackAuthDb(originalDb, markFailed);
      const keyPort = async (kid: string): Promise<CryptoKey | null> => {
        try { return await originalKeyPort(kid); }
        catch { markFailed(); throw new Error('W2_AUTH_PORT_FAILURE'); }
      };
      try {
        // R23 internally catches port errors and returns null; this adapter
        // observes them request-locally, without monkeypatching shared ports.
        const guard = createOfflineStarryRequestAuthBoundary({
          serverScope: scope, expectedOrigin: deps.expectedOrigin,
          authDb: db, getVerificationKey: keyPort, enabled: true,
        });
        const principal = await guard.authenticate(request, currentTime);
        if (failedDependency) return outcome('dependency_unavailable');
        if (!principal || !isTrustedPrincipal(principal)) return outcome('denied');
        const verified = outcome('verified');
        sealedSuccess.set(verified, principal);
        return verified;
      } catch {
        // Never return internal cause, SQL, KID, token, subject or stack.
        return outcome(failedDependency ? 'dependency_unavailable' : 'denied');
      }
    },
  });
}
