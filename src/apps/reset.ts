import { auditStatement } from '../lib/audit';
import { APP_STAGES, listAppStages, type AppStage } from './status';

/**
 * One-click removal of a TEST App's member data (item 6). Only for Apps whose stage is dev or test, and never for an
 * App that has ever had a real (non-sandbox) purchase. It removes what the App itself created for its members:
 * sign-ins, usage records, push devices and choices, entitlements and grants, RevenueCat events, and the App's
 * Quantum Battery balances and invite redemptions. It never touches member accounts, the audit trail, the App's
 * registration or settings, support tickets, or the free monthly Battery (which is shared by every App).
 */
export interface Databases {
  identity: D1Database;
  billing: D1Database;
  battery: D1Database;
}

export interface ResetCounts {
  sessions: number;
  memberApps: number;
  pushTokens: number;
  pushPreferences: number;
  entitlements: number;
  grants: number;
  rcEvents: number;
  quantumAccounts: number;
  quantumLedger: number;
  inviteRedemptions: number;
}

export interface ResetPreview {
  stage: AppStage;
  counts: ResetCounts;
  /** Reasons the reset is refused right now; empty when it may run. */
  blockers: ResetBlocker[];
}

export type ResetBlocker = 'live_stage' | 'real_purchases' | 'tasks_in_flight';

export const BLOCKER_TEXT: Record<ResetBlocker, string> = {
  live_stage: '這款 App 的階段是「已上架」，只有「開發中」或「測試中」才能清除。',
  real_purchases: '這款 App 曾經有過真實（非沙盒）購買紀錄，為了保護正式資料，不能一鍵清除。',
  tasks_in_flight: '這款 App 目前有進行中的 Battery 任務，請等任務結束（約幾分鐘）後再試。',
};

const n = async (db: D1Database, sql: string, ...binds: string[]): Promise<number> => (await db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

export async function previewReset(dbs: Databases, appId: string, now: number): Promise<ResetPreview> {
  const stage = (await listAppStages(dbs.identity)).get(appId) ?? 'dev';
  const [sessions, memberApps, pushTokens, pushPreferences, entitlements, grants, rcEvents, quantumAccounts, quantumLedger, inviteRedemptions, real, realEvents, inFlight] = await Promise.all([
    n(dbs.identity, 'SELECT COUNT(*) AS n FROM sessions WHERE app_id = ?', appId),
    n(dbs.identity, 'SELECT COUNT(*) AS n FROM member_apps WHERE app_id = ?', appId),
    n(dbs.identity, 'SELECT COUNT(*) AS n FROM push_tokens WHERE app_id = ?', appId),
    n(dbs.identity, 'SELECT COUNT(*) AS n FROM push_preferences WHERE app_id = ?', appId),
    n(dbs.billing, 'SELECT COUNT(*) AS n FROM entitlements WHERE app_id = ?', appId),
    n(dbs.billing, 'SELECT COUNT(*) AS n FROM entitlement_grants WHERE app_id = ?', appId),
    n(dbs.billing, 'SELECT COUNT(*) AS n FROM rc_events WHERE app_id = ?', appId),
    n(dbs.battery, 'SELECT COUNT(*) AS n FROM quantum_accounts WHERE app_id = ?', appId),
    n(dbs.battery, 'SELECT COUNT(*) AS n FROM quantum_ledger WHERE app_id = ?', appId),
    n(dbs.battery, 'SELECT COUNT(*) AS n FROM invite_redemptions WHERE code IN (SELECT code FROM invite_codes WHERE app_id = ?)', appId),
    n(dbs.billing, "SELECT COUNT(*) AS n FROM entitlements WHERE app_id = ? AND (environment IS NULL OR environment != 'SANDBOX')", appId),
    n(dbs.billing, "SELECT COUNT(*) AS n FROM rc_events WHERE app_id = ? AND (environment IS NULL OR environment != 'SANDBOX')", appId),
    dbs.battery.prepare("SELECT COUNT(*) AS n FROM battery_reservations WHERE app_id = ? AND status = 'reserved' AND expires_at > ?").bind(appId, now).first<{ n: number }>(),
  ]);
  const blockers: ResetBlocker[] = [];
  if (!(APP_STAGES as readonly string[]).includes(stage) || stage === 'live') blockers.push('live_stage');
  if (real + realEvents > 0) blockers.push('real_purchases');
  if ((inFlight?.n ?? 0) > 0) blockers.push('tasks_in_flight');
  return { stage, counts: { sessions, memberApps, pushTokens, pushPreferences, entitlements, grants, rcEvents, quantumAccounts, quantumLedger, inviteRedemptions }, blockers };
}

export type ResetResult = { ok: true; counts: ResetCounts } | { ok: false; blockers: ResetBlocker[] };

/** Re-checks every blocker at run time, then clears each database in one batch (safe to run again if one fails). */
export async function resetAppData(dbs: Databases, actor: { userId: string; requestId: string | null }, appId: string, now: number): Promise<ResetResult> {
  const preview = await previewReset(dbs, appId, now);
  if (preview.blockers.length > 0) return { ok: false, blockers: preview.blockers };
  await dbs.battery.batch([
    dbs.battery.prepare('DELETE FROM invite_redemptions WHERE code IN (SELECT code FROM invite_codes WHERE app_id = ?)').bind(appId),
    dbs.battery.prepare('UPDATE invite_codes SET used = 0 WHERE app_id = ?').bind(appId),
    dbs.battery.prepare('DELETE FROM quantum_ledger WHERE app_id = ?').bind(appId),
    dbs.battery.prepare('DELETE FROM quantum_accounts WHERE app_id = ?').bind(appId),
  ]);
  await dbs.billing.batch([
    dbs.billing.prepare('DELETE FROM entitlement_grants WHERE app_id = ?').bind(appId),
    dbs.billing.prepare('DELETE FROM entitlements WHERE app_id = ?').bind(appId),
    dbs.billing.prepare('DELETE FROM rc_events WHERE app_id = ?').bind(appId),
  ]);
  await dbs.identity.batch([
    dbs.identity.prepare('DELETE FROM sessions WHERE app_id = ?').bind(appId),
    dbs.identity.prepare('DELETE FROM push_tokens WHERE app_id = ?').bind(appId),
    dbs.identity.prepare('DELETE FROM push_preferences WHERE app_id = ?').bind(appId),
    dbs.identity.prepare('DELETE FROM member_apps WHERE app_id = ?').bind(appId),
    auditStatement(dbs.identity, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.app_data_reset', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return { ok: true, counts: preview.counts };
}
