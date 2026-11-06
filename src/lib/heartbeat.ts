/**
 * One row per scheduled job (cron "minutely" and "daily") so Admin Lite can show whether they keep succeeding.
 * Rows hold times and a short error text only.
 */
export type JobName = 'minutely' | 'daily';

export async function markStarted(db: D1Database, job: JobName, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO job_heartbeats (job, last_started_at) VALUES (?, ?) ON CONFLICT (job) DO UPDATE SET last_started_at = excluded.last_started_at')
    .bind(job, now)
    .run();
}

export async function markFinished(db: D1Database, job: JobName, now: number, errors: string[]): Promise<void> {
  if (errors.length === 0) {
    await db.prepare('UPDATE job_heartbeats SET last_success_at = ? WHERE job = ?').bind(now, job).run();
    return;
  }
  await db.prepare('UPDATE job_heartbeats SET last_error_at = ?, last_error = ? WHERE job = ?').bind(now, errors.join('; ').slice(0, 300), job).run();
}

export interface Heartbeat {
  job: JobName;
  last_started_at: number;
  last_success_at: number | null;
  last_error_at: number | null;
  last_error: string | null;
}

export async function readHeartbeats(db: D1Database): Promise<Heartbeat[]> {
  const rows = await db.prepare('SELECT job, last_started_at, last_success_at, last_error_at, last_error FROM job_heartbeats ORDER BY job').all<Heartbeat>();
  return rows.results;
}
