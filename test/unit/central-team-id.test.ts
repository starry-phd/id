import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { centralTeamId, effectiveTeamId, parseTeamId, refreshCentralTeamId, saveCentralTeamId } from '../../src/apps/team-id';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const actor = { userId: 'owner-1', requestId: 'req-1' };

describe('one central Apple Team ID stored in D1', () => {
  test('migration seeds the agreed Team ID once; existing Apps still have their original identifiers', async () => {
    const db = migratedDb() as unknown as D1Database;
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'apple_team_id'").first<{ value: string }>();
    assert.equal(row?.value, '4W7QRTXN5Y');
    const echo = await db.prepare("SELECT definition FROM registered_apps WHERE app_id = 'echo'").first<{ definition: string }>();
    assert.equal(JSON.parse(echo!.definition).ios_bundle_id, 'phd.starry.echo');
    assert.equal(JSON.parse(echo!.definition).ios_team_id, null);
  });

  test('D1 beats the legacy Worker fallback, changes are audited, and all Apps inherit it', async () => {
    const db = migratedDb() as unknown as D1Database;
    const env = { DB_IDENTITY: db, STARRY_APPLE_TEAM_ID: 'WRONG99999' };
    await refreshCentralTeamId(db, NOW, env.STARRY_APPLE_TEAM_ID);
    assert.equal(centralTeamId(env), '4W7QRTXN5Y');
    assert.equal(await saveCentralTeamId(db, actor, ' 0a1b2c3d4e ', NOW + 1), 'updated');
    assert.equal(centralTeamId(env), '0A1B2C3D4E');
    assert.equal(effectiveTeamId({ ios_team_id: 'ZZZZZ99999' }, env), '0A1B2C3D4E');
    const audit = await db.prepare("SELECT action, actor_user_id FROM audit_log WHERE action = 'admin.apple_team_id_updated'").all<{ action: string; actor_user_id: string }>();
    assert.deepEqual(audit.results.map((a) => a.actor_user_id), ['owner-1']);
    assert.equal(await saveCentralTeamId(db, actor, '0A1B2C3D4E', NOW + 2), 'unchanged');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.apple_team_id_updated'").first<{ n: number }>())?.n, 1);
  });

  test('invalid identifiers cannot be stored, cache refreshes, missing D1 retains last valid value', async () => {
    const db = migratedDb() as unknown as D1Database;
    const env = { DB_IDENTITY: db, STARRY_APPLE_TEAM_ID: '4W7QRTXN5Y' };
    assert.equal(parseTeamId('team-id'), null);
    assert.equal(await saveCentralTeamId(db, actor, 'not-valid', NOW), 'invalid');
    await refreshCentralTeamId(db, NOW, env.STARRY_APPLE_TEAM_ID);
    assert.equal(centralTeamId(env), '4W7QRTXN5Y');
    await db.prepare("UPDATE platform_settings SET value = 'ABCDEFGHIJ' WHERE key = 'apple_team_id'").run();
    await refreshCentralTeamId(db, NOW + 31_000, env.STARRY_APPLE_TEAM_ID);
    assert.equal(centralTeamId(env), 'ABCDEFGHIJ');
    await db.prepare("DELETE FROM platform_settings WHERE key = 'apple_team_id'").run();
    await refreshCentralTeamId(db, NOW + 62_000, env.STARRY_APPLE_TEAM_ID);
    assert.equal(centralTeamId(env), 'ABCDEFGHIJ', 'stale-while-error never reverts to the Worker fallback');
  });
});
