import { auditStatement } from '../lib/audit';

/**
 * Member numbers "<ISO country><7 digits>", e.g. TW0112342 (owner decision 2026-11-08, replaces the calling-code
 * form). The country comes from the sign-up request (Cloudflare's IP country, no App permission needed); the 7
 * digits are random. The full number is unique among living members; when a member is deleted the number is
 * released and may be issued again. Members can change both parts themselves. It is a display / support / URL
 * handle only: the internal member ID (UUIDv7) is the primary key and names every R2 object.
 */
export const DEFAULT_COUNTRY = 'TW';

// ISO 3166-1 alpha-2 -> international calling code (country code only; shared codes such as +1 are fine for an identifier).
export const CALLING_CODES: Readonly<Record<string, string>> = {
  AD: '376', AE: '971', AF: '93', AG: '1', AI: '1', AL: '355', AM: '374', AO: '244', AR: '54', AS: '1', AT: '43', AU: '61', AW: '297', AZ: '994',
  BA: '387', BB: '1', BD: '880', BE: '32', BF: '226', BG: '359', BH: '973', BI: '257', BJ: '229', BM: '1', BN: '673', BO: '591', BR: '55', BS: '1', BT: '975', BW: '267', BY: '375', BZ: '501',
  CA: '1', CD: '243', CF: '236', CG: '242', CH: '41', CI: '225', CK: '682', CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238', CW: '599', CY: '357', CZ: '420',
  DE: '49', DJ: '253', DK: '45', DM: '1', DO: '1', DZ: '213', EC: '593', EE: '372', EG: '20', ER: '291', ES: '34', ET: '251', FI: '358', FJ: '679', FK: '500', FM: '691', FO: '298', FR: '33',
  GA: '241', GB: '44', GD: '1', GE: '995', GF: '594', GG: '44', GH: '233', GI: '350', GL: '299', GM: '220', GN: '224', GP: '590', GQ: '240', GR: '30', GT: '502', GU: '1', GW: '245', GY: '592',
  HK: '852', HN: '504', HR: '385', HT: '509', HU: '36', ID: '62', IE: '353', IL: '972', IM: '44', IN: '91', IQ: '964', IR: '98', IS: '354', IT: '39', JE: '44', JM: '1', JO: '962', JP: '81',
  KE: '254', KG: '996', KH: '855', KI: '686', KM: '269', KN: '1', KP: '850', KR: '82', KW: '965', KY: '1', KZ: '7', LA: '856', LB: '961', LC: '1', LI: '423', LK: '94', LR: '231', LS: '266', LT: '370', LU: '352', LV: '371', LY: '218',
  MA: '212', MC: '377', MD: '373', ME: '382', MG: '261', MH: '692', MK: '389', ML: '223', MM: '95', MN: '976', MO: '853', MP: '1', MQ: '596', MR: '222', MS: '1', MT: '356', MU: '230', MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258',
  NA: '264', NC: '687', NE: '227', NG: '234', NI: '505', NL: '31', NO: '47', NP: '977', NR: '674', NU: '683', NZ: '64', OM: '968', PA: '507', PE: '51', PF: '689', PG: '675', PH: '63', PK: '92', PL: '48', PM: '508', PR: '1', PS: '970', PT: '351', PW: '680', PY: '595',
  QA: '974', RE: '262', RO: '40', RS: '381', RU: '7', RW: '250', SA: '966', SB: '677', SC: '248', SD: '249', SE: '46', SG: '65', SI: '386', SK: '421', SL: '232', SM: '378', SN: '221', SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SX: '1', SY: '963', SZ: '268',
  TC: '1', TD: '235', TG: '228', TH: '66', TJ: '992', TL: '670', TM: '993', TN: '216', TO: '676', TR: '90', TT: '1', TV: '688', TW: '886', TZ: '255', UA: '380', UG: '256', US: '1', UY: '598', UZ: '998',
  VA: '39', VC: '1', VE: '58', VG: '1', VI: '1', VN: '84', VU: '678', WF: '681', WS: '685', XK: '383', YE: '967', YT: '262', ZA: '27', ZM: '260', ZW: '263',
};

export function normalizeCountry(country: string | null | undefined): string | null {
  const code = (country ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code in CALLING_CODES ? code : null;
}

export const MEMBER_NO = /^[A-Z]{2}\d{7}$/;

/** Seven uniformly random digits (rejection sampling, no modulo bias). */
export function randomSevenDigits(): string {
  const limit = 4_290_000_000; // the largest multiple of 10^7 that fits in 32 bits
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? limit;
    if (value < limit) return String(value % 10_000_000).padStart(7, '0');
  }
}

/** Calling code of an ISO country, or null when unknown. */
export function callingCodeOf(iso: string): string | null {
  return CALLING_CODES[iso] ?? null;
}

/** Normalizes user input ("tw0112342", " TW 0112342 ") to the canonical form, or null when it is not a member number. */
export function normalizeMemberNo(input: string): string | null {
  const value = input.replace(/[\s-]/g, '').toUpperCase();
  return MEMBER_NO.test(value) && value.slice(0, 2) in CALLING_CODES ? value : null;
}

/** Countries near Taiwan first (Taiwan, then East / Southeast / South Asia, Oceania), then the rest by calling code. */
const NEARBY = [
  'TW', 'HK', 'MO', 'CN', 'JP', 'KR', 'KP', 'MN', 'PH', 'VN', 'TH', 'SG', 'MY', 'ID', 'KH', 'LA', 'MM', 'BN', 'TL',
  'IN', 'BD', 'LK', 'NP', 'BT', 'PK', 'MV', 'AU', 'NZ', 'GU', 'MP', 'PG', 'FJ', 'PW', 'FM', 'MH',
];

export interface CountryOption {
  iso: string;
  callingCode: string;
}

/** All selectable countries in picker order. */
export function countryOptions(): CountryOption[] {
  const rank = new Map(NEARBY.map((iso, index) => [iso, index]));
  return Object.entries(CALLING_CODES)
    .map(([iso, callingCode]) => ({ iso, callingCode }))
    .sort((x, y) => {
      const rx = rank.get(x.iso);
      const ry = rank.get(y.iso);
      if (rx !== undefined || ry !== undefined) return (rx ?? 1e6) - (ry ?? 1e6);
      return Number(x.callingCode) - Number(y.callingCode) || x.iso.localeCompare(y.iso);
    });
}

/**
 * Gives the member a number if it has none. Retries on a collision with another living member.
 * Never throws: a member without a number is picked up again by assignMissingMemberNumbers.
 */
export async function issueMemberNumber(db: D1Database, userId: string, country: string | null | undefined, now: number): Promise<string | null> {
  const iso = normalizeCountry(country);
  const prefix = iso ?? DEFAULT_COUNTRY;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${prefix}${randomSevenDigits()}`;
    try {
      const result = await db
        .prepare('UPDATE users SET member_no = ?, registration_country = COALESCE(registration_country, ?), updated_at = ? WHERE user_id = ? AND member_no IS NULL')
        .bind(candidate, iso, now, userId)
        .run();
      if (result.meta.changes === 1) return candidate;
      const existing = await db.prepare('SELECT member_no FROM users WHERE user_id = ?').bind(userId).first<{ member_no: string | null }>();
      if (existing?.member_no) return existing.member_no;
    } catch {
      // unique index collision with another member: draw again
    }
  }
  return null;
}

export async function isMemberNoFree(db: D1Database, memberNo: string, exceptUserId: string): Promise<boolean> {
  const row = await db.prepare('SELECT user_id FROM users WHERE member_no = ?').bind(memberNo).first<{ user_id: string }>();
  return !row || row.user_id === exceptUserId;
}

/** Changes per member per 24 hours (self-service); admins are not limited. */
export const MEMBER_NO_CHANGES_PER_DAY = 3;

export type ChangeMemberNoResult =
  | { ok: true; memberNo: string; previous: string | null; unchanged: boolean }
  | { ok: false; reason: 'invalid' | 'taken' | 'rate_limited' | 'not_found' };

/**
 * Sets a member's number. Uniqueness is enforced by the unique index, so two racing changes cannot both win.
 * The org network and every other table are keyed by the internal member ID, so nothing else needs to move.
 */
export async function changeMemberNo(
  db: D1Database,
  input: { userId: string; requested: string; byAdminId?: string; requestId: string | null; appId?: string | null },
  now: number,
): Promise<ChangeMemberNoResult> {
  const next = normalizeMemberNo(input.requested);
  if (!next) return { ok: false, reason: 'invalid' };
  const current = await db.prepare('SELECT member_no FROM users WHERE user_id = ?').bind(input.userId).first<{ member_no: string | null }>();
  if (!current) return { ok: false, reason: 'not_found' };
  if (current.member_no === next) return { ok: true, memberNo: next, previous: current.member_no, unchanged: true };
  if (!input.byAdminId) {
    const recent = await db
      .prepare('SELECT COUNT(*) AS n FROM member_no_changes WHERE user_id = ? AND changed_at > ?')
      .bind(input.userId, now - 24 * 3600 * 1000)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= MEMBER_NO_CHANGES_PER_DAY) return { ok: false, reason: 'rate_limited' };
  }
  if (!(await isMemberNoFree(db, next, input.userId))) return { ok: false, reason: 'taken' };
  try {
    await db.batch([
      db
        .prepare('UPDATE users SET member_no = ?, registration_country = COALESCE(registration_country, ?), updated_at = ? WHERE user_id = ?')
        .bind(next, next.slice(0, 2), now, input.userId),
      db.prepare('INSERT INTO member_no_changes (user_id, old_no, new_no, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)').bind(input.userId, current.member_no, next, now, input.byAdminId ?? null),
      auditStatement(
        db,
        {
          actorType: input.byAdminId ? 'admin' : 'user',
          actorUserId: input.byAdminId ?? input.userId,
          action: 'member.no_changed',
          targetType: 'user',
          targetId: input.userId,
          appId: input.appId ?? null,
          result: 'success',
          requestId: input.requestId,
          retention: 'general',
        },
        now,
      ),
    ]);
  } catch {
    return { ok: false, reason: 'taken' };
  }
  return { ok: true, memberNo: next, previous: current.member_no, unchanged: false };
}

/** Maintenance: members created before numbers existed (or whose draw failed) get one. Bounded per run. */
export async function assignMissingMemberNumbers(db: D1Database, now: number, limit = 200): Promise<number> {
  const rows = await db.prepare('SELECT user_id, registration_country FROM users WHERE member_no IS NULL ORDER BY created_at LIMIT ?').bind(limit).all<{ user_id: string; registration_country: string | null }>();
  let assigned = 0;
  for (const row of rows.results) if (await issueMemberNumber(db, row.user_id, row.registration_country, now)) assigned++;
  return assigned;
}
