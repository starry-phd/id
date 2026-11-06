import { auditStatement } from '../lib/audit';
import { processQueuedObjectDeletions, type ObjectStore } from '../support/attachments';
import { purgeOldTickets } from '../support/tickets';
import { enqueueCleanup } from './cleanup-jobs';
import { processAppleRevocations, type AppleSecrets, type FetchLike } from './apple';
import { purgeExpiredDeletions } from './lifecycle';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Spec S-PLT-06: general audit rows kept 90 days, admin and security rows 1 year. */
export const AUDIT_RETENTION_MS = { general: 90 * DAY_MS, security: 365 * DAY_MS } as const;

/** Ended sessions are kept 30 days for support questions, then removed. */
export const ENDED_SESSION_RETENTION_MS = 30 * DAY_MS;

export interface MaintenanceDeps {
  db: D1Database;
  secrets: AppleSecrets;
  fetch: FetchLike;
  /** Deletes avatar objects of purged members; absent until avatars are stored in R2. */
  deleteObjects?: (keys: string[]) => Promise<void>;
  /** Removes purged members from other domains (billing projection, RevenueCat). */
  onPurged?: (userIds: string[]) => Promise<void>;
  /** Support attachment bucket; files of deleted tickets are removed from it. */
  supportFiles?: Pick<ObjectStore, 'delete'>;
}

export interface MaintenanceReport {
  purgedMembers: number;
  appleRevoked: number;
  appleRetrying: number;
  appleAbandoned: number;
  nonces: number;
  sessions: number;
  audit: number;
  tickets: number;
  supportFiles: number;
}

/** Daily housekeeping run by the Cron Trigger. Each step is bounded so one run stays short. */
export async function runDailyMaintenance(deps: MaintenanceDeps, now: number): Promise<MaintenanceReport> {
  const { db } = deps;
  const purge = await purgeExpiredDeletions(db, now);
  // A failed clean-up goes to the retry queue instead of stopping the run (nothing may be left behind).
  if (purge.avatarKeys.length > 0 && deps.deleteObjects) {
    try {
      await deps.deleteObjects(purge.avatarKeys);
    } catch {
      for (const key of purge.avatarKeys) await enqueueCleanup(db, 'avatar', 'purged', key, now);
    }
  }
  if (purge.purgedUserIds.length > 0 && deps.onPurged) {
    try {
      await deps.onPurged(purge.purgedUserIds);
    } catch {
      for (const userId of purge.purgedUserIds) {
        await enqueueCleanup(db, 'billing', userId, null, now);
        await enqueueCleanup(db, 'battery', userId, null, now);
      }
    }
  }
  const apple = await processAppleRevocations(db, deps.secrets, deps.fetch, now);
  const [nonces, sessions, audit] = await db.batch([
    db.prepare('DELETE FROM auth_nonces WHERE expires_at < ?').bind(now - DAY_MS),
    db
      .prepare('DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR expires_at < ?')
      .bind(now - ENDED_SESSION_RETENTION_MS, now - ENDED_SESSION_RETENTION_MS),
    db
      .prepare(
        `DELETE FROM audit_log WHERE (retention_class = 'general' AND occurred_at < ?)
           OR (retention_class = 'security' AND occurred_at < ?)`,
      )
      .bind(now - AUDIT_RETENTION_MS.general, now - AUDIT_RETENTION_MS.security),
  ]);
  const tickets = await purgeOldTickets(db, now);
  const supportFiles = deps.supportFiles ? await processQueuedObjectDeletions(db, deps.supportFiles) : 0;
  const report: MaintenanceReport = {
    purgedMembers: purge.purgedUserIds.length,
    appleRevoked: apple.revoked,
    appleRetrying: apple.failed,
    appleAbandoned: apple.abandoned,
    nonces: nonces?.meta.changes ?? 0,
    sessions: sessions?.meta.changes ?? 0,
    audit: audit?.meta.changes ?? 0,
    tickets,
    supportFiles,
  };
  await auditStatement(db, { actorType: 'system', action: 'maintenance.daily', result: 'success', retention: 'general' }, now).run();
  return report;
}
