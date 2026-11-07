// Admin changes of a member's referrer: whole subtree follows, loops and self are refused, clearing works.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findOrCreateMember } from '../../src/identity/members';
import { adminSetReferrer, bindReferrer, memberByNo, orgNetwork, referrerOf } from '../../src/identity/referrals';
import { parseInviteInput } from '../../src/web/account-network';
import { BATTERY_ICON, referrerChangeCostText } from '../../src/lib/battery-icons';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 8, 1, 0, 0);
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;

async function setup() {
  const db = migratedDb();
  const ids: string[] = [];
  for (const sub of ['a', 'b', 'c', 'd']) ids.push((await findOrCreateMember(asD1(db), { provider: 'google', subject: sub, email: `${sub}@example.com`, isPrivateRelay: false }, { appId: 'web', requestId: null, country: 'TW' }, NOW)).member.user_id);
  return { db, a: ids[0]!, b: ids[1]!, c: ids[2]!, d: ids[3]! };
}
const noOf = async (db: ReturnType<typeof migratedDb>, id: string) => (await asD1(db).prepare('SELECT member_no FROM users WHERE user_id = ?').bind(id).first<{ member_no: string }>())!.member_no;

describe('admin changes the referrer', () => {
  test('moves the member and everyone below, refuses loops and self, can clear', async () => {
    const { db, a, b, c, d } = await setup();
    const d1 = asD1(db);
    assert.equal(await bindReferrer(d1, b, a, null, NOW), 'bound');
    assert.equal(await bindReferrer(d1, c, b, null, NOW), 'bound');
    const staff = { staffId: a, requestId: null };
    assert.equal(await adminSetReferrer(d1, { ...staff, userId: b, referrerNo: await noOf(db, c) }, NOW), 'cycle');
    assert.equal(await adminSetReferrer(d1, { ...staff, userId: b, referrerNo: await noOf(db, b) }, NOW), 'self');
    assert.equal(await adminSetReferrer(d1, { ...staff, userId: b, referrerNo: 'TW0000000' }, NOW), 'invalid');
    assert.equal(await adminSetReferrer(d1, { ...staff, userId: b, referrerNo: await noOf(db, a) }, NOW), 'unchanged');
    assert.equal(await adminSetReferrer(d1, { ...staff, userId: b, referrerNo: await noOf(db, d) }, NOW), 'changed');
    assert.equal((await referrerOf(d1, b))?.user_id, d);
    assert.deepEqual((await orgNetwork(d1, d)).nodes.map((n) => n.user_id), [b, c], 'the subtree moved with the member');
    assert.equal((await orgNetwork(d1, a)).stats.total, 0);
    assert.equal(await adminSetReferrer(d1, { ...staff, userId: b, referrerNo: null }, NOW), 'cleared');
    assert.equal(await referrerOf(d1, b), null);
    assert.equal(await adminSetReferrer(d1, { ...staff, userId: b, referrerNo: null }, NOW), 'unchanged');
    assert.equal(await adminSetReferrer(d1, { ...staff, userId: 'nobody', referrerNo: null }, NOW), 'not_found');
    const audit = await d1.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('admin.referrer_changed','admin.referrer_cleared')").first<{ n: number }>();
    assert.equal(audit?.n, 2);
    // after clearing, the member can be bound again by themselves
    assert.equal(await bindReferrer(d1, b, c, null, NOW), 'cycle');
    assert.equal(await bindReferrer(d1, b, d, null, NOW), 'bound');
    assert.ok((await memberByNo(d1, await noOf(db, d)))?.initials !== undefined);
  });
});

describe('invite input and battery icons', () => {
  test('codes, links and spacing are all understood', () => {
    assert.equal(parseInviteInput('TW9475831'), 'TW9475831');
    assert.equal(parseInviteInput('https://id.starry.phd/Invite/tw9475831'), 'TW9475831');
    assert.equal(parseInviteInput('InviteTW9475831'), 'TW9475831');
    assert.equal(parseInviteInput(' JP 0123456 '), 'JP0123456');
    assert.equal(parseInviteInput('hello'), null);
    assert.equal(parseInviteInput('XX0123456'), null);
  });
  test('the cost text always carries the matching icons', () => {
    assert.equal(BATTERY_ICON.normal, '🔋');
    assert.equal(BATTERY_ICON.quantum, '⚛️');
    assert.equal(referrerChangeCostText(), '🔋 1000 顆普通電池或 ⚛️ 10 顆量子電池');
  });
});
