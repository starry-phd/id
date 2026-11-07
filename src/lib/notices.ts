export interface Notices {
  announcement: string;
  maintenance: boolean;
  maintenanceMessage: string;
}

export async function getNotices(db: D1Database): Promise<Notices> {
  const rows = await db.prepare('SELECT key, value FROM system_notices').all<{ key: string; value: string }>();
  const map = new Map(rows.results.map((r) => [r.key, r.value]));
  return { announcement: map.get('announcement') ?? '', maintenance: map.get('maintenance') === '1', maintenanceMessage: map.get('maintenance_message') ?? '' };
}

/** Saves all three notices at once; empty text clears a notice. */
export async function saveNotices(db: D1Database, input: Notices, actorUserId: string, now: number): Promise<boolean> {
  const announcement = input.announcement.trim();
  const message = input.maintenanceMessage.trim();
  if (announcement.length > 500 || message.length > 500) return false;
  const upsert = (key: string, value: string) =>
    db
      .prepare('INSERT INTO system_notices (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind(key, value, now, actorUserId);
  await db.batch([upsert('announcement', announcement), upsert('maintenance', input.maintenance ? '1' : '0'), upsert('maintenance_message', message)]);
  return true;
}
