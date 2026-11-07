import { periodOf } from '../battery/battery';

/** Per-App figures for the Admin Lite App cards, gathered with one query per database (not one per App). */
export interface AppOverview {
  members: number;
  /** Members who used the App in the last 24 hours. */
  day: number;
  week: number;
  month: number;
  /** Active entitlements, sandbox excluded. */
  entitlements: number;
  /** Battery held or spent this month by the whole App. */
  batteryUsed: number;
  batteryCap: number | null;
  /** Battery held or spent in the last 24 hours. */
  batteryUsed24h: number;
  /** Open support tickets that name this App. */
  openTickets: number;
  /** Hourly surge limit (auto-pause above it); null when the guard is off. */
  hourlyLimit: number | null;
  /** Minimum version set through remote config; null when the App uses its default. */
  minVersionOverride: string | null;
}

const empty = (): AppOverview => ({ members: 0, day: 0, week: 0, month: 0, entitlements: 0, batteryUsed: 0, batteryCap: null, batteryUsed24h: 0, openTickets: 0, hourlyLimit: null, minVersionOverride: null });

export async function appOverview(dbs: { identity: D1Database; billing: D1Database; battery: D1Database }, now: number): Promise<Map<string, AppOverview>> {
  const day = 24 * 60 * 60 * 1000;
  const [seen, subs, used, caps, used24h, tickets, surge, minVersions] = await Promise.all([
    dbs.identity
      .prepare('SELECT app_id, COUNT(*) AS total, SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS day, SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS week, SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS month FROM member_apps GROUP BY app_id')
      .bind(now - day, now - 7 * day, now - 30 * day)
      .all<{ app_id: string; total: number; day: number; week: number; month: number }>(),
    dbs.billing
      .prepare("SELECT app_id, COUNT(*) AS n FROM entitlements WHERE active = 1 AND (environment IS NULL OR environment != 'SANDBOX') AND (expires_at IS NULL OR expires_at > ?) GROUP BY app_id")
      .bind(now)
      .all<{ app_id: string; n: number }>(),
    dbs.battery
      .prepare("SELECT app_id, COALESCE(SUM(COALESCE(charged, amount)), 0) AS n FROM battery_reservations WHERE period = ? AND status IN ('reserved', 'committed') GROUP BY app_id")
      .bind(periodOf(now))
      .all<{ app_id: string; n: number }>(),
    dbs.battery.prepare('SELECT app_id, monthly_cap FROM battery_app_limits').all<{ app_id: string; monthly_cap: number }>(),
    dbs.battery
      .prepare("SELECT app_id, COALESCE(SUM(COALESCE(charged, amount)), 0) AS n FROM battery_reservations WHERE created_at >= ? AND status IN ('reserved', 'committed') GROUP BY app_id")
      .bind(now - day)
      .all<{ app_id: string; n: number }>(),
    dbs.identity.prepare("SELECT app_id, COUNT(*) AS n FROM support_tickets WHERE status = 'open' AND app_id IS NOT NULL GROUP BY app_id").all<{ app_id: string; n: number }>(),
    dbs.identity.prepare('SELECT app_id, hourly_limit FROM app_surge_limits').all<{ app_id: string; hourly_limit: number }>(),
    dbs.identity.prepare("SELECT app_id, value FROM app_config_overrides WHERE key = 'min_version'").all<{ app_id: string; value: string }>(),
  ]);
  const map = new Map<string, AppOverview>();
  const get = (id: string) => {
    let o = map.get(id);
    if (!o) map.set(id, (o = empty()));
    return o;
  };
  for (const r of seen.results) Object.assign(get(r.app_id), { members: r.total, day: r.day ?? 0, week: r.week ?? 0, month: r.month ?? 0 });
  for (const r of subs.results) get(r.app_id).entitlements = r.n;
  for (const r of used.results) get(r.app_id).batteryUsed = r.n;
  for (const r of caps.results) get(r.app_id).batteryCap = r.monthly_cap;
  for (const r of used24h.results) get(r.app_id).batteryUsed24h = r.n;
  for (const r of tickets.results) get(r.app_id).openTickets = r.n;
  for (const r of surge.results) get(r.app_id).hourlyLimit = r.hourly_limit;
  for (const r of minVersions.results) {
    try {
      const v: unknown = JSON.parse(r.value);
      if (typeof v === 'string') get(r.app_id).minVersionOverride = v;
    } catch {
      // A damaged value is ignored, like in the sign-in path.
    }
  }
  return map;
}
