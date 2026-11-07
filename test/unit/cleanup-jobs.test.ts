// Unit tests for the deletion clean-up retry queue and the job heartbeats.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanupBacklog, enqueueCleanup, MAX_ATTEMPTS, retryDelayMs, runCleanupJobById, runCleanupJobs } from '../../src/identity/cleanup-jobs';
import { markFinished, markStarted, readHeartbeats } from '../../src/lib/heartbeat';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const MIN = 60 * 1000;

describe('deletion clean-up retry queue', () => {
  test('a job waits for its first retry, then runs and disappears when it works', async () => {
    const d = migratedDb() as unknown as D1Database;
    await enqueueCleanup(d, 'battery', 'u-1', null, NOW);
    const ran: string[] = [];
    assert.deepEqual(await runCleanupJobs(d, NOW, async (k) => void ran.push(k)), { done: 0, retrying: 0, abandoned: 0 });
    assert.deepEqual(await runCleanupJobs(d, NOW + 2 * MIN, async (k, u) => void ran.push(`${k}:${u}`)), { done: 1, retrying: 0, abandoned: 0 });
    assert.deepEqual(ran, ['battery:u-1']);
    assert.deepEqual(await cleanupBacklog(d), { waiting: 0, abandoned: 0 });
  });

  test('a failing step is retried with a growing delay and abandoned after the last attempt', async () => {
    const d = migratedDb() as unknown as D1Database;
    await enqueueCleanup(d, 'avatar', 'u-2', 'avatars/886-1', NOW);
    let t = NOW + retryDelayMs(0);
    const seen: (string | null)[] = [];
    const fail = async (_k: string, _u: string, payload: string | null) => {
      seen.push(payload);
      throw new Error('R2 down');
    };
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      assert.deepEqual(await runCleanupJobs(d, t, fail), { done: 0, retrying: 1, abandoned: 0 });
      assert.deepEqual(await runCleanupJobs(d, t, fail), { done: 0, retrying: 0, abandoned: 0 }, 'not due again right away');
      t += retryDelayMs(attempt);
    }
    assert.deepEqual(await runCleanupJobs(d, t, fail), { done: 0, retrying: 0, abandoned: 1 });
    assert.equal(seen.length, MAX_ATTEMPTS);
    assert.ok(seen.every((p) => p === 'avatars/886-1'));
    assert.deepEqual(await cleanupBacklog(d), { waiting: 0, abandoned: 1 });
    assert.deepEqual(await runCleanupJobs(d, t + 24 * 60 * MIN, fail), { done: 0, retrying: 0, abandoned: 0 });
  });

  test('the delay doubles up to one hour', () => {
    assert.equal(retryDelayMs(0), MIN);
    assert.equal(retryDelayMs(3), 8 * MIN);
    assert.equal(retryDelayMs(10), 60 * MIN);
  });
});

describe('job heartbeats', () => {
  test('records start, success and the latest error separately', async () => {
    const d = migratedDb() as unknown as D1Database;
    await markStarted(d, 'minutely', NOW);
    await markFinished(d, 'minutely', NOW + 1, []);
    await markStarted(d, 'minutely', NOW + MIN);
    await markFinished(d, 'minutely', NOW + MIN + 1, ['reconcile: boom']);
    const [beat] = await readHeartbeats(d);
    assert.equal(beat?.job, 'minutely');
    assert.equal(beat?.last_started_at, NOW + MIN);
    assert.equal(beat?.last_success_at, NOW + 1);
    assert.equal(beat?.last_error_at, NOW + MIN + 1);
    assert.equal(beat?.last_error, 'reconcile: boom');
  });
});

describe('queue consumer step', () => {
  test('runs one job by id, retries with a delay, and ignores jobs that are gone', async () => {
    const d = migratedDb() as unknown as D1Database;
    const id = await enqueueCleanup(d, 'billing', 'u-3', null, NOW);
    const failing = async () => {
      throw new Error('down');
    };
    assert.deepEqual(await runCleanupJobById(d, id, NOW + MIN, failing), { status: 'retry', delayMs: retryDelayMs(1) });
    assert.deepEqual(await cleanupBacklog(d), { waiting: 1, abandoned: 0 });
    assert.deepEqual(await runCleanupJobById(d, id, NOW + 2 * MIN, async () => undefined), { status: 'done' });
    assert.deepEqual(await runCleanupJobById(d, id, NOW + 3 * MIN, async () => undefined), { status: 'missing' });
    assert.deepEqual(await cleanupBacklog(d), { waiting: 0, abandoned: 0 });
  });

  test('abandons a job after the last attempt and never runs it again', async () => {
    const d = migratedDb() as unknown as D1Database;
    const id = await enqueueCleanup(d, 'battery', 'u-4', null, NOW);
    const failing = async () => {
      throw new Error('down');
    };
    let last: unknown;
    for (let i = 0; i < MAX_ATTEMPTS; i++) last = await runCleanupJobById(d, id, NOW + (i + 1) * MIN, failing);
    assert.deepEqual(last, { status: 'abandoned' });
    assert.deepEqual(await runCleanupJobById(d, id, NOW + 99 * MIN, async () => undefined), { status: 'missing' });
    assert.deepEqual(await cleanupBacklog(d), { waiting: 0, abandoned: 1 });
  });
});
