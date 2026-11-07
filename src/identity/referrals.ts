import { auditStatement } from '../lib/audit';
import { initialsOf } from './initials';
import { MEMBER_NO } from './member-number';

/**
 * The referral tree ("組織網"). A member is bound to one referrer, once: through the invite link
 * /Invite<member number>, or later by opening it. Never to themselves, and never to someone below them (no loops).
 */
export type BindResult = 'bound' | 'already' | 'self' | 'cycle' | 'invalid';

export interface Referrer {
  user_id: string;
  member_no: string;
  name: string;
}

/** What other people may see as a member's name: nickname, else a public name, else the member number. */
export const DISPLAY_SQL = `COALESCE(NULLIF(p.nickname, ''), CASE WHEN COALESCE(json_extract(p.visibility, '$.display_name'), 'public') <> 'private' THEN NULLIF(p.display_name, '') END, u.member_no, '星友')`;

export async function memberByNo(db: D1Database, memberNo: string): Promise<Referrer | null> {
  if (!MEMBER_NO.test(memberNo)) return null;
  const row = await db
    .prepare(`SELECT u.user_id, u.member_no, ${DISPLAY_SQL} AS name FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id WHERE u.member_no = ? AND u.status = 'active'`)
    .bind(memberNo)
    .first<Referrer>();
  return row ?? null;
}

export async function referrerOf(db: D1Database, userId: string): Promise<(Referrer & { created_at: number }) | null> {
  const row = await db
    .prepare(
      `SELECT r.referrer_user_id AS user_id, u.member_no, ${DISPLAY_SQL} AS name, r.created_at
       FROM referrals r JOIN users u ON u.user_id = r.referrer_user_id LEFT JOIN profiles p ON p.user_id = u.user_id WHERE r.invitee_user_id = ?`,
    )
    .bind(userId)
    .first<Referrer & { created_at: number }>();
  return row ?? null;
}

/** True when `userId` is a referrer, direct or indirect, of `of`. */
async function isAbove(db: D1Database, userId: string, of: string): Promise<boolean> {
  const row = await db
    .prepare(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT referrer_user_id, 1 FROM referrals WHERE invitee_user_id = ? AND referrer_user_id IS NOT NULL
         UNION ALL
         SELECT r.referrer_user_id, up.depth + 1 FROM referrals r JOIN up ON r.invitee_user_id = up.id WHERE r.referrer_user_id IS NOT NULL AND up.depth < 200
       ) SELECT 1 AS hit FROM up WHERE id = ? LIMIT 1`,
    )
    .bind(of, userId)
    .first();
  return row !== null;
}

export async function bindReferrer(db: D1Database, inviteeId: string, referrerId: string, requestId: string | null, now: number): Promise<BindResult> {
  if (inviteeId === referrerId) return 'self';
  const [existing, referrer] = await Promise.all([
    db.prepare('SELECT 1 AS present FROM referrals WHERE invitee_user_id = ?').bind(inviteeId).first(),
    db.prepare("SELECT 1 AS present FROM users WHERE user_id = ? AND status = 'active'").bind(referrerId).first(),
  ]);
  if (existing) return 'already';
  if (!referrer) return 'invalid';
  // The invitee must not be above the referrer, or the tree would loop.
  if (await isAbove(db, inviteeId, referrerId)) return 'cycle';
  const [inserted] = await db.batch([
    db.prepare('INSERT OR IGNORE INTO referrals (invitee_user_id, referrer_user_id, created_at) VALUES (?, ?, ?)').bind(inviteeId, referrerId, now),
    auditStatement(db, { actorType: 'user', actorUserId: inviteeId, action: 'referral.bound', targetType: 'user', targetId: referrerId, appId: null, result: 'success', requestId, retention: 'general' }, now),
  ]);
  return inserted?.meta.changes === 1 ? 'bound' : 'already';
}

export interface OrgNode {
  user_id: string;
  parent_id: string;
  depth: number;
  name: string;
  member_no: string | null;
  initials: string;
  has_avatar: boolean;
  joined_at: number;
}

export interface OrgStats {
  total: number;
  direct: number;
  depth: number;
  perLevel: number[];
  truncated: boolean;
}

export const ORG_NODE_LIMIT = 1500;
const ORG_DEPTH_LIMIT = 50;

/** Everyone below `rootId`, level by level (parents before children). */
export async function orgNetwork(db: D1Database, rootId: string): Promise<{ nodes: OrgNode[]; stats: OrgStats }> {
  const rows = await db
    .prepare(
      `WITH RECURSIVE down(id, parent, depth, joined) AS (
         SELECT invitee_user_id, referrer_user_id, 1, created_at FROM referrals WHERE referrer_user_id = ?
         UNION ALL
         SELECT r.invitee_user_id, r.referrer_user_id, down.depth + 1, r.created_at FROM referrals r JOIN down ON r.referrer_user_id = down.id WHERE down.depth < ${ORG_DEPTH_LIMIT}
       )
       SELECT d.id AS user_id, d.parent AS parent_id, d.depth, d.joined AS joined_at, u.member_no, ${DISPLAY_SQL} AS name, p.display_name AS raw_name, p.avatar_key
       FROM down d JOIN users u ON u.user_id = d.id LEFT JOIN profiles p ON p.user_id = d.id
       WHERE u.status = 'active' ORDER BY d.depth, d.joined, d.id LIMIT ${ORG_NODE_LIMIT + 1}`,
    )
    .bind(rootId)
    .all<{ user_id: string; parent_id: string; depth: number; joined_at: number; member_no: string | null; name: string; raw_name: string | null; avatar_key: string | null }>();
  const truncated = rows.results.length > ORG_NODE_LIMIT;
  const kept = rows.results.slice(0, ORG_NODE_LIMIT);
  const nodes: OrgNode[] = kept.map((r) => ({ user_id: r.user_id, parent_id: r.parent_id, depth: r.depth, name: r.name, member_no: r.member_no, initials: initialsOf(r.name), has_avatar: r.avatar_key !== null, joined_at: r.joined_at }));
  const perLevel: number[] = [];
  for (const n of nodes) perLevel[n.depth - 1] = (perLevel[n.depth - 1] ?? 0) + 1;
  return { nodes, stats: { total: nodes.length, direct: perLevel[0] ?? 0, depth: perLevel.length, perLevel: Array.from(perLevel, (v) => v ?? 0), truncated } };
}

/** Counts only, for the referral page. */
export async function directCount(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE referrer_user_id = ?').bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}
