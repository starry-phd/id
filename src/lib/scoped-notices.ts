import { auditStatement } from './audit';

/** Announcements shown for one App (or every App) between two moments. */
export interface ScopedNotice {
  notice_id: number;
  app_id: string | null;
  message: string;
  starts_at: number;
  ends_at: number;
}

export const MAX_SCOPED_NOTICES = 30;
const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

/** Parses "2026-11-08T09:30" (what a datetime-local box sends) as Taipei time; null when it is not a real time. */
export function parseTaipeiLocal(text: string): number | null {
  const m = LOCAL.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return utc - TAIPEI_OFFSET_MS;
}

export type AddNoticeResult = { ok: true } | { ok: false; error: string };

export async function addScopedNotice(
  db: D1Database,
  input: { appId: string | null; message: string; startsAt: number; endsAt: number },
  actor: { userId: string; requestId: string | null },
  now: number,
): Promise<AddNoticeResult> {
  const message = input.message.trim();
  if (message.length < 1 || message.length > 500) return { ok: false, error: '公告請填 1～500 字。' };
  if (input.endsAt <= input.startsAt) return { ok: false, error: '結束時間要晚於開始時間。' };
  if (input.endsAt <= now) return { ok: false, error: '結束時間已經過了。' };
  if (input.endsAt - input.startsAt > 366 * 24 * 3600 * 1000) return { ok: false, error: '單一公告最長一年。' };
  const count = await db.prepare('SELECT COUNT(*) AS n FROM scoped_notices WHERE ends_at > ?').bind(now).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_SCOPED_NOTICES) return { ok: false, error: `進行中與未來的公告最多 ${MAX_SCOPED_NOTICES} 則，請先刪除不用的。` };
  await db.batch([
    db.prepare('INSERT INTO scoped_notices (app_id, message, starts_at, ends_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(input.appId, message, input.startsAt, input.endsAt, now, actor.userId),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.scoped_notice_added', targetType: 'app', targetId: input.appId ?? 'all', appId: input.appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return { ok: true };
}

export async function deleteScopedNotice(db: D1Database, noticeId: number, actor: { userId: string; requestId: string | null }, now: number): Promise<boolean> {
  const [result] = await db.batch([
    db.prepare('DELETE FROM scoped_notices WHERE notice_id = ?').bind(noticeId),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.scoped_notice_deleted', targetType: 'notice', targetId: String(noticeId), result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return result?.meta.changes === 1;
}

/** Notices that have not ended yet (running and upcoming), soonest first; for the Admin Lite list. */
export async function listScopedNotices(db: D1Database, now: number): Promise<ScopedNotice[]> {
  const rows = await db.prepare('SELECT notice_id, app_id, message, starts_at, ends_at FROM scoped_notices WHERE ends_at > ? ORDER BY starts_at, notice_id').bind(now).all<ScopedNotice>();
  return rows.results;
}

/**
 * Notices running right now. With an app id: those for all Apps plus that App's own.
 * Without: only the ones for all Apps (the account center).
 */
export async function activeScopedNotices(db: D1Database, now: number, appId?: string): Promise<ScopedNotice[]> {
  const sql = `SELECT notice_id, app_id, message, starts_at, ends_at FROM scoped_notices WHERE starts_at <= ? AND ends_at > ? AND (app_id IS NULL${appId ? ' OR app_id = ?' : ''}) ORDER BY notice_id`;
  const rows = await (appId ? db.prepare(sql).bind(now, now, appId) : db.prepare(sql).bind(now, now)).all<ScopedNotice>();
  return rows.results;
}
