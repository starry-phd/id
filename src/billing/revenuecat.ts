import { constantTimeEqual, uuidv7 } from '../lib/crypto';
import { GRANT_STORE } from './grants';

/**
 * RevenueCat webhook projection (spec S-BIL-01..06). Each Starry App has its own RevenueCat
 * project, so events arrive per app_id and entitlements never cross Apps. The App User ID is
 * the Starry member ID (s_user_id). Battery is never touched here (S-BIL-06).
 */
export interface RcEvent {
  id: string;
  type: string;
  appUserId: string | null;
  /** The store transaction (one purchase); used to credit a consumable exactly once. */
  transactionId: string | null;
  timestampMs: number;
  entitlementIds: string[];
  productId: string | null;
  expirationMs: number | null;
  periodType: string | null;
  store: string | null;
  environment: string | null;
  cancelReason: string | null;
  transferredFrom: string[];
  transferredTo: string[];
}

const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const GRANT = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
]);

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200) : [];
}

const str = (value: unknown, max = 200): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The Starry member an event belongs to: the first member-ID-shaped id among app_user_id, original id and aliases. */
function memberIdOf(event: Record<string, unknown>): string | null {
  for (const candidate of [event.app_user_id, event.original_app_user_id, ...strings(event.aliases)]) {
    if (typeof candidate === 'string' && MEMBER_ID.test(candidate)) return candidate;
  }
  return null;
}

export function parseWebhook(body: unknown): { event: RcEvent; stored: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as { event?: unknown }).event;
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const id = str(e.id);
  const type = str(e.type, 64);
  const timestampMs = num(e.event_timestamp_ms);
  if (!id || !type || timestampMs === null) return null;
  const event: RcEvent = {
    id,
    type,
    appUserId: memberIdOf(e),
    transactionId: str(e.transaction_id, 200),
    timestampMs,
    entitlementIds: strings(e.entitlement_ids ?? (typeof e.entitlement_id === 'string' ? [e.entitlement_id] : [])),
    productId: str(e.product_id),
    expirationMs: num(e.expiration_at_ms),
    periodType: str(e.period_type, 32),
    store: str(e.store, 32),
    environment: str(e.environment, 16),
    cancelReason: str(e.cancel_reason, 64),
    transferredFrom: strings(e.transferred_from).filter((u) => MEMBER_ID.test(u)),
    transferredTo: strings(e.transferred_to).filter((u) => MEMBER_ID.test(u)),
  };
  // Never keep subscriber attributes (they can contain email, names, phone numbers).
  const rest: Record<string, unknown> = { ...e };
  delete rest.subscriber_attributes;
  return { event, stored: JSON.stringify(rest) };
}

/** RevenueCat sends exactly the Authorization value configured in its dashboard. */
export function webhookAuthorized(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const value = header.startsWith('Bearer ') ? header.slice(7) : header;
  return constantTimeEqual(value, secret);
}

/** Stores the event once; 'duplicate' for a redelivery of the same event id. */
export async function recordEvent(db: D1Database, appId: string, parsed: { event: RcEvent; stored: string }, now: number): Promise<'new' | 'duplicate'> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO rc_events (event_id, app_id, app_user_id, type, environment, event_timestamp_ms, payload, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(parsed.event.id, appId, parsed.event.appUserId ?? 'anonymous', parsed.event.type, parsed.event.environment, parsed.event.timestampMs, parsed.stored, now)
    .run();
  return result.meta.changes === 1 ? 'new' : 'duplicate';
}

interface EntitlementRow {
  active: number;
  lifetime_product_id: string | null;
  last_event_ms: number;
}

async function upsert(
  db: D1Database,
  key: { userId: string; appId: string; entitlement: string },
  event: RcEvent,
  change: (current: EntitlementRow | null) => { active: boolean; expiresAt: number | null; lifetimeProductId: string | null } | null,
  now: number,
): Promise<void> {
  const current = await db
    .prepare('SELECT active, lifetime_product_id, last_event_ms FROM entitlements WHERE user_id = ? AND app_id = ? AND entitlement = ?')
    .bind(key.userId, key.appId, key.entitlement)
    .first<EntitlementRow>();
  if (current && current.last_event_ms > event.timestampMs) return; // an older event arrived late
  const next = change(current);
  if (!next) return;
  await db
    .prepare(
      `INSERT INTO entitlements (user_id, app_id, entitlement, active, expires_at, product_id, lifetime_product_id, store, environment, last_event_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, app_id, entitlement) DO UPDATE SET active = excluded.active, expires_at = excluded.expires_at,
         product_id = excluded.product_id, lifetime_product_id = excluded.lifetime_product_id, store = excluded.store,
         environment = excluded.environment, last_event_ms = excluded.last_event_ms, updated_at = excluded.updated_at`,
    )
    .bind(key.userId, key.appId, key.entitlement, next.active ? 1 : 0, next.expiresAt, event.productId, next.lifetimeProductId, event.store, event.environment, event.timestampMs, now)
    .run();
}

/** Applies one event to the projection (S-BIL-04, S-BIL-05). */
export async function applyEvent(db: D1Database, appId: string, event: RcEvent, now: number): Promise<void> {
  if (event.type === 'TRANSFER') {
    for (const userId of event.transferredFrom) {
      for (const entitlement of event.entitlementIds) {
        await upsert(db, { userId, appId, entitlement }, event, () => ({ active: false, expiresAt: null, lifetimeProductId: null }), now);
      }
    }
    for (const userId of event.transferredTo) {
      for (const entitlement of event.entitlementIds) {
        await upsert(db, { userId, appId, entitlement }, event, (c) => ({ active: true, expiresAt: event.expirationMs, lifetimeProductId: c?.lifetime_product_id ?? null }), now);
      }
    }
    return;
  }
  const userId = event.appUserId;
  if (!userId) return; // anonymous purchases are not projected; purchase requires sign-in (S-BIL-03)
  for (const entitlement of event.entitlementIds) {
    const key = { userId, appId, entitlement };
    const lifetimePurchase = event.type === 'NON_RENEWING_PURCHASE' && event.expirationMs === null;
    if (GRANT.has(event.type)) {
      await upsert(db, key, event, (c) => ({
        active: true,
        expiresAt: lifetimePurchase || c?.lifetime_product_id ? null : event.expirationMs,
        lifetimeProductId: lifetimePurchase ? event.productId : (c?.lifetime_product_id ?? null),
      }), now);
    } else if (event.type === 'CANCELLATION') {
      const refunded = event.cancelReason === 'CUSTOMER_SUPPORT';
      await upsert(db, key, event, (c) => {
        const keepsLifetime = c?.lifetime_product_id && c.lifetime_product_id !== event.productId;
        if (!refunded) return { active: c ? c.active === 1 : true, expiresAt: keepsLifetime ? null : event.expirationMs, lifetimeProductId: c?.lifetime_product_id ?? null };
        if (keepsLifetime) return { active: true, expiresAt: null, lifetimeProductId: c?.lifetime_product_id ?? null };
        return { active: false, expiresAt: event.expirationMs, lifetimeProductId: null };
      }, now);
    } else if (event.type === 'EXPIRATION') {
      await upsert(db, key, event, (c) => (c?.lifetime_product_id ? { active: true, expiresAt: null, lifetimeProductId: c.lifetime_product_id } : { active: false, expiresAt: event.expirationMs, lifetimeProductId: null }), now);
    }
    // BILLING_ISSUE, SUBSCRIPTION_PAUSED, TEST and others: the entitlement keeps its current state.
  }
}

/** Processes stored, unprocessed events oldest first; failures retry on later runs (max 10 attempts). */
export async function processPendingEvents(
  db: D1Database,
  now: number,
  limit = 50,
  onEvent?: (appId: string, event: RcEvent) => Promise<void>,
): Promise<{ processed: number; failed: number }> {
  const pending = await db
    .prepare('SELECT event_id, app_id, payload FROM rc_events WHERE processed_at IS NULL AND attempts < 10 ORDER BY event_timestamp_ms LIMIT ?')
    .bind(limit)
    .all<{ event_id: string; app_id: string; payload: string }>();
  const outcome = { processed: 0, failed: 0 };
  for (const row of pending.results) {
    try {
      const parsed = parseWebhook({ event: JSON.parse(row.payload) as unknown });
      if (parsed) {
        await applyEvent(db, row.app_id, parsed.event, now);
        await onEvent?.(row.app_id, parsed.event); // must be idempotent: a failed event is retried whole
      }
      await db.prepare('UPDATE rc_events SET processed_at = ?, attempts = attempts + 1 WHERE event_id = ?').bind(now, row.event_id).run();
      outcome.processed++;
    } catch {
      await db.prepare('UPDATE rc_events SET attempts = attempts + 1 WHERE event_id = ?').bind(row.event_id).run();
      outcome.failed++;
    }
  }
  return outcome;
}

export interface ActiveEntitlement {
  entitlement: string;
  expires_at: number | null;
  product_id: string | null;
  store: string | null;
  environment: string | null;
}

/** Active entitlements of one member in one App; expired subscriptions are excluded even before EXPIRATION arrives. */
export async function activeEntitlements(db: D1Database, userId: string, appId: string, now: number): Promise<ActiveEntitlement[]> {
  const rows = await db
    .prepare(
      `SELECT entitlement, expires_at, product_id, store, environment FROM entitlements
       WHERE user_id = ? AND app_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY entitlement`,
    )
    .bind(userId, appId, now)
    .all<ActiveEntitlement>();
  const grants = await db
    .prepare(
      `SELECT entitlement, expires_at FROM entitlement_grants
       WHERE user_id = ? AND app_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .bind(userId, appId, now)
    .all<{ entitlement: string; expires_at: number | null }>();
  if (grants.results.length === 0) return rows.results;
  // A staff grant and a purchase for the same entitlement count once: the one that lasts longer (no end date = longest) wins.
  const merged = new Map<string, ActiveEntitlement>(rows.results.map((r) => [r.entitlement, r]));
  for (const g of grants.results) {
    const have = merged.get(g.entitlement);
    const longer = !have || (have.expires_at !== null && (g.expires_at === null || g.expires_at > have.expires_at));
    if (longer) merged.set(g.entitlement, { entitlement: g.entitlement, expires_at: g.expires_at, product_id: null, store: GRANT_STORE, environment: null });
  }
  return [...merged.values()].sort((a, b) => a.entitlement.localeCompare(b.entitlement));
}

/**
 * Account purge (S-ID-06): removes the member's entitlements, de-identifies their events and
 * queues deletion of the RevenueCat customer in every App that has a RevenueCat API key.
 */
export async function forgetMembers(db: D1Database, userIds: string[], appIds: string[], now: number): Promise<void> {
  for (const userId of userIds) {
    await db.batch([
      db.prepare('DELETE FROM entitlements WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM entitlement_grants WHERE user_id = ?').bind(userId),
      db.prepare("UPDATE rc_events SET app_user_id = 'deleted', payload = '{}' WHERE app_user_id = ?").bind(userId),
      db.prepare('DELETE FROM reconcile_state WHERE user_id = ?').bind(userId),
      ...appIds.map((appId) =>
        db
          .prepare('INSERT INTO revenuecat_deletions (job_id, app_id, app_user_id, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(uuidv7(now), appId, userId, now, now),
      ),
    ]);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Deletes queued RevenueCat customers (REST API v1); 404 counts as done. Backs off like Apple revocations. */
export async function processRevenueCatDeletions(
  db: D1Database,
  apiKeys: Record<string, string>,
  fetchFn: FetchLike,
  now: number,
  limit = 20,
): Promise<{ deleted: number; failed: number; abandoned: number }> {
  const outcome = { deleted: 0, failed: 0, abandoned: 0 };
  const due = await db
    .prepare('SELECT job_id, app_id, app_user_id, attempts FROM revenuecat_deletions WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?')
    .bind(now, limit)
    .all<{ job_id: string; app_id: string; app_user_id: string; attempts: number }>();
  for (const job of due.results) {
    const key = apiKeys[job.app_id];
    let ok = false;
    if (key) {
      try {
        const res = await fetchFn(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(job.app_user_id)}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        });
        ok = res.ok || res.status === 404;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      await db.prepare('DELETE FROM revenuecat_deletions WHERE job_id = ?').bind(job.job_id).run();
      outcome.deleted++;
    } else if (job.attempts + 1 >= 10) {
      await db.prepare('DELETE FROM revenuecat_deletions WHERE job_id = ?').bind(job.job_id).run();
      outcome.abandoned++;
    } else {
      const backoff = Math.min(60 * 60 * 1000 * 2 ** job.attempts, 24 * 60 * 60 * 1000);
      await db.prepare('UPDATE revenuecat_deletions SET attempts = attempts + 1, next_attempt_at = ? WHERE job_id = ?').bind(now + backoff, job.job_id).run();
      outcome.failed++;
    }
  }
  return outcome;
}

/** Reads a JSON object of per-App secrets, e.g. {"echo": "..."}; malformed input yields {}. */
export function perAppSecrets(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
  } catch {
    return {};
  }
}
