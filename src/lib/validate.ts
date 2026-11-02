import type { Context } from 'hono';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a JSON object body; anything else (invalid JSON, arrays, primitives) yields null. */
export async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await c.req.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function boundedString(value: unknown, max: number, min = 1): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max && !hasControlCharacter(value);
}

/** Calendar-valid YYYY-MM-DD between 1900-01-01 and today. */
export function isBirthday(value: unknown, now: number): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) && value >= '1900-01-01' && date.getTime() <= now;
}

export function isLocale(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{2}(-[A-Z][A-Za-z]{1,3})?$/.test(value);
}
