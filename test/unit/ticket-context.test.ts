import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanContext, createTicket, getTicket, listTickets } from '../../src/support/tickets';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const input = { userId: 'u1', contactEmail: null, category: 'question' as const, message: '壞了', clientIp: '1.2.3.4' };

async function members(d: D1Database, ...ids: string[]): Promise<void> {
  for (const id of ids) await d.prepare("INSERT INTO users (user_id, status, created_at, updated_at, status_changed_at, session_version) VALUES (?, 'active', ?, ?, ?, 1)").bind(id, NOW, NOW, NOW).run();
}

describe('support ticket context and App filter', () => {
  test('a ticket keeps the App version and device an App passed, cleaned to plain text', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    await members(d, 'u1');
    const r = await createTicket(d, { ...input, appId: 'clock', appVersion: '1.4.2 (88)', device: 'iPhone 15 Pro<script>' }, NOW);
    assert.ok(r.ok);
    const t = await getTicket(d, r.ok ? r.ticketId : '');
    assert.equal(t?.app_version, '1.4.2 (88)');
    assert.equal(t?.device, 'iPhone 15 Proscript', 'angle brackets are dropped');
  });

  test('context is optional and over-long values are cut', () => {
    assert.equal(cleanContext(undefined, 40), null);
    assert.equal(cleanContext('   ', 40), null);
    assert.equal(cleanContext('x'.repeat(100), 40)?.length, 40);
  });

  test('the list can be limited to one App or to tickets that name none', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    await members(d, 'u1', 'u2', 'u3');
    await createTicket(d, { ...input, userId: 'u1', appId: 'clock' }, NOW);
    await createTicket(d, { ...input, userId: 'u2', appId: 'echo' }, NOW + 1);
    await createTicket(d, { ...input, userId: 'u3', appId: null }, NOW + 2);
    const apps = async (appId?: string) => (await listTickets(d, { status: 'open', appId })).tickets.map((t) => t.app_id ?? '(none)').sort();
    assert.deepEqual(await apps(), ['(none)', 'clock', 'echo']);
    assert.deepEqual(await apps('clock'), ['clock']);
    assert.deepEqual(await apps('-'), ['(none)']);
    assert.deepEqual(await apps('nope'), []);
  });
});
