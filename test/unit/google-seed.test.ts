// Basic profile fields start from Google; anything the member typed or cleared is never overwritten.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { localeFromGoogle, seedProfileFromGoogle } from '../../src/identity/google-seed';
import { findOrCreateMember } from '../../src/identity/members';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 8, 2, 0, 0);
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;
const SEED = { name: '王小明', locale: 'ja', email: 'ming@example.com', emailVerified: true, isPrivateRelay: false };

async function member(db: ReturnType<typeof migratedDb>, sub: string) {
  return (await findOrCreateMember(asD1(db), { provider: 'google', subject: sub, email: `${sub}@example.com`, isPrivateRelay: false }, { appId: 'web', requestId: null }, NOW)).member.user_id;
}
const profile = async (db: ReturnType<typeof migratedDb>, id: string) =>
  (await asD1(db).prepare('SELECT display_name, locale, contact_email, contact_email_verified_at FROM profiles WHERE user_id = ?').bind(id).first()) as { display_name: string | null; locale: string; contact_email: string | null; contact_email_verified_at: number | null };

describe('Google profile seeding', () => {
  test('language tags map to the supported locales', () => {
    assert.equal(localeFromGoogle('zh-TW'), 'zh-TW');
    assert.equal(localeFromGoogle('en'), 'en-US');
    assert.equal(localeFromGoogle('ja'), 'ja-JP');
    assert.equal(localeFromGoogle('fr'), null);
    assert.equal(localeFromGoogle(null), null);
  });

  test('empty fields are filled from Google, the e-mail counts as verified', async () => {
    const db = migratedDb();
    const id = await member(db, 'g1');
    await seedProfileFromGoogle(asD1(db), 'g1', SEED, NOW);
    assert.deepEqual(await profile(db, id), { display_name: '王小明', locale: 'ja-JP', contact_email: 'ming@example.com', contact_email_verified_at: NOW });
    const audit = await asD1(db).prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'profile.seeded_from_google'").first<{ n: number }>();
    assert.equal(audit?.n, 1);
    await seedProfileFromGoogle(asD1(db), 'g1', SEED, NOW + 1);
    const again = await asD1(db).prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'profile.seeded_from_google'").first<{ n: number }>();
    assert.equal(again?.n, 1, 'nothing changed the second time, so nothing is logged');
  });

  test('what the member typed or deliberately cleared is kept; private relay and unverified e-mails are not used', async () => {
    const db = migratedDb();
    const typed = await member(db, 'g2');
    await asD1(db).prepare("UPDATE profiles SET display_name = '我自己改的' WHERE user_id = ?").bind(typed).run();
    const cleared = await member(db, 'g3');
    await asD1(db).prepare("INSERT INTO profile_field_updates (user_id, field, updated_at, source) VALUES (?, 'display_name', 1, 'member')").bind(cleared).run();
    const relay = await member(db, 'g4');
    await seedProfileFromGoogle(asD1(db), 'g2', { ...SEED, locale: null }, NOW);
    await seedProfileFromGoogle(asD1(db), 'g3', { ...SEED, locale: null }, NOW);
    await seedProfileFromGoogle(asD1(db), 'g4', { ...SEED, name: null, locale: null, emailVerified: false }, NOW);
    assert.equal((await profile(db, typed)).display_name, '我自己改的');
    assert.equal((await profile(db, cleared)).display_name, null);
    assert.equal((await profile(db, cleared)).contact_email, 'ming@example.com');
    assert.equal((await profile(db, relay)).contact_email, null);
    await seedProfileFromGoogle(asD1(db), 'nobody', SEED, NOW);
  });
});
