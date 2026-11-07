import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { catalogHandoffLines, listCatalog, removeCatalogProduct, saveCatalogProduct } from '../../src/apps/catalog';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const base = { appId: 'clock', actorUserId: 'owner1' };

describe('product catalog', () => {
  test('saves, updates and removes a product, and lists it for the handoff', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    assert.deepEqual(await saveCatalogProduct(d, { ...base, sku: 'pro-monthly', kind: 'subscription', iosProductId: 'phd.starry.clock.pro.m', androidProductId: 'clock_pro_m', entitlement: 'pro' }, NOW), { ok: true });
    assert.deepEqual(await saveCatalogProduct(d, { ...base, sku: 'pro-monthly', kind: 'subscription', iosProductId: 'phd.starry.clock.pro.month', entitlement: 'pro', note: '月訂' }, NOW), { ok: true });
    const [p] = await listCatalog(d, 'clock');
    assert.equal(p?.ios_product_id, 'phd.starry.clock.pro.month');
    assert.equal(p?.android_product_id, null, 'an update replaces the whole row');
    assert.deepEqual(catalogHandoffLines([p!]), ['- pro-monthly（訂閱）｜iOS：phd.starry.clock.pro.month｜權益：pro｜備註：月訂']);
    assert.deepEqual(await listCatalog(d, 'other'), [], 'other Apps do not see it');
    await removeCatalogProduct(d, 'clock', 'pro-monthly');
    assert.deepEqual(await listCatalog(d, 'clock'), []);
  });

  test('bad input is refused with a readable reason', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    const bad = async (extra: object) => (await saveCatalogProduct(d, { ...base, sku: 'ok-sku', kind: 'one_time', iosProductId: 'a.b', entitlement: 'pro', ...extra }, NOW)).ok;
    assert.equal(await bad({ sku: 'Bad Sku' }), false);
    assert.equal(await bad({ kind: 'gift' }), false);
    assert.equal(await bad({ iosProductId: '', androidProductId: '' }), false, 'needs at least one store ID');
    assert.equal(await bad({ iosProductId: 'has space' }), false);
    assert.equal(await bad({ entitlement: '' }), false, 'a subscription or one-time product needs an entitlement');
    assert.equal(await bad({ kind: 'quantum', entitlement: '' }), true, 'a Quantum pack needs none');
    assert.equal(await bad({ note: 'x'.repeat(201) }), false);
  });

  test('an App holds at most 50 products and an empty catalog tells the AI not to invent any', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    for (let i = 0; i < 50; i++) assert.equal((await saveCatalogProduct(d, { ...base, sku: `p${i}`, kind: 'one_time', iosProductId: `a.${i}`, entitlement: 'pro' }, NOW)).ok, true);
    assert.equal((await saveCatalogProduct(d, { ...base, sku: 'p50', kind: 'one_time', iosProductId: 'a.50', entitlement: 'pro' }, NOW)).ok, false);
    assert.equal((await saveCatalogProduct(d, { ...base, sku: 'p0', kind: 'one_time', iosProductId: 'a.new', entitlement: 'pro' }, NOW)).ok, true, 'editing an existing one is fine');
    assert.match(catalogHandoffLines([])[0] ?? '', /沒有登記任何商店商品/);
  });
});
