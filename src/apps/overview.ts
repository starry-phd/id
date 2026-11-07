import { periodOf } from '../battery/battery';

/** Per-App figures for the Admin Lite App cards, gathered with one query per database (not one per App). */
export interface AppOverview {
  members: number;
  week: number;
  month: number;
  /** Active entitlements, sandbox excluded. */
  entitlements: number;
  /** Battery held or spent this month by the whole App. */
  batteryUsed: number;
  batteryCap: number | null;
}

const empty = (): AppOverview => ({ members: 0, week: 0, month: 0, entitlements: 0, batteryUsed: 0, batteryCap: null });

export async function appOverview(dbs: { identity: D1Database; billing: D1Database; battery: D1Database }, now: number): Promise<Map<string, AppOverview>> {
  const day = 24 * 60 * 60 * 1000;
  const [seen, subs, used, caps] = await Promise.all([
    dbs.identity
      .prepare('SELECT app_id, COUNT(*) AS total, SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS week, SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS month FROM member_apps GROUP BY app_id')
      .bind(now - 7 * day, now - 30 * day)
      .all<{ app_id: string; total: number; week: number; month: number }>(),
    dbs.billing
      .prepare("SELECT app_id, COUNT(*) AS n FROM entitlements WHERE active = 1 AND (environment IS NULL OR environment != 'SANDBOX') AND (expires_at IS NULL OR expires_at > ?) GROUP BY app_id")
      .bind(now)
      .all<{ app_id: string; n: number }>(),
    dbs.battery
      .prepare("SELECT app_id, COALESCE(SUM(COALESCE(charged, amount)), 0) AS n FROM battery_reservations WHERE period = ? AND status IN ('reserved', 'committed') GROUP BY app_id")
      .bind(periodOf(now))
      .all<{ app_id: string; n: number }>(),
    dbs.battery.prepare('SELECT app_id, monthly_cap FROM battery_app_limits').all<{ app_id: string; monthly_cap: number }>(),
  ]);
  const map = new Map<string, AppOverview>();
  const get = (id: string) => {
    let o = map.get(id);
    if (!o) map.set(id, (o = empty()));
    return o;
  };
  for (const r of seen.results) Object.assign(get(r.app_id), { members: r.total, week: r.week ?? 0, month: r.month ?? 0 });
  for (const r of subs.results) get(r.app_id).entitlements = r.n;
  for (const r of used.results) get(r.app_id).batteryUsed = r.n;
  for (const r of caps.results) get(r.app_id).batteryCap = r.monthly_cap;
  return map;
}
