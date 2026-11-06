import { app } from './app';
import { refreshDynamicApps } from './apps/dynamic';
import { appRegistry } from './apps/registry';
import { batteryRetention, forgetBatteryMembers, releaseExpired } from './battery/battery';
import { reconcileWithRevenueCat } from './billing/reconcile';
import { forgetMembers, perAppSecrets, processPendingEvents, processRevenueCatDeletions } from './billing/revenuecat';
import type { Env } from './env';
import { reportError } from './lib/error-report';
import { runDailyMaintenance } from './identity/maintenance';
import { WEB_APP_ID } from './identity/web-sessions';

/** The every-minute Cron Trigger in wrangler.jsonc; any other schedule is the daily run. */
const EVERY_MINUTE = '* * * * *';

/** Every minute (S-BAT-03): release Battery reservations whose timeout passed. */
async function minutely(env: Env, now: number): Promise<void> {
  const released = await releaseExpired(env.DB_BATTERY, now);
  if (released > 0) console.log(JSON.stringify({ level: 'info', event: 'battery.reservations_expired', released }));
}

/** Daily: deletion purge, revocations, retention (S-ID-06, S-PLT-06), billing repair and reconciliation (S-BIL-04). */
async function daily(env: Env, now: number): Promise<void> {
  const fetcher = (url: string, init?: RequestInit) => fetch(url, init);
  await refreshDynamicApps(env.DB_IDENTITY, now);
  const storeApps = [...appRegistry.keys()].filter((id) => id !== WEB_APP_ID);
  const avatars = env.AVATARS;
  const supportFiles = env.SUPPORT_FILES;
  const report = await runDailyMaintenance(
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
  );
  const apiKeys = perAppSecrets(env.REVENUECAT_API_KEYS);
  const events = await processPendingEvents(env.DB_BILLING, now, 200);
  const revenuecat = await processRevenueCatDeletions(env.DB_BILLING, apiKeys, fetcher, now);
  const reconcile = await reconcileWithRevenueCat(env.DB_BILLING, apiKeys, fetcher, now);
  const battery = await batteryRetention(env.DB_BATTERY, now);
  console.log(JSON.stringify({ level: 'info', event: 'maintenance.daily', ...report, billingEvents: events, revenuecatDeletions: revenuecat, reconcile, battery }));
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
