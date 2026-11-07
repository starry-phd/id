// Battery bonus multiplier: every public bonus field adds 0.1x to the free Battery a member earns, applied at once everywhere.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { adjustAllowance, bonusOf, forgetBatteryMembers, getBalance, getBalances, reserve, scaled, setBonus, setPolicy, staffLedger } from '../../src/battery/battery';
import { syncBonus } from '../../src/battery/bonus';
import { createBatch, redeemInvite } from '../../src/battery/invites';
import { BONUS_FIELDS, bonusX10, formatBonus, groupContent, noBonusNote, NO_BONUS_EMPTY, NO_BONUS_UNVERIFIED, VISIBILITY_FIELDS, type BonusRow } from '../../src/identity/profile';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 15, 4, 0, 0);
const A = '01900000-0000-7000-8000-000000000001';
const B = '01900000-0000-7000-8000-000000000002';
const STAFF = '01900000-0000-7000-8000-0000000000aa';
const setup = () => migratedDb('migrations/battery') as unknown as D1Database;
const vis = (fields: string[]) => JSON.stringify(Object.fromEntries(fields.map((f) => [f, 'public'])));
const BLANK: BonusRow = {
  visibility: '{}', birthday: null, country: null, region: null, city: null, phone: null, contact_email: null, contact_email_verified_at: null, occupation: null, organization: null,
  website: null, bio: null, languages: null, interests: null, skills: null, university: null, university_dept: null, grad_school: null, grad_dept: null,
};
/** A profile where every bonus field has content, so only the public switches decide. */
const FULL: BonusRow = {
  ...BLANK, birthday: '1990-01-01', country: 'TW', phone: '+886912345678', contact_email: 'a@example.com', contact_email_verified_at: 1, occupation: '工程師', website: 'https://example.com',
  bio: '你好', languages: '中文', interests: '閱讀', skills: '寫程式', university: '某大學',
};
const row = (base: BonusRow, fields: string[]): BonusRow => ({ ...base, visibility: vis(fields) });

describe('multiplier from the profile', () => {
  test('1.0x by default, +0.1x per public bonus field that has content, 2.0x at ten; name/motto/avatar do not count', () => {
    assert.equal(bonusX10(BLANK, NOW), 10, 'default state is 1.0x');
    assert.equal(formatBonus(10), '1.0');
    assert.equal(BONUS_FIELDS.length, 12);
    assert.ok(!BONUS_FIELDS.includes('display_name') && !BONUS_FIELDS.includes('motto') && !BONUS_FIELDS.includes('avatar' as never));
    assert.equal(bonusX10(row(FULL, ['phone']), NOW), 11);
    assert.equal(bonusX10(row(FULL, BONUS_FIELDS.slice(0, 10) as string[]), NOW), 20, 'ten fields = +1.0x');
    assert.equal(bonusX10(row(FULL, [...VISIBILITY_FIELDS]), NOW), 22, 'everything public and filled');
    assert.equal(bonusX10({ ...FULL, visibility: JSON.stringify({ display_name: 'private', motto: 'private' }) }, NOW), 10, 'hiding name or motto never goes below 1.0x');
  });

  test('a public field with nothing in it earns nothing; filling it in earns the bonus', () => {
    assert.equal(bonusX10(row(BLANK, [...VISIBILITY_FIELDS]), NOW), 10, 'everything public but empty: still 1.0x');
    assert.equal(bonusX10(row({ ...BLANK, phone: '   ' }, ['phone']), NOW), 10, 'blanks do not count');
    assert.equal(bonusX10(row(BLANK, ['phone']), NOW), 10);
    assert.equal(bonusX10(row({ ...BLANK, phone: '+886912345678' }, ['phone']), NOW), 11);
    assert.equal(bonusX10(row({ ...BLANK, birthday: '1990-01-01' }, ['birthday', 'derived']), NOW), 12, 'the derived info comes from the birthday');
    assert.equal(bonusX10(row({ ...BLANK, city: '台北' }, ['location']), NOW), 11, 'any of country / region / city fills the group');
    assert.equal(bonusX10(row({ ...BLANK, university_dept: '資工' }, ['education']), NOW), 11);
    assert.equal(bonusX10(row({ ...BLANK, organization: '某公司' }, ['occupation']), NOW), 11, 'the work group is filled by the employer too');
    assert.equal(bonusX10(row({ ...BLANK, contact_email: 'a@example.com' }, ['contact_email']), NOW), 10, 'an unconfirmed email is not shown to others');
    assert.equal(bonusX10(row({ ...BLANK, contact_email: 'a@example.com', contact_email_verified_at: 5 }, ['contact_email']), NOW), 11);
  });

  test('the notice names why a public field earns nothing', () => {
    assert.equal(noBonusNote('phone', BLANK), NO_BONUS_EMPTY);
    assert.equal(NO_BONUS_EMPTY, '空白內容不會顯示，無電池加成福利');
    assert.equal(noBonusNote('phone', FULL), null);
    assert.equal(noBonusNote('contact_email', { ...BLANK, contact_email: 'a@example.com' }), NO_BONUS_UNVERIFIED);
    assert.equal(noBonusNote('display_name', BLANK), null, 'name and motto are not bonus fields');
    assert.equal(groupContent('education', BLANK), 'empty');
  });

  test("a minor's birthday and derived information stay private, so they earn nothing", () => {
    const minor = { ...row(FULL, ['birthday', 'derived', 'bio']), birthday: '2015-01-01' };
    assert.equal(bonusX10(minor, NOW), 11);
    assert.equal(bonusX10({ ...minor, birthday: '1990-01-01' }, NOW), 13);
  });
});

describe('applied at once to what a member earns', () => {
  test('the monthly allowance moves immediately and back, never below what is used or held', async () => {
    const d = setup(); // default 10 a month
    assert.equal((await getBalance(d, A, NOW)).allowance, 10);
    assert.equal((await setBonus(d, A, 15, NOW)).changed, true);
    assert.equal((await getBalance(d, A, NOW)).allowance, 15 - 0, 'no account row yet: the balance already shows 1.5x');
    const r = await reserve(d, { userId: A, appId: 'recordnote', taskType: 'recordnote.transcribe', units: 8, idempotencyKey: 'bonus-key-0001' }, NOW);
    assert.ok(r.ok);
    assert.equal((await getBalance(d, A, NOW)).allowance, 15, 'a new account starts at the scaled amount');
    assert.equal((await setBonus(d, A, 20, NOW + 1)).changed, true);
    assert.equal((await getBalance(d, A, NOW + 1)).allowance, 20, 'raising it applies this month at once');
    assert.equal((await setBonus(d, A, 10, NOW + 2)).changed, true);
    const low = await getBalance(d, A, NOW + 2);
    assert.equal(low.allowance, 10);
    assert.ok(low.allowance >= low.used + low.reserved);
    assert.equal((await setBonus(d, A, 10, NOW + 3)).changed, false, 'same value is a no-op');
    assert.equal(await bonusOf(d, A), 10);
    assert.equal(((await d.prepare('SELECT COUNT(*) AS n FROM battery_bonus').first()) as { n: number }).n, 0, '1.0x stores nothing');
    const ledger = await staffLedger(d, A);
    assert.ok(ledger.some((e) => e.reason?.includes('公開欄位加碼')), 'changes are on the ledger');
  });

  test('a new month starts at the scaled allowance, and the Owner changing the policy keeps bonus members exact', async () => {
    const d = setup();
    await setBonus(d, A, 13, NOW);
    await adjustAllowance(d, { userId: A, delta: 1, reason: 'touch', actorUserId: STAFF }, NOW);
    await adjustAllowance(d, { userId: B, delta: 1, reason: 'touch', actorUserId: STAFF }, NOW);
    assert.equal((await getBalance(d, A, NOW)).allowance, 13 + 1);
    assert.equal((await getBalance(d, B, NOW)).allowance, 10 + 1);
    assert.equal(await setPolicy(d, { monthlyAllowance: 20, defaultTimeoutMs: 180_000, actorUserId: STAFF }, NOW), true);
    assert.equal((await getBalance(d, A, NOW)).allowance, scaled(20, 13) + 1, 'bonus member: 20 x 1.3 + the adjustment');
    assert.equal((await getBalance(d, B, NOW)).allowance, 20 + 1);
    const next = Date.UTC(2026, 11, 3, 4, 0, 0);
    assert.equal((await getBalance(d, A, next)).allowance, scaled(20, 13), 'next month: scaled, adjustment gone');
    assert.equal((await getBalances(d, [A, B], next)).get(B)?.allowance, 20);
  });

  test('a free Battery code gives the multiplied amount; a staff adjustment is exact', async () => {
    const d = setup();
    const batch = await createBatch(d, { kind: 'battery', appId: null, count: 2, units: 10, maxUsesPerCode: 1, expiresAt: null, note: '', actorUserId: STAFF }, NOW);
    assert.ok(batch);
    await setBonus(d, A, 15, NOW);
    const first = await redeemInvite(d, A, batch.codes[0]!, NOW);
    assert.deepEqual(first, { ok: true, kind: 'battery', appId: null, units: 15 }, '10 x 1.5');
    assert.equal((await getBalance(d, A, NOW)).allowance, 15 + 15);
    const plain = await redeemInvite(d, B, batch.codes[1]!, NOW);
    assert.deepEqual(plain, { ok: true, kind: 'battery', appId: null, units: 10 }, 'no bonus: unchanged');
    await adjustAllowance(d, { userId: A, delta: 7, reason: 'goodwill', actorUserId: STAFF }, NOW);
    assert.equal((await getBalance(d, A, NOW)).allowance, 15 + 15 + 7, 'staff adjustments are never multiplied');
  });

  test('syncBonus follows the profile and forgetting a member removes the row', async () => {
    const d = setup();
    assert.equal(await syncBonus(d, A, row(FULL, ['phone', 'bio', 'website']), NOW), 13);
    assert.equal(await bonusOf(d, A), 13);
    assert.equal(await syncBonus(d, A, BLANK, NOW + 1), 10);
    assert.equal(await bonusOf(d, A), 10);
    await setBonus(d, B, 18, NOW);
    await forgetBatteryMembers(d, [B]);
    assert.equal(await bonusOf(d, B), 10);
  });
});
