import { app } from './app';
import { appRegistry } from './apps/registry';
import { forgetMembers, perAppSecrets, processPendingEvents, processRevenueCatDeletions } from './billing/revenuecat';
import type { Env } from './env';
import { runDailyMaintenance } from './identity/maintenance';
import { WEB_APP_ID } from './identity/web-sessions';

/** Cron Trigger (wrangler.jsonc "triggers"): daily purge, revocations, billing and retention (S-ID-06, S-PLT-06, S-BIL-04). */
async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const now = controller.scheduledTime;
  const fetcher = (url: string, init?: RequestInit) => fetch(url, init);
  const storeApps = [...appRegistry.keys()].filter((id) => id !== WEB_APP_ID);
  try {
    const avatars = env.AVATARS;
    const report = await runDailyMaintenance(
      {
        db: env.DB_IDENTITY,
        secrets: env,
        fetch: fetcher,
        ...(avatars ? { deleteObjects: (keys: string[]) => avatars.delete(keys) } : {}),
        onPurged: (userIds) => forgetMembers(env.DB_BILLING, userIds, storeApps, now),
      },
      now,
    );
    const events = await processPendingEvents(env.DB_BILLING, now, 200);
    const revenuecat = await processRevenueCatDeletions(env.DB_BILLING, perAppSecrets(env.REVENUECAT_API_KEYS), fetcher, now);
    console.log(JSON.stringify({ level: 'info', event: 'maintenance.daily', ...report, billingEvents: events, revenuecatDeletions: revenuecat }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'maintenance.daily', message: error instanceof Error ? error.message : 'failed' }));
    throw error;
  }
}

export default { fetch: app.fetch, scheduled };
