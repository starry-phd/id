import { app } from './app';
import { refreshDynamicApps } from './apps/dynamic';
import { appRegistry } from './apps/registry';
import { batteryRetention, forgetBatteryMembers, releaseExpired } from './battery/battery';
import { reconcileWithRevenueCat } from './billing/reconcile';
import { quantumHook } from './battery/purchases';
import { forgetMembers, perAppSecrets, processPendingEvents, processRevenueCatDeletions } from './billing/revenuecat';
import type { Env } from './env';
import { reportError } from './lib/error-report';
import { markFinished, markStarted, type JobName } from './lib/heartbeat';
import { executeCleanup, runCleanupJobs } from './identity/cleanup-jobs';
import { runDailyMaintenance } from './identity/maintenance';
import { assignMissingMemberNumbers } from './identity/member-number';
import { WEB_APP_ID } from './identity/web-sessions';

/** The every-minute Cron Trigger in wrangler.jsonc; any other schedule is the daily run. */
const EVERY_MINUTE = '* * * * *';

/**
 * Runs the steps of one job independently: a step that throws is logged and collected, and the steps after it still run.
 * The job as a whole fails (so Sentry hears about it) when any step failed.
 */
async function steps(job: JobName, env: Env, now: number, work: [string, () => Promise<unknown>][]): Promise<void> {
  const errors: string[] = [];
  await markStarted(env.DB_IDENTITY, job, now).catch(() => undefined);
  for (const [name, run] of work) {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed';
      errors.push(`${name}: ${message}`);
      console.error(JSON.stringify({ level: 'error', event: `maintenance.${job}.step_failed`, step: name, message }));
    }
  }
  await markFinished(env.DB_IDENTITY, job, now, errors).catch(() => undefined);
  if (errors.length > 0) throw new Error(`${job} failed in ${errors.length} step(s): ${errors.join('; ').slice(0, 300)}`);
}

/** Every minute (S-BAT-03): release timed-out Battery reservations, give new members numbers, retry deletion clean-ups. */
async function minutely(env: Env, now: number): Promise<void> {
  await steps('minutely', env, now, [
    ['member-numbers', () => assignMissingMemberNumbers(env.DB_IDENTITY, now)],
    [
      'battery-expiry',
      async () => {
        const released = await releaseExpired(env.DB_BATTERY, now);
        if (released > 0) console.log(JSON.stringify({ level: 'info', event: 'battery.reservations_expired', released }));
      },
    ],
    [
      'deletion-cleanup',
      async () => {
        const report = await runCleanupJobs(env.DB_IDENTITY, now, (kind, userId, payload) => executeCleanup(env, kind, userId, payload, now));
        if (report.done + report.retrying + report.abandoned > 0) console.log(JSON.stringify({ level: 'info', event: 'deletion.cleanup', ...report }));
      },
    ],
  ]);
}

/** Daily: deletion purge, revocations, retention (S-ID-06, S-PLT-06), billing repair and reconciliation (S-BIL-04). */
async function daily(env: Env, now: number): Promise<void> {
  const fetcher = (url: string, init?: RequestInit) => fetch(url, init);
  const apiKeys = perAppSecrets(env.REVENUECAT_API_KEYS);
  const report: Record<string, unknown> = {};
  await steps('daily', env, now, [
    ['apps', () => refreshDynamicApps(env.DB_IDENTITY, now)],
    [
      'identity',
      async () => {
        const storeApps = [...appRegistry.keys()].filter((id) => id !== WEB_APP_ID);
        const avatars = env.AVATARS;
        const supportFiles = env.SUPPORT_FILES;
        Object.assign(
          report,
          await runDailyMaintenance(
            {
              db: env.DB_IDENTITY,
              secrets: env,
              fetch: fetcher,
              ...(avatars ? { deleteObjects: (keys: string[]) => avatars.delete(keys) } : {}),
              ...(supportFiles ? { supportFiles } : {}),
              onPurged: async (userIds) => {
                await forgetMembers(env.DB_BILLING, userIds, storeApps, now);
                await forgetBatteryMembers(env.DB_BATTERY, userIds);
              },
            },
            now,
          ),
        );
      },
    ],
    ['billing-events', async () => void (report.billingEvents = await processPendingEvents(env.DB_BILLING, now, 200, quantumHook(env.DB_BATTERY, now)))],
    ['revenuecat-deletions', async () => void (report.revenuecatDeletions = await processRevenueCatDeletions(env.DB_BILLING, apiKeys, fetcher, now))],
    ['reconcile', async () => void (report.reconcile = await reconcileWithRevenueCat(env.DB_BILLING, apiKeys, fetcher, now))],
    ['battery-retention', async () => void (report.battery = await batteryRetention(env.DB_BATTERY, now))],
  ]);
  console.log(JSON.stringify({ level: 'info', event: 'maintenance.daily', ...report }));
}

async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const now = controller.scheduledTime;
  const job = controller.cron === EVERY_MINUTE ? 'minutely' : 'daily';
  try {
    if (job === 'minutely') await minutely(env, now);
    else await daily(env, now);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: `maintenance.${job}`, message: error instanceof Error ? error.message : 'failed' }));
    await reportError(env.SENTRY_DSN, error, { kind: 'scheduled', environment: env.STARRY_ENV, where: job });
    throw error;
  }
}

export default { fetch: app.fetch, scheduled };
