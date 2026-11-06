import { appRegistry } from '../apps/registry';
import { forgetBatteryMembers } from '../battery/battery';
import { forgetMembers } from '../billing/revenuecat';
import type { Env } from '../env';
import { WEB_APP_ID } from './web-sessions';

/**
 * Second half of an immediate deletion (the identity rows are already gone): removes the avatar object and the
 * member's billing and Battery rows, and queues the RevenueCat customer deletion. Never throws; a failure is logged
 * and the member is already deleted from identity, so nobody can sign in with it.
 */
export async function cleanupAfterDeletion(env: Env, userId: string, avatarKey: string | null, now: number): Promise<void> {
  const storeApps = [...appRegistry.keys()].filter((id) => id !== WEB_APP_ID);
  const steps: [string, () => Promise<unknown>][] = [
    ['avatar', async () => (avatarKey && env.AVATARS ? env.AVATARS.delete(avatarKey) : undefined)],
    ['billing', () => forgetMembers(env.DB_BILLING, [userId], storeApps, now)],
    ['battery', () => forgetBatteryMembers(env.DB_BATTERY, [userId])],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'deletion.cleanup_failed', step: name, message: error instanceof Error ? error.message : 'failed' }));
    }
  }
}
