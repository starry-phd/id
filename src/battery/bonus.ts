import { bonusX10, type BonusRow } from '../identity/profile';
import { setBonus } from './battery';

/**
 * Brings the member's Battery bonus multiplier in line with what their profile shows publicly right now.
 * Called after every profile save and whenever a member page loads, so the multiplier never drifts for long.
 * A failure is logged and ignored: the next call repairs it, and a profile save must not fail because of Battery.
 */
export async function syncBonus(db: D1Database, userId: string, row: BonusRow, now: number): Promise<number> {
  const wanted = bonusX10(row, now);
  try {
    return (await setBonus(db, userId, wanted, now)).multiplierX10;
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', event: 'battery.bonus_sync_failed', message: error instanceof Error ? error.message : 'error' }));
    return wanted;
  }
}
