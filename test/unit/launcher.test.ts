import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migratedDb } from '../support/sqlite-d1.mjs';
import { defaultWeb, launcherItems, listLauncherRows, moveLauncher, parseLauncherInput, removeLauncherIcon, resetLauncher, saveLauncherIcon, saveLauncherText, sniffImage } from '../../src/apps/launcher';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2]);

function bucket() {
  const store = new Map<string, Uint8Array>();
  return { store, put: async (k: string, v: Uint8Array) => void store.set(k, v), delete: async (k: string) => void store.delete(k) } as unknown as R2Bucket & { store: Map<string, Uint8Array> };
}

test('defaults: account centre first, no killed Apps, registry values', async () => {
  const db = migratedDb();
  const items = launcherItems(await listLauncherRows(db));
  assert.equal(items[0]?.appId, 'account');
  assert.equal(items[0]?.web, '/account');
});

test('text fields are validated and saved; empty means default', async () => {
  const db = migratedDb();
  assert.equal((await saveLauncherText(db, 'account', { name: '帳號', web: 'http://x.com', play: '', appstore: '', summary: '' }, 'u', 1)).ok, false);
  assert.equal(parseLauncherInput({ name: 'x'.repeat(41), web: '', play: '', appstore: '', summary: '' }, 'account').ok, false);
  assert.equal(parseLauncherInput({ name: '', web: '', play: 'javascript:alert(1)', appstore: '', summary: '' }, 'account').ok, false);
  assert.equal(parseLauncherInput({ name: '', web: '', play: '', appstore: '', summary: 'x'.repeat(61) }, 'account').ok, false);
  const ok = await saveLauncherText(db, 'account', { name: '我的帳號', web: '', play: 'https://play.google.com/store/apps/details?id=a', appstore: 'https://apps.apple.com/app/id1', summary: '登入中樞' }, 'u', 2);
  assert.equal(ok.ok, true);
  const item = launcherItems(await listLauncherRows(db)).find((i) => i.appId === 'account');
  assert.equal(item?.name, '我的帳號');
  assert.equal(item?.web, '/account');
  assert.equal(item?.summary, '登入中樞');
  assert.ok(item?.play?.startsWith('https://play.google.com'));
  assert.equal((await saveLauncherText(db, 'nope', { name: '', web: '', play: '', appstore: '', summary: '' }, 'u', 3)).ok, false);
});

test('icons: only real images within the size limit; replacing and removing delete the old object', async () => {
  const db = migratedDb();
  const r2 = bucket();
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal((await saveLauncherIcon(db, r2, 'account', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), 'u', 1)).ok, false);
  assert.equal((await saveLauncherIcon(db, r2, 'account', new Uint8Array(300 * 1024 + 1), 'u', 1)).ok, false);
  assert.equal((await saveLauncherIcon(db, r2, 'account', PNG, 'u', 1)).ok, true);
  assert.equal(r2.store.size, 1);
  assert.equal((await saveLauncherIcon(db, r2, 'account', PNG, 'u', 2)).ok, true);
  assert.equal(r2.store.size, 1, 'old icon removed');
  assert.ok((await listLauncherRows(db)).get('account')?.icon_key);
  await removeLauncherIcon(db, r2, 'account', 'u', 3);
  assert.equal(r2.store.size, 0);
  assert.equal((await listLauncherRows(db)).get('account')?.icon_key, null);
});

test('order: moving swaps neighbours, edges do nothing, reset returns to default', async () => {
  const db = migratedDb();
  const ids = launcherItems(await listLauncherRows(db), true).map((i) => i.appId);
  assert.equal(await moveLauncher(db, ids[0] as string, 'up', 'u', 1), false);
  if (ids.length > 1) {
    assert.equal(await moveLauncher(db, ids[0] as string, 'down', 'u', 2), true);
    const after = launcherItems(await listLauncherRows(db), true).map((i) => i.appId);
    assert.deepEqual(after.slice(0, 2), [ids[1], ids[0]]);
    await resetLauncher(db, undefined, ids[0] as string);
  }
});

test('default web address prefers the starry.phd origin over preview workers.dev ones', () => {
  assert.equal(defaultWeb(['https://recordnote-web-preview.starry-phd.workers.dev', 'https://recordnote.starry.phd']), 'https://recordnote.starry.phd');
  assert.equal(defaultWeb(['https://x.example.com']), 'https://x.example.com');
  assert.equal(defaultWeb([]), null);
});
