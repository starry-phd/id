import { sendPush, type FetchLike } from './push';

/** The push category staff announcements use; a member can turn it off per App like any other category. */
export const ANNOUNCEMENT_CATEGORY = 'announcements';

export interface BulkPushSummary {
  /** Members who got the notification on at least one device. */
  reached: number;
  /** Devices that were sent to. */
  devices: number;
  optedOut: number;
  noDevices: number;
  inactive: number;
  /** Members whose send failed (push service error); the rest were still attempted. */
  failed: number;
  /** Devices Expo reported as gone; their tokens were removed. */
  removed: number;
}

/**
 * Staff notification to several members in one App (item 7). Each member is sent on their own devices in that
 * App only, honouring their category choice and skipping members who are not active. One member's failure never
 * stops the others. The text is passed through as given: callers validate length and never put personal data in it.
 */
export async function bulkPush(
  db: D1Database,
  fetchFn: FetchLike,
  userIds: readonly string[],
  message: { appId: string; title: string; body: string; category?: string },
  options: { accessToken?: string | undefined } = {},
): Promise<BulkPushSummary> {
  const summary: BulkPushSummary = { reached: 0, devices: 0, optedOut: 0, noDevices: 0, inactive: 0, failed: 0, removed: 0 };
  for (const userId of new Set(userIds)) {
    try {
      const result = await sendPush(db, fetchFn, { userId, appId: message.appId, category: message.category ?? ANNOUNCEMENT_CATEGORY, title: message.title, body: message.body }, options);
      summary.removed += result.removed;
      if (result.skipped === 'opted_out') summary.optedOut++;
      else if (result.skipped === 'no_devices') summary.noDevices++;
      else if (result.skipped === 'inactive') summary.inactive++;
      else if (result.sent > 0) {
        summary.reached++;
        summary.devices += result.sent;
      }
    } catch {
      summary.failed++;
    }
  }
  return summary;
}
