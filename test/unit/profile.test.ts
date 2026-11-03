// Unit tests for the restored member profile (S-ID-08, original checklist 02.01-02.10).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { confirmContactEmail, sendContactEmailVerification } from '../../src/identity/contact-email';
import { findOrCreateMember } from '../../src/identity/members';
import { MOTTOS, randomMotto } from '../../src/identity/mottos';
import {
  ageOn, derivedOf, effectiveVisibility, loadProfile, normalizePhone, numerologyOf, publicProfile, saveProfile, validateProfileInput, zodiacOf,
  type ProfileChanges,
} from '../../src/identity/profile';
import { contactEmailOf, mailSettings, type EmailSender, type OutgoingEmail } from '../../src/notify/email';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 6, 0, 0);
const KEY = Buffer.alloc(32, 7).toString('base64url');
type Db = ReturnType<typeof migratedDb>;
const asD1 = (db: Db) => db as unknown as D1Database;

async function member() {
  const db = migratedDb();
  const d = asD1(db);
  const { member: m } = await findOrCreateMember(d, { provider: 'google', subject: 'g-profile', email: 'login@example.com', isPrivateRelay: false }, { appId: 'echo', requestId: null }, NOW);
  return { db, d, userId: m.user_id };
}

const changes = (fields: ProfileChanges['fields'], visibility: ProfileChanges['visibility'] = {}): ProfileChanges => ({ fields, visibility });

describe('phone numbers (02.02)', () => {
  test('local numbers take the country calling code; international forms are kept; junk is refused', () => {
    assert.equal(normalizePhone('0912-345-678', null), '+886912345678', 'Taiwan by default');
    assert.equal(normalizePhone('0912 345 678', 'TW'), '+886912345678');
    assert.equal(normalizePhone('090-1234-5678', 'JP'), '+819012345678');
    assert.equal(normalizePhone('+1 (415) 555-0100', 'TW'), '+14155550100');
    assert.equal(normalizePhone('00886912345678', null), '+886912345678');
    assert.equal(normalizePhone('12', null), null);
    assert.equal(normalizePhone('09123abc', null), null);
    assert.equal(normalizePhone('0912345678', 'ZZ'), null, 'unknown country without a + prefix');
  });
});

describe('birthday derived information (02.04)', () => {
  test('zodiac boundaries', () => {
    assert.deepEqual(['1990-01-19', '1990-01-20', '1990-02-28', '1990-03-21', '1990-12-21', '1990-12-22'].map((b) => zodiacOf(b).name), ['摩羯座', '水瓶座', '雙魚座', '牡羊座', '射手座', '摩羯座']);
  });

  test('talent numbers, life path number, grid and lines', () => {
    const n = numerologyOf('1990-02-28');
    assert.deepEqual(n.talent_numbers, [31]);
    assert.equal(n.life_path_number, 4);
    assert.deepEqual(Object.fromEntries(n.grid.filter((g) => g.count > 0).map((g) => [g.number, g.count])), { 1: 2, 2: 2, 3: 1, 4: 1, 8: 1, 9: 2 });
    assert.deepEqual(n.lines, ['1-2-3']);
    const twice = numerologyOf('1999-09-29');
    assert.deepEqual([twice.talent_numbers, twice.life_path_number], [[48, 12], 3]);
    assert.equal(derivedOf(null), null);
    assert.equal(derivedOf('1990-02-28')?.zodiac, 'pisces');
  });

  test('age in Taiwan time', () => {
    assert.equal(ageOn('2008-11-03', NOW), 18);
    assert.equal(ageOn('2008-11-04', NOW), 17);
  });
});

describe('validation', () => {
  test('fields are checked one by one; empty text clears optional fields', () => {
    const ok = validateProfileInput({ display_name: ' 星星 ', country: 'tw', region: ' 臺北市 ', city: '', phone: '0912345678', contact_email: 'Me@Example.COM', motto: '慢慢來', visibility: { phone: 'public' } }, NOW, null);
    assert.ok(ok.ok);
    assert.deepEqual(ok.changes.fields, { display_name: '星星', country: 'TW', region: '臺北市', city: null, motto: '慢慢來', contact_email: 'me@example.com', phone: '+886912345678' });
    assert.deepEqual(ok.changes.visibility, { phone: 'public' });
    const fail = (input: Record<string, unknown>) => {
      const r = validateProfileInput(input, NOW, null);
      return r.ok ? null : r.field;
    };
    assert.equal(fail({ display_name: '' }), 'display_name');
    assert.equal(fail({ birthday: '2999-01-01' }), 'birthday');
    assert.equal(fail({ country: 'Taiwan' }), 'country');
    assert.equal(fail({ contact_email: 'not-an-email' }), 'contact_email');
    assert.equal(fail({ phone: '123' }), 'phone');
    assert.equal(fail({ motto: 'x'.repeat(201) }), 'motto');
    assert.equal(fail({ visibility: { phone: 'everyone' } }), 'visibility');
    assert.equal(fail({ visibility: { user_id: 'public' } }), 'visibility');
    assert.equal(fail({ region: 'a\u0000b' }), 'region');
  });
});

describe('saving (02.07, 02.08, 02.10)', () => {
  test('fields, visibility and last-changed times are stored; stale versions are refused', async () => {
    const { db, d, userId } = await member();
    const first = await saveProfile(d, { userId, expectedVersion: 1, changes: changes({ display_name: '小星', phone: '+886912345678', country: 'TW' }, { phone: 'public' }), source: 'member', actorUserId: userId, appId: 'echo', requestId: null }, NOW);
    assert.deepEqual(first, { written: true, newContactEmail: null });
    const loaded = await loadProfile(d, userId);
    assert.ok(loaded);
    assert.deepEqual([loaded.row.display_name, loaded.row.phone, loaded.row.country, loaded.row.version], ['小星', '+886912345678', 'TW', 2]);
    assert.deepEqual(Object.keys(loaded.fieldUpdates).sort(), ['country', 'display_name', 'phone', 'visibility']);
    assert.equal(loaded.fieldUpdates.phone?.source, 'member');
    assert.equal(effectiveVisibility(loaded.row, NOW).phone, 'public');
    assert.equal(effectiveVisibility(loaded.row, NOW).birthday, 'private', 'defaults stay for untouched fields');

    const stale = await saveProfile(d, { userId, expectedVersion: 1, changes: changes({ display_name: '舊' }), source: 'member', actorUserId: userId, appId: 'echo', requestId: null }, NOW + 1);
    assert.equal(stale.written, false);
    assert.equal((await loadProfile(d, userId))?.row.display_name, '小星');
    const unchanged = await saveProfile(d, { userId, expectedVersion: 2, changes: changes({ display_name: '小星', motto: '新座右銘' }), source: 'member', actorUserId: userId, appId: 'echo', requestId: null }, NOW + 2);
    assert.ok(unchanged.written);
    assert.equal((await loadProfile(d, userId))?.fieldUpdates.display_name?.updated_at, NOW, 'an unchanged value keeps its last-changed time');
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'profile.update'").first('n')) ?? 0), 3);
  });

  test('public view: month-day birthday, no year-revealing numbers, minors kept private, unverified email hidden', async () => {
    const { d, userId } = await member();
    await saveProfile(
      d,
      { userId, expectedVersion: 1, changes: changes({ display_name: '小星', birthday: '1990-02-28', contact_email: 'me@example.com', country: 'TW', city: '大安區' }, { birthday: 'public', derived: 'public', location: 'public', contact_email: 'public' }), source: 'member', actorUserId: userId, appId: 'echo', requestId: null },
      NOW,
    );
    const adult = (await loadProfile(d, userId))!.row;
    const view = publicProfile(adult, null, NOW);
    assert.deepEqual(
      [view.display_name, view.birthday_month_day, view.zodiac_name, view.life_path_number, view.location, view.contact_email, view.phone],
      ['小星', '02-28', '雙魚座', 4, { country: 'TW', region: null, city: '大安區' }, null, null],
    );
    assert.equal(Object.keys(view).some((k) => k.includes('talent') || k.includes('grid')), false);
    const minor = { ...adult, birthday: '2012-05-05' };
    assert.deepEqual([publicProfile(minor, null, NOW).birthday_month_day, publicProfile(minor, null, NOW).zodiac_name], [null, null]);
  });
});

describe('main contact email (02.01)', () => {
  test('a new address needs the emailed link; then system email goes there', async () => {
    const { d, userId } = await member();
    const saved = await saveProfile(d, { userId, expectedVersion: 1, changes: changes({ contact_email: 'main@example.com' }), source: 'member', actorUserId: userId, appId: 'echo', requestId: null }, NOW);
    assert.equal(saved.newContactEmail, 'main@example.com');
    assert.equal(await contactEmailOf(d, userId), 'login@example.com', 'unverified addresses are not used');

    const sent: OutgoingEmail[] = [];
    const sender: EmailSender = { send: async (m) => (sent.push(m), { messageId: 'm1' }) };
    const mail = mailSettings({ EMAIL: sender, EMAIL_FROM: 'support@starry.phd', SUPPORT_EMAIL: 'support@starry.phd' }, 'https://id.starry.phd');
    assert.equal(await sendContactEmailVerification(KEY, mail, userId, 'main@example.com', NOW), 'sent');
    assert.equal(await sendContactEmailVerification(KEY, null, userId, 'main@example.com', NOW), 'unavailable');
    assert.equal(sent[0]?.to, 'main@example.com');
    const token = decodeURIComponent(/verify-email\?t=([^\s]+)/.exec(sent[0]?.text ?? '')?.[1] ?? '');
    assert.equal(await confirmContactEmail(d, KEY, 'v1.bad.token', NOW), 'invalid');
    assert.equal(await confirmContactEmail(d, KEY, token, NOW + 25 * 3600 * 1000), 'expired');
    assert.equal(await confirmContactEmail(d, KEY, token, NOW + 1000), 'verified');
    assert.equal(await confirmContactEmail(d, KEY, token, NOW + 2000), 'verified', 'opening the link twice is fine');
    assert.equal(await contactEmailOf(d, userId), 'main@example.com');

    await saveProfile(d, { userId, expectedVersion: 2, changes: changes({ contact_email: 'other@example.com' }), source: 'member', actorUserId: userId, appId: 'echo', requestId: null }, NOW + 3000);
    assert.equal(await contactEmailOf(d, userId), 'login@example.com', 'changing the address needs a new confirmation');
    assert.equal(await confirmContactEmail(d, KEY, token, NOW + 4000), 'changed');
  });
});

describe('motto suggestions (02.05)', () => {
  test('a suggestion differs from the current motto', () => {
    assert.ok(MOTTOS.length >= 30);
    for (let i = 0; i < 20; i++) assert.notEqual(randomMotto(MOTTOS[0] ?? null), MOTTOS[0]);
  });
});
