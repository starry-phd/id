// The member's primary display name: nickname or real name, exactly one; it decides shown_name and the organisation chart.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findOrCreateMember } from '../../src/identity/members';
import { loadProfile, publicProfile, saveProfile, setPrimaryName, shownName, validateProfileInput } from '../../src/identity/profile';
import { bindReferrer, orgNetwork } from '../../src/identity/referrals';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 8, 2, 0, 0);
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;

async function setup() {
  const db = migratedDb();
  const d = asD1(db);
  const make = async (sub: string) => (await findOrCreateMember(d, { provider: 'google', subject: sub, email: `${sub}@example.com`, isPrivateRelay: false }, { appId: 'web', requestId: null, country: 'TW' }, NOW)).member.user_id;
  const root = await make('root');
  const kid = await make('kid');
  await bindReferrer(d, kid, root, null, NOW);
  return { d, root, kid };
}

async function fill(d: D1Database, userId: string, fields: Record<string, string>, visibility: Record<string, string> = {}) {
  const loaded = await loadProfile(d, userId);
  const v = validateProfileInput({ ...fields, ...(Object.keys(visibility).length ? { visibility } : {}) }, NOW, null);
  assert.ok(v.ok);
  const saved = await saveProfile(d, { userId, expectedVersion: loaded!.row.version, changes: v.changes, source: 'member', actorUserId: userId, appId: 'web', requestId: null }, NOW);
  assert.ok(saved.written);
}
const choose = async (d: D1Database, userId: string, choice: 'nickname' | 'display_name') =>
  setPrimaryName(d, { userId, expectedVersion: (await loadProfile(d, userId))!.row.version, choice, actorUserId: userId, appId: 'web', requestId: null }, NOW + 1);

describe('primary display name', () => {
  test('shownName follows the choice and falls back to the other name', () => {
    assert.equal(shownName('小星', '王小明'), '小星', 'default is the nickname');
    assert.equal(shownName('小星', '王小明', 'display_name'), '王小明');
    assert.equal(shownName(null, '王小明', 'nickname'), '王小明');
    assert.equal(shownName('小星', null, 'display_name'), '小星');
    assert.equal(shownName(' ', null), null);
  });

  test('exactly one is chosen; it needs a value; the real name becomes public when chosen', async () => {
    const { d, kid } = await setup();
    assert.equal((await loadProfile(d, kid))!.row.primary_name, 'nickname', 'existing members keep nickname first');
    assert.equal(await choose(d, kid, 'nickname'), 'missing_name', 'no nickname yet');
    await fill(d, kid, { nickname: '小星', display_name: '王小明' }, { display_name: 'private' });
    assert.equal(await choose(d, kid, 'display_name'), 'saved');
    const row = (await loadProfile(d, kid))!.row;
    assert.equal(row.primary_name, 'display_name');
    assert.equal(publicProfile(row, null, NOW).shown_name, '王小明', 'choosing the real name makes it public');
    assert.equal(await choose(d, kid, 'display_name'), 'unchanged');
    assert.equal(await choose(d, kid, 'nickname'), 'saved');
    assert.equal(publicProfile((await loadProfile(d, kid))!.row, null, NOW).shown_name, '小星');
    const stale = await setPrimaryName(d, { userId: kid, expectedVersion: 1, choice: 'display_name', actorUserId: kid, appId: 'web', requestId: null }, NOW + 5);
    assert.equal(stale, 'conflict');
  });

  test('a real name hidden later is not shown to others even when it is the primary name', async () => {
    const { d, kid } = await setup();
    await fill(d, kid, { nickname: '小星', display_name: '王小明' });
    await choose(d, kid, 'display_name');
    await fill(d, kid, {}, { display_name: 'private' });
    const row = (await loadProfile(d, kid))!.row;
    assert.equal(publicProfile(row, null, NOW).shown_name, '小星');
    assert.equal(shownName(row.nickname, row.display_name, row.primary_name), '王小明', 'the member still sees their own choice');
  });

  test('the organisation chart shows the chosen name, never the member number', async () => {
    const { d, root, kid } = await setup();
    assert.equal((await orgNetwork(d, root)).nodes[0]!.name, '星友', 'no name at all: a neutral word, not the number');
    await fill(d, kid, { nickname: '小星', display_name: '王小明' });
    assert.equal((await orgNetwork(d, root)).nodes[0]!.name, '小星');
    await choose(d, kid, 'display_name');
    assert.equal((await orgNetwork(d, root)).nodes[0]!.name, '王小明');
  });
});
