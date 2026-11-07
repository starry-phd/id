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
/** Slightly after the first retry is due, so the minute schedule normally gets there first and the queue message finds nothing left. */
export const CLEANUP_FIRST_DELAY_SECONDS = 75;

export function retryDelayMs(attempts: number): number {
  return Math.min(2 ** attempts, 60) * MINUTE_MS;
}

export async function enqueueCleanup(db: D1Database, kind: CleanupKind, userId: string, payload: string | null, now: number): Promise<string> {
  const jobId = uuidv7(now);
  await db
    .prepare('INSERT INTO cleanup_jobs (job_id, kind, user_id, payload, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .bind(jobId, kind, userId, payload, now + retryDelayMs(0), now)
    .run();
  return jobId;
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
    const outcome = await attemptJob(db, job, now, execute);
    if (outcome.status === 'done') report.done += 1;
    else if (outcome.status === 'retry') report.retrying += 1;
    else report.abandoned += 1;
  }
  return report;
}

export type AttemptOutcome = { status: 'done' } | { status: 'abandoned' } | { status: 'retry'; delayMs: number };

/** One attempt at one job, shared by the minute schedule and the queue consumer. The D1 row stays the source of truth. */
async function attemptJob(
  db: D1Database,
  job: JobRow,
  now: number,
  execute: (kind: CleanupKind, userId: string, payload: string | null) => Promise<void>,
): Promise<AttemptOutcome> {
  try {
    await execute(job.kind, job.user_id, job.payload);
    await db.prepare('DELETE FROM cleanup_jobs WHERE job_id = ?').bind(job.job_id).run();
    return { status: 'done' };
  } catch (error) {
    const attempts = job.attempts + 1;
    const message = error instanceof Error ? error.message : 'failed';
    if (attempts >= MAX_ATTEMPTS) {
      await db.prepare('UPDATE cleanup_jobs SET attempts = ?, abandoned_at = ? WHERE job_id = ?').bind(attempts, now, job.job_id).run();
      console.error(JSON.stringify({ level: 'error', event: 'deletion.cleanup_abandoned', kind: job.kind, message }));
      return { status: 'abandoned' };
    }
    const delayMs = retryDelayMs(attempts);
    await db.prepare('UPDATE cleanup_jobs SET attempts = ?, next_attempt_at = ? WHERE job_id = ?').bind(attempts, now + delayMs, job.job_id).run();
    return { status: 'retry', delayMs };
  }
}

/**
 * Queue consumer step (ADR 0009): runs one job by id right when its queue message arrives. A job that no longer
 * exists (the minute schedule already finished it) or was abandoned is acknowledged without doing anything.
 */
export async function runCleanupJobById(
  db: D1Database,
  jobId: string,
  now: number,
  execute: (kind: CleanupKind, userId: string, payload: string | null) => Promise<void>,
): Promise<AttemptOutcome | { status: 'missing' }> {
  const job = await db
    .prepare('SELECT job_id, kind, user_id, payload, attempts FROM cleanup_jobs WHERE job_id = ? AND abandoned_at IS NULL')
    .bind(jobId)
    .first<JobRow>();
  if (!job) return { status: 'missing' };
  return attemptJob(db, job, now, execute);
}

export async function cleanupBacklog(db: D1Database): Promise<{ waiting: number; abandoned: number }> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(abandoned_at IS NULL), 0) AS waiting, COALESCE(SUM(abandoned_at IS NOT NULL), 0) AS abandoned FROM cleanup_jobs')
    .first<{ waiting: number; abandoned: number }>();
  return { waiting: row?.waiting ?? 0, abandoned: row?.abandoned ?? 0 };
}
