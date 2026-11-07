/**
 * Battery icon standard (owner decision 2026-11-08): whenever a battery is mentioned anywhere in the Starry
 * ecosystem (web pages, Apps, emails, notices), show the matching icon in front of it:
 *   normal battery  -> 🔋  (普通電池)
 *   quantum battery -> ⚛️  (量子電池)
 * Format: "<icon> <number> 顆普通電池" / "<icon> <number> 顆量子電池"; in a compact counter: "<icon> <number>".
 */
export const BATTERY_ICON = { normal: '🔋', quantum: '⚛️' } as const;
export type BatteryKind = keyof typeof BATTERY_ICON;
export const BATTERY_NAME: Record<BatteryKind, string> = { normal: '普通電池', quantum: '量子電池' };

export const batteryAmount = (kind: BatteryKind, n: number): string => `${BATTERY_ICON[kind]} ${n} 顆${BATTERY_NAME[kind]}`;

/** What changing a referrer costs after the first binding. */
export const REFERRER_CHANGE_COST = { normal: 1000, quantum: 10 } as const;
export const referrerChangeCostText = (): string => `${batteryAmount('normal', REFERRER_CHANGE_COST.normal)}或 ${batteryAmount('quantum', REFERRER_CHANGE_COST.quantum)}`;
