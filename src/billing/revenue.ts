/**
 * Revenue summary for Admin Lite, read from the stored RevenueCat events. Amounts are RevenueCat's USD `price`
 * field summed per event, so they are an estimate for orientation, not accounting. Sandbox (test) purchases are
 * always reported apart from real ones.
 */
export interface RevenueRow {
  appId: string;
  sandbox: boolean;
  newPurchases: number;
  renewals: number;
  oneTime: number;
  cancellations: number;
  expirations: number;
  billingIssues: number;
  /** USD gross of purchases, renewals and one-time purchases. */
  revenueUsd: number;
  /** USD of refunds (CANCELLATION events that carry a negative price). */
  refundedUsd: number;
  /** Members with an active entitlement right now (same environment as the row). */
  activeNow: number;
}

interface EventAgg {
  app_id: string;
  env: string;
  type: string;
  n: number;
  amount: number;
}

export async function revenueSummary(db: D1Database, sinceMs: number): Promise<RevenueRow[]> {
  const [events, active] = await db.batch([
    db
      .prepare(
        `SELECT app_id, CASE WHEN environment = 'SANDBOX' THEN 'SANDBOX' ELSE 'PRODUCTION' END AS env, type, COUNT(*) AS n,
                COALESCE(SUM(CAST(json_extract(payload, '$.price') AS REAL)), 0) AS amount
         FROM rc_events
         WHERE event_timestamp_ms >= ?
           AND type IN ('INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE')
         GROUP BY app_id, env, type`,
      )
      .bind(sinceMs),
    db.prepare(
      `SELECT app_id, CASE WHEN environment = 'SANDBOX' THEN 'SANDBOX' ELSE 'PRODUCTION' END AS env, COUNT(DISTINCT user_id) AS n
       FROM entitlements WHERE active = 1 GROUP BY app_id, env`,
    ),
  ]);
  const rows = new Map<string, RevenueRow>();
  const row = (appId: string, env: string): RevenueRow => {
    const key = `${appId}|${env}`;
    let r = rows.get(key);
    if (!r) {
      r = { appId, sandbox: env === 'SANDBOX', newPurchases: 0, renewals: 0, oneTime: 0, cancellations: 0, expirations: 0, billingIssues: 0, revenueUsd: 0, refundedUsd: 0, activeNow: 0 };
      rows.set(key, r);
    }
    return r;
  };
  for (const e of (events?.results ?? []) as unknown as EventAgg[]) {
    const r = row(e.app_id, e.env);
    if (e.type === 'INITIAL_PURCHASE') {
      r.newPurchases += e.n;
      r.revenueUsd += e.amount;
    } else if (e.type === 'RENEWAL') {
      r.renewals += e.n;
      r.revenueUsd += e.amount;
    } else if (e.type === 'NON_RENEWING_PURCHASE') {
      r.oneTime += e.n;
      r.revenueUsd += e.amount;
    } else if (e.type === 'CANCELLATION') {
      r.cancellations += e.n;
      if (e.amount < 0) r.refundedUsd += -e.amount;
    } else if (e.type === 'EXPIRATION') r.expirations += e.n;
    else r.billingIssues += e.n;
  }
  for (const a of (active?.results ?? []) as unknown as { app_id: string; env: string; n: number }[]) row(a.app_id, a.env).activeNow = a.n;
  return [...rows.values()].sort((x, y) => Number(x.sandbox) - Number(y.sandbox) || x.appId.localeCompare(y.appId));
}
