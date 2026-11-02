import { uuidv7 } from './crypto';

export interface AuditEvent {
  actorType: 'user' | 'admin' | 'system';
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  appId?: string | null;
  result: 'success' | 'denied' | 'error';
  requestId?: string | null;
  retention: 'general' | 'security';
}

/** Builds an audit insert so it can join a D1 batch with the change it records (spec S-PLT-06). */
export function auditStatement(db: D1Database, event: AuditEvent, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (audit_id, occurred_at, actor_type, actor_user_id, action, target_type, target_id, app_id, result, request_id, retention_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uuidv7(now),
      now,
      event.actorType,
      event.actorUserId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      event.appId ?? null,
      event.result,
      event.requestId ?? null,
      event.retention,
    );
}

export async function audit(db: D1Database, event: AuditEvent, now: number): Promise<void> {
  await auditStatement(db, event, now).run();
}
