import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { buildReviewQueue, loadReviewQueue } from '../../../docs/requirements/ai0-w1-review-queue.mjs';

const directory = new URL('../../../docs/requirements/', import.meta.url);
const fixture = () => ({
  inventory: JSON.parse(readFileSync(new URL('original-inventory.v0.json', directory), 'utf8')),
  reconciliation: JSON.parse(readFileSync(new URL('source-reconciliation-r8.v0.json', directory), 'utf8')),
});
test('actual pinned 128 sources retain every source ID without approval promotion', () => {
  const result = loadReviewQueue();
  assert.equal(result.source_count, 128);
  assert.equal(new Set(result.entries.map(row => row.source_id)).size, 128);
  assert.deepEqual(result.counts, {
    P0_SUPPORT_REVIEW: 12, P0_CENTRAL_ID_REVIEW: 22,
    RETAINED_FOR_LATER_SCOPE_REVIEW: 71, OUT_OF_SCOPE_PAUSED: 19, DEFERRED_EXISTING_SOURCE: 4,
  });
  assert.equal(result.g00_pass, false);
  assert.ok(result.entries.every(row => !row.clause_semantics_approved_by_this_projection
    && !row.live_verified && !row.may_execute_external_actions && !row.release_authorized));
});
test('old autosave and cross-brand SSO stay superseded, not restored by P0 routing', () => {
  const result = loadReviewQueue();
  for (const id of ['02.07','01.05']) {
    const row = result.entries.find(entry => entry.source_id === id);
    assert.equal(row.source_decision_class, 'superseded_by_latest');
    assert.equal(row.review_lane, 'P0_CENTRAL_ID_REVIEW');
    assert.equal(row.clause_semantics_approved_by_this_projection, false);
  }
});
test('duplicate, missing and unknown source IDs fail closed', () => {
  for (const change of [
    data => data.reconciliation.entries.push(data.reconciliation.entries[0]),
    data => data.reconciliation.entries.pop(),
    data => { data.reconciliation.entries[0].source_id = 'INVENTED-13TH-FIELD'; },
    data => data.inventory.entries.push(data.inventory.entries[0]),
  ]) {
    const data = fixture(); change(data);
    assert.throws(() => buildReviewQueue(data.inventory, data.reconciliation));
  }
});
test('title drift and malformed references fail instead of producing plausible output', () => {
  let data = fixture();
  data.reconciliation.entries[0].source_title = 'incorrect title';
  assert.throws(() => buildReviewQueue(data.inventory, data.reconciliation), /SOURCE_TITLE_MISMATCH/);
  data = fixture(); data.reconciliation.entries[0].decision_refs = [null];
  assert.throws(() => buildReviewQueue(data.inventory, data.reconciliation), /INVALID_DECISION_REFS/);
});
test('future unknown decision classes are visible and remain unapproved', () => {
  const data = fixture();
  data.reconciliation.entries[0].decision_class = 'future_auto_approved';
  data.reconciliation.entries[0].release_authorized = true;
  const row = buildReviewQueue(data.inventory, data.reconciliation).entries[0];
  assert.equal(row.unrecognized_class, true);
  assert.equal(row.release_authorized, false);
  assert.equal(row.clause_semantics_approved_by_this_projection, false);
});
test('changed disk source is rejected by immutable Git blob pin', () => {
  const temp = mkdtempSync(join(tmpdir(), 'starry-w1-'));
  try {
    for (const name of ['original-inventory.v0.json','source-reconciliation-r8.v0.json']) {
      writeFileSync(join(temp, name), readFileSync(new URL(name, directory)));
    }
    assert.equal(loadReviewQueue(temp).source_count, 128);
    writeFileSync(join(temp, 'original-inventory.v0.json'), '{}');
    assert.throws(() => loadReviewQueue(temp), /SOURCE_PIN_MISMATCH/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
