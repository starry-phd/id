import { appRegistry } from '../apps/registry';
import { forgetBatteryMembers } from '../battery/battery';
import { forgetMembers } from '../billing/revenuecat';
import type { Env } from '../env';
import { uuidv7 } from '../lib/crypto';
import { WEB_APP_ID } from './web-sessions';

/**
 * Clean-up after a member deletion touches three places outside the identity database. A step that fails is
 * written here and retried every minute with a growing delay, so personal data can never be left behind by a
 * single outage. After MAX_ATTEMPTS the job is marked abandoned and stays visible in Admin Lite.
 */
export type CleanupKind = 'avatar' | 'billing' | 'battery';
export const MAX_ATTEMPTS = 12;
const MINUTE_MS = 60 * 1000;

export function retryDelayMs(attempts: number): number {
  return Math.min(2 ** attempts, 60) * MINUTE_MS;
}

export async function enqueueCleanup(db: D1Database, kind: CleanupKind, userId: string, payload: string | null, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO cleanup_jobs (job_id, kind, user_id, payload, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .bind(uuidv7(now), kind, userId, payload, now + retryDelayMs(0), now)
    .run();
}

/** Runs one clean-up step against the real bindings. Throws when the step fails. */
export async function executeCleanup(env: Env, kind: CleanupKind, userId: string, payload: string | null, now: number): Promise<void> {
  if (kind === 'avatar') {
    if (payload && env.AVATARS) await env.AVATARS.delete(payload);
  } else if (kind === 'billing') {
    const storeApps = [...appRegistry.keys()].filter((id) => id !== WEB_APP_ID);
    await forgetMembers(env.DB_BILLING, [userId], storeApps, now);
  } else {
    await forgetBatteryMembers(env.DB_BATTERY, [userId]);
  }
}

interface JobRow {
  job_id: string;
  kind: CleanupKind;
  user_id: string;
  payload: string | null;
  attempts: number;
}

export interface CleanupReport {
  done: number;
  retrying: number;
  abandoned: number;
}

export async function runCleanupJobs(
  db: D1Database,
  now: number,
  execute: (kind: CleanupKind, userId: string, payload: string | null) => Promise<void>,
  limit = 20,
): Promise<CleanupReport> {
  const due = await db
    .prepare('SELECT job_id, kind, user_id, payload, attempts FROM cleanup_jobs WHERE abandoned_at IS NULL AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?')
    .bind(now, limit)
    .all<JobRow>();
  const report: CleanupReport = { done: 0, retrying: 0, abandoned: 0 };
  for (const job of due.results) {
    try {
      await execute(job.kind, job.user_id, job.payload);
      await db.prepare('DELETE FROM cleanup_jobs WHERE job_id = ?').bind(job.job_id).run();
      report.done += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : 'failed';
      if (attempts >= MAX_ATTEMPTS) {
        await db.prepare('UPDATE cleanup_jobs SET attempts = ?, abandoned_at = ? WHERE job_id = ?').bind(attempts, now, job.job_id).run();
        report.abandoned += 1;
        console.error(JSON.stringify({ level: 'error', event: 'deletion.cleanup_abandoned', kind: job.kind, message }));
      } else {
        await db.prepare('UPDATE cleanup_jobs SET attempts = ?, next_attempt_at = ? WHERE job_id = ?').bind(attempts, now + retryDelayMs(attempts), job.job_id).run();
        report.retrying += 1;
      }
    }
  }
  return report;
}

export async function cleanupBacklog(db: D1Database): Promise<{ waiting: number; abandoned: number }> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(abandoned_at IS NULL), 0) AS waiting, COALESCE(SUM(abandoned_at IS NOT NULL), 0) AS abandoned FROM cleanup_jobs')
    .first<{ waiting: number; abandoned: number }>();
  return { waiting: row?.waiting ?? 0, abandoned: row?.abandoned ?? 0 };
}
