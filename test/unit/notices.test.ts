import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNotices, saveNotices } from '../../src/lib/notices';
import { migratedDb } from '../support/sqlite-d1.mjs';

test('notices default to off, save together, clear with empty text and refuse over-long text', async () => {
  const d = migratedDb('migrations/identity') as unknown as D1Database;
  assert.deepEqual(await getNotices(d), { announcement: '', maintenance: false, maintenanceMessage: '' });
  assert.equal(await saveNotices(d, { announcement: ' 週末維護 ', maintenance: true, maintenanceMessage: '約 1 小時' }, 'u', 1), true);
  assert.deepEqual(await getNotices(d), { announcement: '週末維護', maintenance: true, maintenanceMessage: '約 1 小時' });
  assert.equal(await saveNotices(d, { announcement: 'x'.repeat(501), maintenance: false, maintenanceMessage: '' }, 'u', 2), false);
  assert.equal(await saveNotices(d, { announcement: '', maintenance: false, maintenanceMessage: '' }, 'u', 3), true);
  assert.deepEqual(await getNotices(d), { announcement: '', maintenance: false, maintenanceMessage: '' });
});
