import { initialsOf } from './initials';
import { auditStatement } from '../lib/audit';
import { boundedString, isBirthday, isLocale } from '../lib/validate';
import { isEmailAddress } from '../notify/email';

/**
 * Member profile (spec S-ID-08, restored to the original checklist 02.01-02.10 at the owner's
 * request on 2026-11-03): name, avatar, main contact email, phone, country / state / city,
 * birthday with its derived zodiac and numerology, motto, locale; per-field visibility and
 * per-field "last changed". One profile serves every Starry App.
 */

export const EDITABLE_FIELDS = [
  'display_name', 'nickname', 'birthday', 'locale', 'contact_email', 'phone', 'country', 'region', 'city', 'motto',
  'occupation', 'organization', 'website', 'bio', 'languages', 'interests', 'skills',
  'university', 'university_dept', 'grad_school', 'grad_dept',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Groups a member can show or hide (02.09). derived = zodiac and life path number; location = country, region, city. */
export const VISIBILITY_FIELDS = [
  'display_name', 'avatar', 'birthday', 'derived', 'location', 'phone', 'motto', 'contact_email',
  'occupation', 'website', 'bio', 'languages', 'interests', 'skills', 'education',
] as const;
export type VisibilityField = (typeof VISIBILITY_FIELDS)[number];
export type Visibility = 'public' | 'private';

/** Private by default except the name, avatar and motto; a new phone number is hidden (02.09). */
export const DEFAULT_VISIBILITY: Readonly<Record<VisibilityField, Visibility>> = {
  display_name: 'public',
  avatar: 'public',
  birthday: 'private',
  derived: 'private',
  location: 'private',
  phone: 'private',
  motto: 'public',
  contact_email: 'private',
  occupation: 'private',
  website: 'private',
  bio: 'private',
  languages: 'private',
  interests: 'private',
  skills: 'private',
  education: 'private',
};

export interface ProfileRow {
  display_name: string | null;
  avatar_key: string | null;
  birthday: string | null;
  locale: string;
  contact_email: string | null;
  contact_email_verified_at: number | null;
  phone: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  motto: string | null;
  nickname: string | null;
  occupation: string | null;
  organization: string | null;
  website: string | null;
  bio: string | null;
  languages: string | null;
  interests: string | null;
  skills: string | null;
  university: string | null;
  university_dept: string | null;
  grad_school: string | null;
  grad_dept: string | null;
  visibility: string;
  /** Which of nickname / display_name is the member's chosen primary display name. */
  primary_name: PrimaryName;
  version: number;
  updated_at: number;
}

export type PrimaryName = 'nickname' | 'display_name';
export const isPrimaryName = (v: unknown): v is PrimaryName => v === 'nickname' || v === 'display_name';

export const PROFILE_SQL =
  'SELECT display_name, avatar_key, birthday, locale, contact_email, contact_email_verified_at, phone, country, region, city, motto, nickname, occupation, organization, website, bio, languages, interests, skills, university, university_dept, grad_school, grad_dept, visibility, primary_name, version, updated_at FROM profiles WHERE user_id = ?';

export interface FieldUpdate {
  updated_at: number;
  source: 'member' | 'staff';
}

export async function loadProfile(db: D1Database, userId: string): Promise<{ row: ProfileRow; fieldUpdates: Record<string, FieldUpdate> } | null> {
  const [profile, updates] = await db.batch([
    db.prepare(PROFILE_SQL).bind(userId),
    db.prepare('SELECT field, updated_at, source FROM profile_field_updates WHERE user_id = ?').bind(userId),
  ]);
  const row = profile?.results[0] as ProfileRow | undefined;
  if (!row) return null;
  const fieldUpdates: Record<string, FieldUpdate> = {};
  for (const u of (updates?.results ?? []) as { field: string; updated_at: number; source: 'member' | 'staff' }[]) fieldUpdates[u.field] = { updated_at: u.updated_at, source: u.source };
  return { row, fieldUpdates };
}

// ---- Validation ----

const CALLING_CODES: Readonly<Record<string, string>> = {
  TW: '886', HK: '852', MO: '853', CN: '86', JP: '81', KR: '82', SG: '65', MY: '60', TH: '66', VN: '84', PH: '63', ID: '62',
  US: '1', CA: '1', GB: '44', AU: '61', NZ: '64', DE: '49', FR: '33',
};

/**
 * 02.02: phone numbers are stored in E.164. "+8869…" and "00886 9…" are kept as international;
 * a local number such as "0912 345 678" takes the calling code of the member's country (Taiwan
 * when none is set). Null when the result is not a plausible E.164 number.
 */
export function normalizePhone(value: string, country: string | null): string | null {
  const compact = value.replace(/[\s\-().]/g, '');
  let e164: string;
  if (compact.startsWith('+')) e164 = compact;
  else if (compact.startsWith('00')) e164 = `+${compact.slice(2)}`;
  else {
    const code = CALLING_CODES[country ?? 'TW'];
    if (!code) return null;
    e164 = `+${code}${compact.replace(/^0/, '')}`;
  }
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

export interface ProfileChanges {
  fields: Partial<Record<EditableField, string | null>>;
  visibility: Partial<Record<VisibilityField, Visibility>>;
}

const FIELD_ERRORS: Record<EditableField | 'visibility', string> = {
  display_name: '姓名須為 1～50 字',
  birthday: '生日須為有效日期（YYYY-MM-DD）',
  locale: '語系格式不正確',
  contact_email: '聯絡 Email 格式不正確',
  phone: '手機號碼格式不正確（例如 0912345678 或 +886912345678）',
  country: '國家須為兩碼代碼（例如 TW）',
  region: '省／州／縣市最多 60 字',
  city: '城市最多 60 字',
  motto: '座右銘最多 200 字',
  nickname: '暱稱最多 30 字',
  occupation: '職業最多 60 字',
  organization: '服務單位最多 80 字',
  website: '個人網站須為 https:// 開頭的網址（最多 200 字）',
  bio: '自我介紹最多 500 字',
  languages: '使用語言最多 100 字',
  interests: '興趣最多 200 字',
  skills: '專長最多 200 字',
  university: '大學校名最多 80 字',
  university_dept: '大學科系最多 60 字',
  grad_school: '研究所校名最多 80 字',
  grad_dept: '研究所科系最多 60 字',
  visibility: '公開設定不正確（頭像一律公開，無法隱藏）',
};

export type ValidationResult = { ok: true; changes: ProfileChanges } | { ok: false; field: EditableField | 'visibility'; message: string };

function optionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: true, value: null };
  return boundedString(trimmed, max) ? { ok: true, value: trimmed } : { ok: false };
}

/**
 * Checks the fields present in `input` (absent fields are left alone). Empty text clears an
 * optional field; the name may be cleared with null but not with an empty string.
 */
export function validateProfileInput(input: Record<string, unknown>, now: number, currentCountry: string | null): ValidationResult {
  const fields: ProfileChanges['fields'] = {};
  const fail = (field: EditableField | 'visibility'): ValidationResult => ({ ok: false, field, message: FIELD_ERRORS[field] });
  if ('display_name' in input) {
    const v = input.display_name;
    if (v === null) fields.display_name = null;
    else if (typeof v === 'string' && boundedString(v.trim(), 50)) fields.display_name = v.trim();
    else return fail('display_name');
  }
  if ('birthday' in input) {
    const v = input.birthday;
    if (v === null || v === '') fields.birthday = null;
    else if (isBirthday(v, now)) fields.birthday = v;
    else return fail('birthday');
  }
  if ('locale' in input) {
    if (!isLocale(input.locale)) return fail('locale');
    fields.locale = input.locale;
  }
  if ('country' in input) {
    const v = optionalText(input.country, 2);
    if (!v.ok || (v.value !== null && !/^[A-Za-z]{2}$/.test(v.value))) return fail('country');
    fields.country = v.value?.toUpperCase() ?? null;
  }
  for (const [field, max] of [
    ['region', 60], ['city', 60], ['motto', 200], ['nickname', 30], ['occupation', 60], ['organization', 80], ['bio', 500], ['languages', 100],
    ['interests', 200], ['skills', 200], ['university', 80], ['university_dept', 60], ['grad_school', 80], ['grad_dept', 60],
  ] as const) {
    if (!(field in input)) continue;
    const v = optionalText(input[field], max);
    if (!v.ok) return fail(field);
    fields[field] = v.value;
  }
  if ('website' in input) {
    const v = optionalText(input.website, 200);
    if (!v.ok) return fail('website');
    if (v.value === null) fields.website = null;
    else {
      let url: URL | null;
      try {
        url = new URL(v.value);
      } catch {
        url = null;
      }
      if (!url || url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !url.hostname.includes('.')) return fail('website');
      fields.website = url.toString();
    }
  }
  if ('contact_email' in input) {
    const v = optionalText(input.contact_email, 254);
    if (!v.ok) return fail('contact_email');
    const email = v.value?.toLowerCase() ?? null;
    if (email !== null && !isEmailAddress(email)) return fail('contact_email');
    fields.contact_email = email;
  }
  if ('phone' in input) {
    const v = optionalText(input.phone, 30);
    if (!v.ok) return fail('phone');
    if (v.value === null) fields.phone = null;
    else {
      const e164 = normalizePhone(v.value, fields.country ?? currentCountry);
      if (!e164) return fail('phone');
      fields.phone = e164;
    }
  }
  const visibility: ProfileChanges['visibility'] = {};
  if ('visibility' in input) {
    const v = input.visibility;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail('visibility');
    for (const [key, value] of Object.entries(v)) {
      if (!(VISIBILITY_FIELDS as readonly string[]).includes(key) || (value !== 'public' && value !== 'private')) return fail('visibility');
      if (key === 'avatar' && value === 'private') return fail('visibility');
      visibility[key as VisibilityField] = value;
    }
  }
  return { ok: true, changes: { fields, visibility } };
}

export function hasChanges(changes: ProfileChanges): boolean {
  return Object.keys(changes.fields).length > 0 || Object.keys(changes.visibility).length > 0;
}

// ---- Derived information (02.04) ----

const ZODIAC: readonly { key: string; name: string; from: string }[] = [
  { key: 'capricorn', name: '摩羯座', from: '01-01' },
  { key: 'aquarius', name: '水瓶座', from: '01-20' },
  { key: 'pisces', name: '雙魚座', from: '02-19' },
  { key: 'aries', name: '牡羊座', from: '03-21' },
  { key: 'taurus', name: '金牛座', from: '04-20' },
  { key: 'gemini', name: '雙子座', from: '05-21' },
  { key: 'cancer', name: '巨蟹座', from: '06-22' },
  { key: 'leo', name: '獅子座', from: '07-23' },
  { key: 'virgo', name: '處女座', from: '08-23' },
  { key: 'libra', name: '天秤座', from: '09-23' },
  { key: 'scorpio', name: '天蠍座', from: '10-24' },
  { key: 'sagittarius', name: '射手座', from: '11-23' },
  { key: 'capricorn', name: '摩羯座', from: '12-22' },
];

export function zodiacOf(birthday: string): { key: string; name: string } {
  const monthDay = birthday.slice(5);
  let sign = ZODIAC[0] as (typeof ZODIAC)[number];
  for (const z of ZODIAC) if (monthDay >= z.from) sign = z;
  return { key: sign.key, name: sign.name };
}

const digitSum = (n: number) => String(n).split('').reduce((sum, d) => sum + Number(d), 0);

/** The 3×3 grid as usually drawn (bottom-left 1, top-right 9) and its eight lines. */
export const GRID_LAYOUT: readonly (readonly number[])[] = [
  [3, 6, 9],
  [2, 5, 8],
  [1, 4, 7],
];
const LINES: readonly (readonly [number, number, number])[] = [
  [1, 2, 3], [4, 5, 6], [7, 8, 9], [1, 4, 7], [2, 5, 8], [3, 6, 9], [1, 5, 9], [3, 5, 7],
];

export interface Numerology {
  /** Sums of the birth date digits before the final single digit, e.g. 1990-02-28 → [31]. */
  talent_numbers: number[];
  /** The final single digit, e.g. 1990-02-28 → 4. */
  life_path_number: number;
  /** How often 1-9 appear in the birth date, the talent numbers and the life path number (zeros ignored). */
  grid: { number: number; count: number }[];
  /** Complete lines of the grid, e.g. "1-5-9". */
  lines: string[];
}

/** Taiwan-style life path numerology: add every digit of YYYYMMDD, keep reducing to one digit. */
export function numerologyOf(birthday: string): Numerology {
  const digits = birthday.replace(/-/g, '').split('').map(Number);
  let sum = digits.reduce((a, b) => a + b, 0);
  const talent: number[] = [];
  while (sum >= 10) {
    talent.push(sum);
    sum = digitSum(sum);
  }
  const counts = new Map<number, number>();
  for (const d of [...digits, ...talent.flatMap((t) => String(t).split('').map(Number)), sum]) {
    if (d >= 1) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return {
    talent_numbers: talent,
    life_path_number: sum,
    grid: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ number: n, count: counts.get(n) ?? 0 })),
    lines: LINES.filter((line) => line.every((n) => (counts.get(n) ?? 0) > 0)).map((line) => line.join('-')),
  };
}

export interface Derived extends Numerology {
  zodiac: string;
  zodiac_name: string;
}

export function derivedOf(birthday: string | null): Derived | null {
  if (!birthday) return null;
  const z = zodiacOf(birthday);
  return { zodiac: z.key, zodiac_name: z.name, ...numerologyOf(birthday) };
}

export function ageOn(birthday: string, now: number): number {
  const today = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const years = Number(today.slice(0, 4)) - Number(birthday.slice(0, 4));
  return today.slice(5) >= birthday.slice(5) ? years : years - 1;
}

// ---- Visibility (02.09) ----

export function storedVisibility(json: string): Partial<Record<VisibilityField, Visibility>> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Partial<Record<VisibilityField, Visibility>> = {};
    for (const field of VISIBILITY_FIELDS) {
      const v = (parsed as Record<string, unknown>)[field];
      if (v === 'public' || v === 'private') out[field] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Minors' birthday and derived information are never public, whatever the setting (02.04). */
export function effectiveVisibility(row: Pick<ProfileRow, 'visibility' | 'birthday'>, now: number): Record<VisibilityField, Visibility> {
  const v = { ...DEFAULT_VISIBILITY, ...storedVisibility(row.visibility), avatar: 'public' as Visibility };
  if (row.birthday && ageOn(row.birthday, now) < 18) {
    v.birthday = 'private';
    v.derived = 'private';
  }
  return v;
}

/**
 * The name every Starry App shows: the member's chosen primary name (nickname or real name, default nickname).
 * If the chosen one is empty the other is used, so a member is never shown without a name when one exists.
 * Callers that show this to other people pass a real name only when it is public.
 */
export function shownName(nickname: string | null | undefined, displayName: string | null | undefined, primary: PrimaryName = 'nickname'): string | null {
  const nick = nickname?.trim() || null;
  const name = displayName?.trim() || null;
  return (primary === 'display_name' ? (name ?? nick) : (nick ?? name)) || null;
}

export interface PublicProfile {
  shown_name: string | null;
  display_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  initials: string;
  birthday_month_day: string | null;
  zodiac_name: string | null;
  life_path_number: number | null;
  location: { country: string | null; region: string | null; city: string | null } | null;
  phone: string | null;
  motto: string | null;
  contact_email: string | null;
  occupation: string | null;
  organization: string | null;
  website: string | null;
  bio: string | null;
  languages: string | null;
  interests: string | null;
  skills: string | null;
  education: { university: string | null; university_dept: string | null; grad_school: string | null; grad_dept: string | null } | null;
}

/**
 * What other members may see. A public birthday shows month and day only; public derived
 * information is the zodiac and life path number only (the talent numbers and grid would
 * reveal the birth year). An unverified contact email is never shown.
 */
export function publicProfile(row: ProfileRow, avatarUrl: string | null, now: number): PublicProfile {
  const v = effectiveVisibility(row, now);
  const derived = v.derived === 'public' ? derivedOf(row.birthday) : null;
  const hasLocation = row.country !== null || row.region !== null || row.city !== null;
  const hasEducation = row.university !== null || row.university_dept !== null || row.grad_school !== null || row.grad_dept !== null;
  return {
    shown_name: shownName(row.nickname, v.display_name === 'public' ? row.display_name : null, row.primary_name),
    display_name: v.display_name === 'public' ? row.display_name : null,
    nickname: row.nickname,
    avatar_url: avatarUrl,
    initials: initialsOf(v.display_name === 'public' ? (row.display_name ?? row.nickname) : row.nickname),
    birthday_month_day: v.birthday === 'public' && row.birthday ? row.birthday.slice(5) : null,
    zodiac_name: derived?.zodiac_name ?? null,
    life_path_number: derived?.life_path_number ?? null,
    location: v.location === 'public' && hasLocation ? { country: row.country, region: row.region, city: row.city } : null,
    phone: v.phone === 'public' ? row.phone : null,
    motto: v.motto === 'public' ? row.motto : null,
    contact_email: v.contact_email === 'public' && row.contact_email_verified_at !== null ? row.contact_email : null,
    occupation: v.occupation === 'public' ? row.occupation : null,
    organization: v.occupation === 'public' ? row.organization : null,
    website: v.website === 'public' ? row.website : null,
    bio: v.bio === 'public' ? row.bio : null,
    languages: v.languages === 'public' ? row.languages : null,
    interests: v.interests === 'public' ? row.interests : null,
    skills: v.skills === 'public' ? row.skills : null,
    education: v.education === 'public' && hasEducation ? { university: row.university, university_dept: row.university_dept, grad_school: row.grad_school, grad_dept: row.grad_dept } : null,
  };
}

// ---- Saving ----

export interface SaveResult {
  written: boolean;
  /** The new contact email when this save changed it (it then needs verification). */
  newContactEmail: string | null;
}

/**
 * Optimistic save (02.08): written only if `expectedVersion` is current. Records when each
 * changed field was last changed (02.10); a changed contact email loses its verification.
 */
export async function saveProfile(
  db: D1Database,
  input: { userId: string; expectedVersion: number; changes: ProfileChanges; source: 'member' | 'staff'; actorUserId: string; appId: string | null; requestId: string | null },
  now: number,
): Promise<SaveResult> {
  const before = await db.prepare(PROFILE_SQL).bind(input.userId).first<ProfileRow>();
  if (!before || !hasChanges(input.changes)) return { written: false, newContactEmail: null };
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const changed: string[] = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input.changes.fields)) continue;
    const value = input.changes.fields[field] ?? null;
    if (field === 'locale' && value === null) continue;
    sets.push(`${field} = ?`);
    values.push(value);
    if (field === 'contact_email') {
      sets.push('contact_email_verified_at = CASE WHEN contact_email IS ? THEN contact_email_verified_at ELSE NULL END');
      values.push(value);
    }
    if (before[field] !== value) changed.push(field);
  }
  const visibility = input.changes.visibility;
  if (Object.keys(visibility).length > 0) {
    sets.push('visibility = json_patch(visibility, ?)');
    values.push(JSON.stringify(visibility));
    const current = storedVisibility(before.visibility);
    if (Object.entries(visibility).some(([k, v]) => (current[k as VisibilityField] ?? DEFAULT_VISIBILITY[k as VisibilityField]) !== v)) changed.push('visibility');
  }
  const update = await db
    .prepare(`UPDATE profiles SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?`)
    .bind(...values, now, input.userId, input.expectedVersion)
    .run();
  const written = update.meta.changes === 1;
  const audit = auditStatement(
    db,
    {
      actorType: input.source === 'staff' ? 'admin' : 'user',
      actorUserId: input.actorUserId,
      action: input.source === 'staff' ? 'admin.profile_update' : 'profile.update',
      targetType: 'user',
      targetId: input.userId,
      appId: input.appId,
      result: written ? 'success' : 'denied',
      requestId: input.requestId,
      retention: input.source === 'staff' ? 'security' : 'general',
    },
    now,
  );
  if (!written) {
    await audit.run();
    return { written, newContactEmail: null };
  }
  await db.batch([
    ...changed.map((field) =>
      db
        .prepare(
          `INSERT INTO profile_field_updates (user_id, field, updated_at, source) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, field) DO UPDATE SET updated_at = excluded.updated_at, source = excluded.source`,
        )
        .bind(input.userId, field, now, input.source),
    ),
    audit,
  ]);
  const email = input.changes.fields.contact_email;
  return { written, newContactEmail: changed.includes('contact_email') && email ? email : null };
}

/** 02.10 for the avatar, which is saved by its own endpoint. */
export function avatarChangedStatement(db: D1Database, userId: string, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO profile_field_updates (user_id, field, updated_at, source) VALUES (?, 'avatar', ?, 'member')
       ON CONFLICT (user_id, field) DO UPDATE SET updated_at = excluded.updated_at, source = excluded.source`,
    )
    .bind(userId, now);
}

export type PrimaryNameResult = 'saved' | 'unchanged' | 'conflict' | 'missing_name';

/**
 * Chooses which of nickname / real name is the primary display name (exactly one). The chosen one must
 * exist. Choosing the real name also makes it public, because the primary name is what other members see.
 */
export async function setPrimaryName(
  db: D1Database,
  input: { userId: string; expectedVersion: number; choice: PrimaryName; actorUserId: string; appId: string | null; requestId: string | null },
  now: number,
): Promise<PrimaryNameResult> {
  const before = await db.prepare(PROFILE_SQL).bind(input.userId).first<ProfileRow>();
  if (!before) return 'conflict';
  const chosen = (input.choice === 'nickname' ? before.nickname : before.display_name)?.trim();
  if (!chosen) return 'missing_name';
  if (before.version !== input.expectedVersion) return 'conflict';
  const makePublic = input.choice === 'display_name' && storedVisibility(before.visibility).display_name !== 'public';
  if (before.primary_name === input.choice && !makePublic) return 'unchanged';
  const update = await db
    .prepare(
      `UPDATE profiles SET primary_name = ?, visibility = json_patch(visibility, ?), version = version + 1, updated_at = ?
       WHERE user_id = ? AND version = ?`,
    )
    .bind(input.choice, JSON.stringify(makePublic ? { display_name: 'public' } : {}), now, input.userId, input.expectedVersion)
    .run();
  const written = update.meta.changes === 1;
  const audit = auditStatement(
    db,
    { actorType: 'user', actorUserId: input.actorUserId, action: 'profile.primary_name', targetType: 'user', targetId: input.userId, appId: input.appId, result: written ? 'success' : 'denied', requestId: input.requestId, retention: 'general' },
    now,
  );
  if (!written) {
    await audit.run();
    return 'conflict';
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO profile_field_updates (user_id, field, updated_at, source) VALUES (?, 'primary_name', ?, 'member')
         ON CONFLICT (user_id, field) DO UPDATE SET updated_at = excluded.updated_at, source = excluded.source`,
      )
      .bind(input.userId, now),
    audit,
  ]);
  return 'saved';
}
