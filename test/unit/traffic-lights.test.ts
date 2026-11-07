import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { trafficLights } from '../../src/web/traffic-lights';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const fine = { now: NOW, jobsStale: 0, cleanupWaiting: 0, cleanupAbandoned: 0, openTickets: 0, oldestOpenTicketAt: null, appStatuses: ['active', 'active'] };
const colors = (extra: object) => trafficLights({ ...fine, ...extra }).map((l) => l.color);

describe('admin home traffic lights', () => {
  test('everything fine is all green', () => {
    assert.deepEqual(colors({}), ['green', 'green', 'green', 'green']);
  });

  test('stale jobs and abandoned clean-ups are red, a waiting clean-up is yellow', () => {
    assert.equal(colors({ jobsStale: 1 })[0], 'red');
    assert.equal(colors({ cleanupWaiting: 2 })[1], 'yellow');
    assert.equal(colors({ cleanupWaiting: 2, cleanupAbandoned: 1 })[1], 'red');
  });

  test('tickets turn yellow after a day and red after three', () => {
    assert.equal(colors({ openTickets: 2, oldestOpenTicketAt: NOW - 2 * 3600_000 })[2], 'green');
    assert.equal(colors({ openTickets: 2, oldestOpenTicketAt: NOW - DAY - 1 })[2], 'yellow');
    assert.equal(colors({ openTickets: 2, oldestOpenTicketAt: NOW - 3 * DAY - 1 })[2], 'red');
  });

  test('a paused App is yellow and a killed one is red', () => {
    assert.equal(colors({ appStatuses: ['active', 'paused'] })[3], 'yellow');
    assert.equal(colors({ appStatuses: ['paused', 'killed'] })[3], 'red');
  });
});
