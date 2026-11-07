// App-scoped support role (item 9): kinds of App staff, and the ticket and member filters that enforce the scope.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { searchMembers } from '../../src/identity/member-search';
import { isAppStaff, listAppStaff, listAppStaffApps, setAppStaff } from '../../src/identity/roles';
import { createTicket, listTickets } from '../../src/support/tickets';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const owner = { userId: 'owner', role: 'owner' as const, requestId: null };

async function addUser(d: D1Database, id: string): Promise<void> {
  await d.prepare("INSERT INTO users (user_id, status, created_at, updated_at, status_changed_at, session_version) VALUES (?, 'active', ?, ?, ?, 1)").bind(id, NOW, NOW, NOW).run();
}
const used = (d: D1Database, user: string, app: string) => d.prepare('INSERT INTO member_apps (user_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)').bind(user, app, NOW, NOW).run();

describe('App staff kinds', () => {
  test('manager and support are separate, one row per App, and only managers count as config managers', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    await addUser(d, 'owner');
    await addUser(d, 'u1');
    assert.equal(await setAppStaff(d, owner, 'u1', 'clock', true, NOW, 'support'), true);
    assert.equal(await setAppStaff(d, owner, 'u1', 'notes', true, NOW), true);
    assert.deepEqual(await listAppStaffApps(d, 'u1', 'support'), ['clock']);
    assert.deepEqual(await listAppStaffApps(d, 'u1'), ['notes']);
    assert.equal(await isAppStaff(d, 'u1', 'clock'), false, 'a support person cannot edit config');
    assert.equal(await isAppStaff(d, 'u1', 'notes'), true);
    // Granting the other kind replaces it instead of adding a second row.
    await setAppStaff(d, owner, 'u1', 'clock', true, NOW, 'manager');
    assert.deepEqual(await listAppStaff(d, 'u1'), [{ app_id: 'clock', kind: 'manager' }, { app_id: 'notes', kind: 'manager' }]);
    // Revoking one kind leaves a different kind alone.
    await setAppStaff(d, owner, 'u1', 'clock', false, NOW, 'support');
    assert.equal(await isAppStaff(d, 'u1', 'clock'), true);
    await setAppStaff(d, owner, 'u1', 'clock', false, NOW, 'manager');
    assert.equal(await isAppStaff(d, 'u1', 'clock'), false);
  });

  test('only a global owner can assign, never an App-scoped person or another role', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    await addUser(d, 'u1');
    assert.equal(await setAppStaff(d, { userId: 'a', role: 'admin', requestId: null }, 'u1', 'clock', true, NOW, 'support'), false);
    assert.equal(await setAppStaff(d, { ...owner, appScope: ['clock'] }, 'u1', 'clock', true, NOW, 'support'), false);
    assert.equal(await setAppStaff(d, owner, 'ghost', 'clock', true, NOW, 'support'), false, 'unknown member');
    assert.deepEqual(await listAppStaff(d, 'u1'), []);
  });
});

describe('scope filters', () => {
  test('tickets: scoped list shows only the named Apps and never untagged tickets; an empty scope shows nothing', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    const make = (appId: string | null, n: number) => createTicket(d, { userId: null, contactEmail: `a${n}@example.com`, category: 'question', appId, message: `m${n}`, clientIp: `10.0.0.${n}` }, NOW + n);
    await make('clock', 1);
    await make('notes', 2);
    await make(null, 3);
    await make('clock', 4);
    const apps = async (appIds?: readonly string[], appId?: string) => (await listTickets(d, { status: 'open', appIds, appId })).tickets.map((t) => t.app_id ?? '-').sort();
    assert.deepEqual(await apps(), ['-', 'clock', 'clock', 'notes'], 'global staff see everything');
    assert.deepEqual(await apps(['clock']), ['clock', 'clock']);
    assert.deepEqual(await apps(['clock', 'notes']), ['clock', 'clock', 'notes']);
    assert.deepEqual(await apps(['clock'], 'notes'), [], 'narrowing to an App outside the scope finds nothing');
    assert.deepEqual(await apps(['clock'], '-'), [], 'untagged tickets stay hidden');
    assert.deepEqual(await apps([]), []);
  });

  test('members: scoped search finds only members who used the App, keeps the keyword filter, and an empty scope finds nobody', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    for (const id of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']) await addUser(d, id);
    await used(d, '00000000-0000-4000-8000-000000000001', 'clock');
    await used(d, '00000000-0000-4000-8000-000000000002', 'notes');
    await used(d, '00000000-0000-4000-8000-000000000003', 'clock');
    await used(d, '00000000-0000-4000-8000-000000000003', 'notes');
    const ids = async (appIds?: readonly string[], query?: string) => (await searchMembers(d, null, undefined, { appIds, query }, NOW)).members.map((m) => m.user_id.slice(-1)).sort();
    assert.deepEqual(await ids(), ['1', '2', '3']);
    assert.deepEqual(await ids(['clock']), ['1', '3']);
    assert.deepEqual(await ids(['notes']), ['2', '3']);
    assert.deepEqual(await ids(['clock'], '00000000-0000-4000-8000-000000000002'), [], 'a keyword cannot widen the scope');
    assert.deepEqual(await ids([]), []);
  });
});
