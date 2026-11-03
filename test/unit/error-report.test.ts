// Unit tests for Sentry error reporting without an SDK (spec tech stack: Sentry for the Worker).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseDsn, reportError, sentryEvent } from '../../src/lib/error-report';

const DSN = 'https://abc123publickey@o4501234.ingest.us.sentry.io/4507654321';

describe('Sentry error reporting', () => {
  test('DSN parsing', () => {
    assert.deepEqual(parseDsn(DSN), { endpoint: 'https://o4501234.ingest.us.sentry.io/api/4507654321/store/', publicKey: 'abc123publickey' });
    for (const bad of [undefined, '', 'not a url', 'http://k@sentry.io/1', 'https://sentry.io/1', 'https://k@sentry.io/abc']) assert.equal(parseDsn(bad), null, String(bad));
  });

  test('without a DSN nothing is sent', async () => {
    let calls = 0;
    assert.equal(await reportError(undefined, new Error('x'), { kind: 'request', environment: 'production' }, async () => (calls++, new Response())), false);
    assert.equal(calls, 0);
  });

  test('the event has the error and context only, and failures never throw', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const error = new TypeError('D1_ERROR: no such table: battery_accounts');
    const ok = await reportError(DSN, error, { kind: 'request', environment: 'staging', requestId: 'req-1', where: 'POST /v1/battery/reservations' }, async (url, init) => (sent.push({ url, init }), new Response('{}')), 1_793_690_000_000);
    assert.equal(ok, true);
    assert.equal(sent[0]?.url, 'https://o4501234.ingest.us.sentry.io/api/4507654321/store/');
    assert.match(String(new Headers(sent[0]?.init.headers).get('x-sentry-auth')), /sentry_key=abc123publickey/);
    const event = JSON.parse(String(sent[0]?.init.body));
    assert.equal(event.environment, 'staging');
    assert.equal(event.timestamp, 1_793_690_000);
    assert.deepEqual(event.tags, { kind: 'request', where: 'POST /v1/battery/reservations', request_id: 'req-1' });
    assert.deepEqual([event.exception.values[0].type, event.exception.values[0].value], ['TypeError', 'D1_ERROR: no such table: battery_accounts']);
    assert.ok(event.exception.values[0].stacktrace.frames.length > 0);
    assert.match(event.event_id, /^[0-9a-f]{32}$/);
    assert.deepEqual(Object.keys(event).sort(), ['environment', 'event_id', 'exception', 'level', 'logger', 'platform', 'server_name', 'tags', 'timestamp']);
    assert.equal(await reportError(DSN, error, { kind: 'scheduled', environment: 'production' }, async () => { throw new Error('offline'); }), false);
    assert.equal(sentryEvent('plain string', { kind: 'scheduled', environment: 'production' }, 0).level, 'error');
  });
});
