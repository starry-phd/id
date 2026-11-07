// Member numbers: "<ISO><7 digits>", unique among living members, released on deletion, member-editable.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findOrCreateMember } from '../../src/identity/members';
import { deleteMemberNow } from '../../src/identity/lifecycle';
import { assignMissingMemberNumbers, callingCodeOf, changeMemberNo, countryOptions, issueMemberNumber, MEMBER_NO, MEMBER_NO_CHANGES_PER_DAY, normalizeCountry, normalizeMemberNo, randomSevenDigits } from '../../src/identity/member-number';
import { applyMigration, migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;
const identity = (subject: string) => ({ provider: 'google' as const, subject, email: `${subject}@example.com`, isPrivateRelay: false });

describe('format and country list', () => {
  test('normalizing accepts case and spacing, rejects the old format', () => {
    assert.equal(normalizeMemberNo('tw0112342'), 'TW0112342');
    assert.equal(normalizeMemberNo(' TW 0112342 '), 'TW0112342');
    assert.equal(normalizeMemberNo('886-0112342'), null);
    assert.equal(normalizeMemberNo('XX0112342'), null);
    assert.equal(normalizeMemberNo('TW112342'), null);
    assert.equal(normalizeCountry('xx'), null);
    assert.equal(normalizeCountry('jp'), 'JP');
    assert.equal(callingCodeOf('TW'), '886');
  });
  test('the picker starts with Taiwan and the neighbours, the rest follows calling codes', () => {
    const list = countryOptions();
    assert.deepEqual(list.slice(0, 5).map((x) => x.iso), ['TW', 'HK', 'MO', 'CN', 'JP']);
    assert.equal(new Set(list.map((x) => x.iso)).size, list.length);
    const tail = list.slice(list.findIndex((x) => x.iso === 'FM') + 2);
    for (let i = 1; i < tail.length; i++) assert.ok(Number(tail[i - 1]?.callingCode) <= Number(tail[i]?.callingCode));
  });
  test('random digits are always seven digits', () => {
    for (let i = 0; i < 200; i++) assert.match(randomSevenDigits(), /^\d{7}$/);
  });
});

describe('issuing numbers', () => {
  test('a new member gets the ISO of the sign-up request, unknown countries fall back to TW', async () => {
    const db = migratedDb();
    const jp = await findOrCreateMember(asD1(db), identity('a'), { appId: 'web', requestId: null, country: 'JP' }, NOW);
    const xx = await findOrCreateMember(asD1(db), identity('a2'), { appId: 'web', requestId: null, country: 'XX' }, NOW);
    const get = async (id: string) => (await asD1(db).prepare('SELECT member_no, registration_country FROM users WHERE user_id = ?').bind(id).first()) as { member_no: string; registration_country: string | null };
    assert.match((await get(jp.member.user_id)).member_no, /^JP\d{7}$/);
    assert.equal((await get(jp.member.user_id)).registration_country, 'JP');
    assert.match((await get(xx.member.user_id)).member_no, /^TW\d{7}$/);
  });
  test('an issued number is not replaced by a second draw', async () => {
    const db = migratedDb();
    const { member } = await findOrCreateMember(asD1(db), identity('b'), { appId: 'web', requestId: null, country: 'TW' }, NOW);
    const first = await issueMemberNumber(asD1(db), member.user_id, 'US', NOW + 1);
    assert.match(first ?? '', MEMBER_NO);
    assert.match(first ?? '', /^TW/);
  });
  test('maintenance gives existing members a number', async () => {
    const db = migratedDb();
    const { member } = await findOrCreateMember(asD1(db), identity('d'), { appId: 'web', requestId: null }, NOW);
    await asD1(db).prepare('UPDATE users SET member_no = NULL, registration_country = NULL WHERE user_id = ?').bind(member.user_id).run();
    assert.equal(await assignMissingMemberNumbers(asD1(db), NOW), 1);
    const row = await asD1(db).prepare('SELECT member_no FROM users WHERE user_id = ?').bind(member.user_id).first<{ member_no: string }>();
    assert.match(row?.member_no ?? '', /^TW\d{7}$/);
    assert.equal(await assignMissingMemberNumbers(asD1(db), NOW), 0);
  });
});

describe('changing and releasing numbers', () => {
  const setup = async () => {
    const db = migratedDb();
    const a = await findOrCreateMember(asD1(db), identity('x'), { appId: 'web', requestId: null, country: 'TW' }, NOW);
    const b = await findOrCreateMember(asD1(db), identity('y'), { appId: 'web', requestId: null, country: 'TW' }, NOW);
    return { db, a: a.member.user_id, b: b.member.user_id };
  };
  const numberOf = async (db: ReturnType<typeof migratedDb>, id: string) => (await asD1(db).prepare('SELECT member_no FROM users WHERE user_id = ?').bind(id).first<{ member_no: string }>())?.member_no;

  test('a member can pick a new country and digits; the old number is remembered', async () => {
    const { db, a } = await setup();
    const before = await numberOf(db, a);
    const result = await changeMemberNo(asD1(db), { userId: a, requested: 'jp0000001', requestId: null }, NOW);
    assert.deepEqual(result, { ok: true, memberNo: 'JP0000001', previous: before ?? null, unchanged: false });
    assert.equal(await numberOf(db, a), 'JP0000001');
  });

  test('uniqueness covers the whole number; the same digits under another country are fine', async () => {
    const { db, a, b } = await setup();
    assert.equal((await changeMemberNo(asD1(db), { userId: a, requested: 'JP7777777', requestId: null }, NOW)).ok, true);
    assert.deepEqual(await changeMemberNo(asD1(db), { userId: b, requested: 'jp7777777', requestId: null }, NOW), { ok: false, reason: 'taken' });
    assert.equal((await changeMemberNo(asD1(db), { userId: b, requested: 'US7777777', requestId: null }, NOW)).ok, true);
    assert.deepEqual(await changeMemberNo(asD1(db), { userId: b, requested: '886-1234567', requestId: null }, NOW), { ok: false, reason: 'invalid' });
    const same = await changeMemberNo(asD1(db), { userId: b, requested: 'US7777777', requestId: null }, NOW);
    assert.equal(same.ok && same.unchanged, true);
  });

  test('self-service changes are limited per day, admins are not', async () => {
    const { db, a } = await setup();
    for (let i = 0; i < MEMBER_NO_CHANGES_PER_DAY; i++) assert.equal((await changeMemberNo(asD1(db), { userId: a, requested: `TW000000${i}`, requestId: null }, NOW + i)).ok, true);
    assert.deepEqual(await changeMemberNo(asD1(db), { userId: a, requested: 'TW0000009', requestId: null }, NOW + 10), { ok: false, reason: 'rate_limited' });
    assert.equal((await changeMemberNo(asD1(db), { userId: a, requested: 'TW0000009', byAdminId: 'staff', requestId: null }, NOW + 11)).ok, true);
    assert.equal((await changeMemberNo(asD1(db), { userId: a, requested: 'TW0000008', requestId: null }, NOW + 25 * 3600 * 1000)).ok, true, 'a day later it works again');
    const log = await asD1(db).prepare('SELECT COUNT(*) AS n FROM member_no_changes WHERE user_id = ?').bind(a).first<{ n: number }>();
    assert.equal(log?.n, MEMBER_NO_CHANGES_PER_DAY + 2);
    const audit = await asD1(db).prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'member.no_changed' AND target_id = ?").bind(a).first<{ n: number }>();
    assert.equal(audit?.n, MEMBER_NO_CHANGES_PER_DAY + 2);
  });

  test('deleting a member releases the number for someone else', async () => {
    const { db, a, b } = await setup();
    await changeMemberNo(asD1(db), { userId: a, requested: 'KR1111111', requestId: null }, NOW);
    assert.deepEqual(await changeMemberNo(asD1(db), { userId: b, requested: 'KR1111111', requestId: null }, NOW), { ok: false, reason: 'taken' });
    assert.equal((await deleteMemberNow(asD1(db), { userId: a, appId: null, requestId: null }, NOW)).ok, true);
    assert.equal((await changeMemberNo(asD1(db), { userId: b, requested: 'KR1111111', requestId: null }, NOW)).ok, true);
    assert.equal(await numberOf(db, b), 'KR1111111');
  });
});

describe('migration 0031', () => {
  test('old calling-code numbers become ISO numbers and the retired list goes away', async () => {
    const db = migratedDb('migrations/identity', '0031');
    const sql = asD1(db);
    const rows: Array<[string, string, string | null]> = [
      ['u1', '886-0112342', 'TW'],
      ['u2', '1-5550001', 'CA'],
      ['u3', '1-5550002', null],
      ['u4', '81-1234567', 'TW'],
      ['u5', '44-7000000', null],
      ['u6', '7-9999999', 'KZ'],
    ];
    for (const [id, no, country] of rows) {
      await sql.prepare("INSERT INTO users (user_id, member_no, registration_country, status, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, 1)").bind(id, no, country).run();
    }
    await sql.prepare('INSERT INTO retired_member_numbers (member_no, retired_at) VALUES (?, 1)').bind('886-0000001').run();
    applyMigration(db, 'migrations/identity/0031_member_id_iso.sql');
    const out = await sql.prepare('SELECT user_id, member_no, registration_country FROM users ORDER BY user_id').all<{ user_id: string; member_no: string; registration_country: string }>();
    assert.deepEqual(
      out.results.map((r) => [r.member_no, r.registration_country]),
      [['TW0112342', 'TW'], ['CA5550001', 'CA'], ['US5550002', 'US'], ['JP1234567', 'TW'], ['GB7000000', 'GB'], ['KZ9999999', 'KZ']],
    );
    await assert.rejects(async () => sql.prepare('SELECT 1 FROM retired_member_numbers').all());
    await sql.prepare("INSERT INTO member_no_changes (user_id, old_no, new_no, changed_at) VALUES ('u1', 'TW0112342', 'TW1', 1)").run();
  });
});
