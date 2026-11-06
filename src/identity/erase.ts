import type { Env } from '../env';
import { enqueueCleanup, executeCleanup, type CleanupKind } from './cleanup-jobs';

/**
 * Second half of an immediate deletion (the identity rows are already gone): removes the avatar object and the
 * member's billing and Battery rows, and queues the RevenueCat customer deletion. Never throws. A step that fails
 * is put in the retry queue (cleanup_jobs) and repeated every minute until it works.
 */
export async function cleanupAfterDeletion(env: Env, userId: string, avatarKey: string | null, now: number): Promise<void> {
  const steps: [CleanupKind, string | null][] = [
    ['avatar', avatarKey],
    ['billing', null],
    ['battery', null],
  ];
  for (const [kind, payload] of steps) {
    try {
      await executeCleanup(env, kind, userId, payload, now);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'deletion.cleanup_failed', step: kind, message: error instanceof Error ? error.message : 'failed' }));
      await enqueueCleanup(env.DB_IDENTITY, kind, userId, payload, now).catch(() => undefined);
    }
  }
}
