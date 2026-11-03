import type { FetchLike } from './revenuecat';

/**
 * Spec S-BIL-04: once a day the projection is compared with RevenueCat, the purchase authority.
 * Webhooks keep it current; this repairs anything a lost or failed webhook left behind.
 * Each run checks the member/App pairs compared longest ago (members who ever had an
 * entitlement or a purchase event), using that App's RevenueCat secret API key.
 */

interface RcEntitlement {
  expires_date?: string | null;
  grace_period_expires_date?: string | null;
  product_identifier?: string;
}

interface RcPurchase {
  store?: string;
  is_sandbox?: boolean;
}

export interface RcSubscriber {
  entitlements?: Record<string, RcEntitlement>;
  subscriptions?: Record<string, RcPurchase>;
  non_subscriptions?: Record<string, RcPurchase[]>;
}

export interface TrueEntitlement {
  entitlement: string;
  active: boolean;
  expiresAt: number | null;
  productId: string | null;
  lifetimeProductId: string | null;
  store: string | null;
  environment: string | null;
}

const time = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** RevenueCat's view of one customer, in projection terms. Expired entitlements are listed as inactive. */
export function entitlementsFromSubscriber(subscriber: RcSubscriber, now: number): TrueEntitlement[] {
  const out: TrueEntitlement[] = [];
  for (const [entitlement, e] of Object.entries(subscriber.entitlements ?? {})) {
    if (!entitlement || entitlement.length > 200) continue;
    const productId = typeof e.product_identifier === 'string' && e.product_identifier.length <= 200 ? e.product_identifier : null;
    const lifetime = e.expires_date === null || e.expires_date === undefined;
    const expires = time(e.expires_date);
    const grace = time(e.grace_period_expires_date);
    if (!lifetime && expires === null) continue;
    const until = grace !== null && expires !== null && grace > expires ? grace : expires;
    const purchase = (productId && (subscriber.subscriptions?.[productId] ?? subscriber.non_subscriptions?.[productId]?.at(-1))) || undefined;
    out.push({
      entitlement,
      active: lifetime || (until !== null && until > now),
      expiresAt: lifetime ? null : until,
      productId,
      lifetimeProductId: lifetime ? productId : null,
      store: typeof purchase?.store === 'string' ? purchase.store.toUpperCase().slice(0, 32) : null,
      environment: purchase?.is_sandbox === undefined ? null : purchase.is_sandbox ? 'SANDBOX' : 'PRODUCTION',
    });
  }
  return out;
}

interface ProjectionRow {
  entitlement: string;
  active: number;
  expires_at: number | null;
  lifetime_product_id: string | null;
}

/** Makes one member's projection in one App equal RevenueCat's; returns how many rows changed. */
export async function applyTruth(db: D1Database, userId: string, appId: string, truth: TrueEntitlement[], now: number): Promise<number> {
  const current = await db
    .prepare('SELECT entitlement, active, expires_at, lifetime_product_id FROM entitlements WHERE user_id = ? AND app_id = ?')
    .bind(userId, appId)
    .all<ProjectionRow>();
  const byName = new Map(current.results.map((r) => [r.entitlement, r]));
  const statements: D1PreparedStatement[] = [];
  for (const t of truth) {
    const row = byName.get(t.entitlement);
    byName.delete(t.entitlement);
    if (row && (row.active === 1) === t.active && row.expires_at === t.expiresAt && row.lifetime_product_id === t.lifetimeProductId) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO entitlements (user_id, app_id, entitlement, active, expires_at, product_id, lifetime_product_id, store, environment, last_event_ms, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, app_id, entitlement) DO UPDATE SET active = excluded.active, expires_at = excluded.expires_at,
             product_id = excluded.product_id, lifetime_product_id = excluded.lifetime_product_id, store = excluded.store,
             environment = excluded.environment, last_event_ms = MAX(entitlements.last_event_ms, excluded.last_event_ms), updated_at = excluded.updated_at`,
        )
        .bind(userId, appId, t.entitlement, t.active ? 1 : 0, t.expiresAt, t.productId, t.lifetimeProductId, t.store, t.environment, now, now),
    );
  }
  // Entitlements RevenueCat no longer knows about are switched off, never kept active.
  for (const row of byName.values()) {
    if (row.active === 0) continue;
    statements.push(
      db
        .prepare('UPDATE entitlements SET active = 0, lifetime_product_id = NULL, last_event_ms = MAX(last_event_ms, ?), updated_at = ? WHERE user_id = ? AND app_id = ? AND entitlement = ?')
        .bind(now, now, userId, appId, row.entitlement),
    );
  }
  if (statements.length > 0) await db.batch(statements);
  return statements.length;
}

export interface ReconcileReport {
  checked: number;
  fixed: number;
  errors: number;
  rateLimited: boolean;
}

/** One daily pass over at most `limit` member/App pairs; stops early when RevenueCat rate-limits. */
export async function reconcileWithRevenueCat(
  db: D1Database,
  apiKeys: Record<string, string>,
  fetchFn: FetchLike,
  now: number,
  limit = 200,
): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, fixed: 0, errors: 0, rateLimited: false };
  const appIds = Object.keys(apiKeys);
  if (appIds.length === 0) return report;
  const placeholders = appIds.map(() => '?').join(', ');
  const pairs = await db
    .prepare(
      `SELECT p.user_id, p.app_id FROM (
         SELECT user_id, app_id FROM entitlements
         UNION
         SELECT app_user_id AS user_id, app_id FROM rc_events WHERE app_user_id NOT IN ('anonymous', 'deleted')
       ) p LEFT JOIN reconcile_state s ON s.user_id = p.user_id AND s.app_id = p.app_id
       WHERE p.app_id IN (${placeholders})
       ORDER BY COALESCE(s.checked_at, 0), p.user_id LIMIT ?`,
    )
    .bind(...appIds, limit)
    .all<{ user_id: string; app_id: string }>();
  for (const pair of pairs.results) {
    let result: 'match' | 'fixed' | 'error' = 'error';
    try {
      const res = await fetchFn(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(pair.user_id)}`, {
        headers: { authorization: `Bearer ${apiKeys[pair.app_id] ?? ''}`, accept: 'application/json' },
      });
      if (res.status === 429) {
        report.rateLimited = true;
        break;
      }
      if (res.ok) {
        const body = (await res.json()) as { subscriber?: RcSubscriber };
        const changed = await applyTruth(db, pair.user_id, pair.app_id, entitlementsFromSubscriber(body.subscriber ?? {}, now), now);
        result = changed > 0 ? 'fixed' : 'match';
      }
    } catch {
      result = 'error';
    }
    report.checked++;
    if (result === 'fixed') report.fixed++;
    if (result === 'error') report.errors++;
    await db
      .prepare(
        `INSERT INTO reconcile_state (user_id, app_id, checked_at, result) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, app_id) DO UPDATE SET checked_at = excluded.checked_at, result = excluded.result`,
      )
      .bind(pair.user_id, pair.app_id, now, result)
      .run();
  }
  return report;
}
