import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppEntry } from '../../src/apps/registry';
import { configToText, loadConfigOverrides, parseConfigText, saveConfigOverrides, withConfigOverrides } from '../../src/apps/status';
import { migratedDb } from '../support/sqlite-d1.mjs';

const app = { app_id: 'recordnote', min_version: '0.0.0', config: { keep: 'yes', notice: 'old' } } as unknown as AppEntry;
const actor = { userId: 'u', requestId: null };

test('the text box keeps types, ignores blank lines and explains the first mistake', () => {
  const ok = parseConfigText('new_feature = true\n\nmax_upload_mb = 20\nnotice = "週末維護"\nplain = hello\nmin_version = 1.2.0');
  assert.deepEqual(ok, { ok: true, values: { new_feature: true, max_upload_mb: 20, notice: '週末維護', plain: 'hello', min_version: '1.2.0' } });
  assert.equal(parseConfigText('NoCaps = 1').ok, false);
  assert.equal(parseConfigText('a = 1\na = 2').ok, false);
  assert.equal(parseConfigText('just words').ok, false);
  assert.equal(parseConfigText('min_version = abc').ok, false);
  assert.equal(parseConfigText(Array.from({ length: 31 }, (_, i) => `k${i} = 1`).join('\n')).ok, false);
  assert.equal(parseConfigText('x = ' + 'a'.repeat(201)).ok, false);
});

test('overrides are laid over the defaults, min_version included, and clearing restores them', async () => {
  const db = migratedDb('migrations/identity') as unknown as D1Database;
  await saveConfigOverrides(db, actor, 'recordnote', { notice: '週末維護', new_feature: true, min_version: '1.2.0' }, 1);
  const stored = await loadConfigOverrides(db, 'recordnote');
  assert.equal(configToText(stored), 'min_version = "1.2.0"\nnew_feature = true\nnotice = "週末維護"');
  assert.deepEqual(parseConfigText(configToText(stored)), { ok: true, values: stored }, 'what is shown can be saved back');
  const merged = await withConfigOverrides(db, app, Date.now());
  assert.equal(merged.min_version, '1.2.0');
  assert.deepEqual(merged.config, { keep: 'yes', notice: '週末維護', new_feature: true });
  await saveConfigOverrides(db, actor, 'recordnote', {}, 2);
  assert.equal((await withConfigOverrides(db, app, Date.now() + 60_000)).min_version, '0.0.0');
});
