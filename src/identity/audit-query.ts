export interface AuditRow {
  audit_id: string;
  occurred_at: number;
  actor_type: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  app_id: string | null;
  result: string;
  request_id: string | null;
}

/**
 * Audit search for Admin Lite (S-ADM-01, S-PLT-06): newest first with cursor pagination,
 * optionally narrowed to one member (as actor or target) or an action prefix.
 */
export async function listAudit(
  db: D1Database,
  options: { memberId?: string | undefined; actionPrefix?: string | undefined; cursor?: string | undefined; limit?: number | undefined },
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const where: string[] = ['audit_id < ?'];
  const params: (string | number)[] = [options.cursor ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff'];
  if (options.memberId) {
    where.push('(actor_user_id = ? OR target_id = ?)');
    params.push(options.memberId, options.memberId);
  }
  if (options.actionPrefix) {
    where.push("action LIKE ? ESCAPE '\\'");
    params.push(`${options.actionPrefix.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  }
  const result = await db
    .prepare(
      `SELECT audit_id, occurred_at, actor_type, actor_user_id, action, target_type, target_id, app_id, result, request_id
       FROM audit_log WHERE ${where.join(' AND ')} ORDER BY audit_id DESC LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<AuditRow>();
  const rows = result.results.slice(0, limit);
  return { rows, nextCursor: result.results.length > limit ? (rows[rows.length - 1]?.audit_id ?? null) : null };
}
