/**
 * Member numbers "<calling code>-<7 digits>" (owner decision 2026-11-07). The calling code comes from the
 * country the sign-up request came from (Cloudflare's IP country, no App permission needed); the 7 digits are
 * random. The number is unique, permanent, and kept forever in retired_member_numbers after the member is deleted.
 * It is for R2 folder names and customer support; the internal member ID (UUIDv7) stays the primary key.
 */
export const DEFAULT_CALLING_CODE = '886';

// ISO 3166-1 alpha-2 -> international calling code (country code only; shared codes such as +1 are fine for an identifier).
const CALLING_CODES: Readonly<Record<string, string>> = {
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

/** Calling code for an ISO country; anything unknown (VPN exit in a special zone, no header) falls back to 886. */
export function callingCodeFor(country: string | null | undefined): string {
  const code = (country ?? '').trim().toUpperCase();
  return CALLING_CODES[code] ?? DEFAULT_CALLING_CODE;
}

export function normalizeCountry(country: string | null | undefined): string | null {
  const code = (country ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code in CALLING_CODES ? code : null;
}

export const MEMBER_NO = /^\d{1,4}-\d{7}$/;

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

/**
 * Gives the member a number if it has none. Retries on a collision with another member or a retired number.
 * Never throws: a member without a number is picked up again by assignMissingMemberNumbers.
 */
export async function issueMemberNumber(db: D1Database, userId: string, country: string | null | undefined, now: number): Promise<string | null> {
  const iso = normalizeCountry(country);
  const prefix = callingCodeFor(iso);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${prefix}-${randomSevenDigits()}`;
    try {
      const result = await db
        .prepare(
          `UPDATE users SET member_no = ?, registration_country = COALESCE(registration_country, ?), updated_at = ?
           WHERE user_id = ? AND member_no IS NULL AND NOT EXISTS (SELECT 1 FROM retired_member_numbers WHERE member_no = ?)`,
        )
        .bind(candidate, iso, now, userId, candidate)
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

/** Maintenance: members created before numbers existed (or whose draw failed) get one. Bounded per run. */
export async function assignMissingMemberNumbers(db: D1Database, now: number, limit = 200): Promise<number> {
  const rows = await db.prepare('SELECT user_id, registration_country FROM users WHERE member_no IS NULL ORDER BY created_at LIMIT ?').bind(limit).all<{ user_id: string; registration_country: string | null }>();
  let assigned = 0;
  for (const row of rows.results) if (await issueMemberNumber(db, row.user_id, row.registration_country, now)) assigned++;
  return assigned;
}
