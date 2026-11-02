// Unit tests for the RevenueCat entitlement projection (S-BIL-04/05) and deletion (S-ID-06).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activeEntitlements, applyEvent, forgetMembers, parseWebhook, perAppSecrets, processPendingEvents,
  processRevenueCatDeletions, recordEvent, webhookAuthorized, type FetchLike,
} from '../../src/billing/revenuecat';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const USER = '01900000-0000-7000-8000-0000000000aa';
const billing = () => {
  const db = migratedDb('migrations/billing');
  return { db, d: db as unknown as D1Database };
};
let seq = 0;
function ev(type: string, extra: Record<string, unknown> = {}) {
  seq++;
  return parseWebhook({ api_version: '1.0', event: { id: `evt-${seq}`, type, app_user_id: USER, event_timestamp_ms: NOW + seq * 1000, entitlement_ids: ['pro'], product_id: 'echo_monthly', store: 'APP_STORE', environment: 'PRODUCTION', ...extra } })!;
}
const active = async (d: D1Database, at = NOW + DAY) => (await activeEntitlements(d, USER, 'echo', at)).map((e) => e.entitlement);

describe('RevenueCat webhook', () => {
  test('authorization accepts the configured value with or without Bearer, nothing else', () => {
    assert.equal(webhookAuthorized('Bearer s3cret', 's3cret'), true);
    assert.equal(webhookAuthorized('s3cret', 's3cret'), true);
    assert.equal(webhookAuthorized('Bearer wrong', 's3cret'), false);
    assert.equal(webhookAuthorized(undefined, 's3cret'), false);
    assert.equal(webhookAuthorized('Bearer s3cret', undefined), false);
  });

  test('parsing finds the Starry member, drops subscriber attributes and rejects junk', () => {
    const parsed = parseWebhook({ event: { id: 'e1', type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', USER], event_timestamp_ms: NOW, entitlement_ids: ['pro'], subscriber_attributes: { $email: { value: 'a@b.c' } } } });
    assert.equal(parsed?.event.appUserId, USER);
    assert.doesNotMatch(parsed!.stored, /a@b\.c|subscriber_attributes/);
    assert.equal(parseWebhook({ event: { id: 'x' } }), null);
    assert.equal(parseWebhook('nope'), null);
    assert.equal(parseWebhook({ event: { id: 'e2', type: 'TEST', app_user_id: 'anon', event_timestamp_ms: NOW } })?.event.appUserId, null);
  });

  test('events are stored once by event id', async () => {
    const { d } = billing();
    const e = ev('INITIAL_PURCHASE');
    assert.equal(await recordEvent(d, 'echo', e, NOW), 'new');
    assert.equal(await recordEvent(d, 'echo', e, NOW), 'duplicate');
  });
});

describe('entitlement projection', () => {
  test('purchase, renewal, cancellation (still active), expiration', async () => {
    const { d } = billing();
    await applyEvent(d, 'echo', ev('INITIAL_PURCHASE', { expiration_at_ms: NOW + 30 * DAY }).event, NOW);
    assert.deepEqual(await active(d), ['pro']);
    await applyEvent(d, 'echo', ev('CANCELLATION', { cancel_reason: 'UNSUBSCRIBE', expiration_at_ms: NOW + 30 * DAY }).event, NOW);
    assert.deepEqual(await active(d), ['pro'], 'turning off auto-renew keeps access until expiry');
    assert.deepEqual(await active(d, NOW + 31 * DAY), [], 'past expiry is never active');
    await applyEvent(d, 'echo', ev('EXPIRATION', { expiration_at_ms: NOW + 30 * DAY }).event, NOW);
    assert.deepEqual(await active(d), []);
  });

  test('a refund revokes; a late, older event never overrides a newer one', async () => {
    const { d } = billing();
    const older = ev('RENEWAL', { expiration_at_ms: NOW + 60 * DAY });
    await applyEvent(d, 'echo', ev('INITIAL_PURCHASE', { expiration_at_ms: NOW + 30 * DAY }).event, NOW);
    await applyEvent(d, 'echo', ev('CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT', expiration_at_ms: NOW }).event, NOW);
    assert.deepEqual(await active(d), []);
    await applyEvent(d, 'echo', older.event, NOW);
    assert.deepEqual(await active(d), [], 'older renewal arriving late is ignored');
  });

  test('a lifetime purchase survives subscription expiry but not its own refund', async () => {
    const { d } = billing();
    await applyEvent(d, 'echo', ev('INITIAL_PURCHASE', { expiration_at_ms: NOW + 30 * DAY }).event, NOW);
    await applyEvent(d, 'echo', ev('NON_RENEWING_PURCHASE', { product_id: 'echo_lifetime', expiration_at_ms: null }).event, NOW);
    await applyEvent(d, 'echo', ev('EXPIRATION', { expiration_at_ms: NOW + 30 * DAY }).event, NOW);
    assert.deepEqual(await active(d, NOW + 400 * DAY), ['pro']);
    await applyEvent(d, 'echo', ev('CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT', product_id: 'echo_monthly' }).event, NOW);
    assert.deepEqual(await active(d, NOW + 400 * DAY), ['pro'], 'refund of the subscription keeps the lifetime purchase');
    await applyEvent(d, 'echo', ev('CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT', product_id: 'echo_lifetime' }).event, NOW);
    assert.deepEqual(await active(d, NOW + 400 * DAY), []);
  });

  test('entitlements never cross Apps, and transfers move access between members', async () => {
    const { d } = billing();
    const other = '01900000-0000-7000-8000-0000000000bb';
    await applyEvent(d, 'echo', ev('INITIAL_PURCHASE', { expiration_at_ms: NOW + 30 * DAY }).event, NOW);
    assert.deepEqual(await activeEntitlements(d, USER, 'another-app', NOW), []);
    await applyEvent(d, 'echo', ev('TRANSFER', { transferred_from: [USER], transferred_to: [other], expiration_at_ms: NOW + 30 * DAY }).event, NOW);
    assert.deepEqual(await active(d), []);
    assert.deepEqual((await activeEntitlements(d, other, 'echo', NOW)).map((e) => e.entitlement), ['pro']);
  });

  test('stored events are processed asynchronously and only once', async () => {
    const { d } = billing();
    await recordEvent(d, 'echo', ev('INITIAL_PURCHASE', { expiration_at_ms: NOW + 30 * DAY }), NOW);
    assert.deepEqual(await processPendingEvents(d, NOW), { processed: 1, failed: 0 });
    assert.deepEqual(await processPendingEvents(d, NOW), { processed: 0, failed: 0 });
    assert.deepEqual(await active(d), ['pro']);
  });
});

describe('account deletion in billing (S-ID-06)', () => {
  test('forgets the member, de-identifies events and deletes the RevenueCat customer', async () => {
    const { db, d } = billing();
    await recordEvent(d, 'echo', ev('INITIAL_PURCHASE', { expiration_at_ms: NOW + 30 * DAY }), NOW);
    await processPendingEvents(d, NOW);
    await forgetMembers(d, [USER], ['echo'], NOW);
    assert.deepEqual(await active(d), []);
    assert.deepEqual(await db.prepare('SELECT app_user_id, payload FROM rc_events').first(), { app_user_id: 'deleted', payload: '{}' });
    const calls: string[] = [];
    const ok: FetchLike = async (url, init) => {
      calls.push(`${init?.method} ${url} ${(init?.headers as Record<string, string>).authorization}`);
      return new Response(null, { status: 404 });
    };
    assert.deepEqual(await processRevenueCatDeletions(d, { echo: 'sk_test' }, ok, NOW), { deleted: 1, failed: 0, abandoned: 0 });
    assert.deepEqual(calls, [`DELETE https://api.revenuecat.com/v1/subscribers/${USER} Bearer sk_test`]);
  });

  test('without an API key the job waits and is abandoned after 10 attempts', async () => {
    const { db, d } = billing();
    await forgetMembers(d, [USER], ['echo'], NOW);
    assert.deepEqual(await processRevenueCatDeletions(d, {}, async () => assert.fail('no call'), NOW), { deleted: 0, failed: 1, abandoned: 0 });
    await db.prepare('UPDATE revenuecat_deletions SET attempts = 9, next_attempt_at = ?').bind(NOW).run();
    assert.deepEqual(await processRevenueCatDeletions(d, {}, async () => assert.fail('no call'), NOW), { deleted: 0, failed: 0, abandoned: 1 });
  });

  test('per-App secrets parse safely', () => {
    assert.deepEqual(perAppSecrets('{"echo":"a","bad":1}'), { echo: 'a' });
    assert.deepEqual(perAppSecrets('nope'), {});
    assert.deepEqual(perAppSecrets(undefined), {});
  });
});
