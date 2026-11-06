// Member numbers: "<calling code>-<7 digits>", unique, permanent, never reused.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findOrCreateMember } from '../../src/identity/members';
import { assignMissingMemberNumbers, callingCodeFor, issueMemberNumber, MEMBER_NO, normalizeCountry, randomSevenDigits } from '../../src/identity/member-number';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;
const identity = (subject: string) => ({ provider: 'google' as const, subject, email: `${subject}@example.com`, isPrivateRelay: false });

describe('calling codes', () => {
  test('known countries map to their code, unknown ones to 886', () => {
    assert.equal(callingCodeFor('TW'), '886');
    assert.equal(callingCodeFor('jp'), '81');
    assert.equal(callingCodeFor('US'), '1');
    assert.equal(callingCodeFor('XX'), '886');
    assert.equal(callingCodeFor(null), '886');
    assert.equal(normalizeCountry('xx'), null);
    assert.equal(normalizeCountry('jp'), 'JP');
  });
  test('random digits are always seven digits', () => {
    for (let i = 0; i < 200; i++) assert.match(randomSevenDigits(), /^\d{7}$/);
  });
});

describe('issuing numbers', () => {
  test('a new member gets a number with the country code of the sign-up request', async () => {
    const db = migratedDb();
    const { member } = await findOrCreateMember(asD1(db), identity('a'), { appId: 'web', requestId: null, country: 'JP' }, NOW);
    const row = db.prepare('SELECT member_no, registration_country FROM users WHERE user_id = ?').get(member.user_id) as { member_no: string; registration_country: string };
    assert.match(row.member_no, /^81-\d{7}$/);
    assert.equal(row.registration_country, 'JP');
  });
  test('the number never changes once issued', async () => {
    const db = migratedDb();
    const { member } = await findOrCreateMember(asD1(db), identity('b'), { appId: 'web', requestId: null, country: 'TW' }, NOW);
    const first = await issueMemberNumber(asD1(db), member.user_id, 'US', NOW + 1);
    assert.match(first ?? '', MEMBER_NO);
    assert.match(first ?? '', /^886-/);
  });
  test('a retired number is never issued again', async () => {
    const db = migratedDb();
    const { member } = await findOrCreateMember(asD1(db), identity('c'), { appId: 'web', requestId: null }, NOW);
    db.prepare('UPDATE users SET member_no = NULL WHERE user_id = ?').run(member.user_id);
    for (let i = 0; i < 10; i++) db.prepare('INSERT OR IGNORE INTO retired_member_numbers (member_no, retired_at) VALUES (?, ?)').run(`886-000000${i}`, NOW);
    const number = await issueMemberNumber(asD1(db), member.user_id, 'TW', NOW);
    assert.ok(number);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM retired_member_numbers WHERE member_no = ?').get(number)?.n, 0);
  });
  test('maintenance gives existing members 886 numbers', async () => {
    const db = migratedDb();
    const { member } = await findOrCreateMember(asD1(db), identity('d'), { appId: 'web', requestId: null }, NOW);
    db.prepare('UPDATE users SET member_no = NULL, registration_country = NULL WHERE user_id = ?').run(member.user_id);
    assert.equal(await assignMissingMemberNumbers(asD1(db), NOW), 1);
    assert.match((db.prepare('SELECT member_no FROM users WHERE user_id = ?').get(member.user_id) as { member_no: string }).member_no, /^886-\d{7}$/);
    assert.equal(await assignMissingMemberNumbers(asD1(db), NOW), 0);
  });
});
