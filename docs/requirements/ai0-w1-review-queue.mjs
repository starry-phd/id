import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const pins = Object.freeze({
  'original-inventory.v0.json': '7a3131bc1a92d73145091a8bae51cb4aa135780c',
  'source-reconciliation-r8.v0.json': '13f386a9c1defd2ac945e2235f5e237bafa07057',
});
export function gitBlobSha(buffer) {
  return createHash('sha1').update('blob ' + buffer.byteLength + '\0').update(buffer).digest('hex');
}
const core = new Set(['01.01','01.02','01.03','01.04','01.05','01.06','01.07','01.08','02.01','02.02','02.03','02.04','02.07','02.08','02.09','02.10','05.01','05.04','05.05','05.06','05.08','05.09']);
const support = new Set(['P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','N01','N02']);
const recognized = new Set(['owner_approved_release_blocked','partially_approved_details_pending','superseded_by_latest','candidate_no_owner_approval','hglobal_paused','ai_proposal_gate_pending','deferred_from_first_release']);
function indexUnique(rows, key, label) {
  if (!Array.isArray(rows)) throw new Error(label + ': missing entries');
  const map = new Map();
  for (const row of rows) {
    const id = row?.[key];
    if (typeof id !== 'string' || !id || map.has(id)) throw new Error(label + ': invalid or duplicate source ID');
    map.set(id, row);
  }
  return map;
}
/** Read-only review projection; no field grants implementation or release authority. */
export function buildReviewQueue(inventory, reconciliation) {
  const originals = indexUnique(inventory.entries, 'id', 'inventory');
  const reviews = indexUnique(reconciliation.entries, 'source_id', 'reconciliation');
  if (originals.size !== 128 || reviews.size !== originals.size) throw new Error('SOURCE_COVERAGE_MISMATCH');
  for (const id of reviews.keys()) if (!originals.has(id)) throw new Error('UNKNOWN_SOURCE_ID:' + id);
  const entries = [...originals].map(([id, source]) => {
    const row = reviews.get(id);
    if (!row || row.source_title !== source.title) throw new Error('SOURCE_TITLE_MISMATCH:' + id);
    if (!Array.isArray(row.decision_refs) || row.decision_refs.some(ref => typeof ref !== 'string')) throw new Error('INVALID_DECISION_REFS:' + id);
    if (typeof row.decision_class !== 'string' || typeof row.reconciliation_note !== 'string') throw new Error('INVALID_REVIEW:' + id);
    // Unknown future classes stay review-only rather than silently becoming approved.
    const sourceClass = row.decision_class;
    const paused = sourceClass === 'hglobal_paused';
    const lane = paused ? 'OUT_OF_SCOPE_PAUSED' : sourceClass === 'deferred_from_first_release' ? 'DEFERRED_EXISTING_SOURCE' : core.has(id) ? 'P0_CENTRAL_ID_REVIEW'
      : support.has(id) ? 'P0_SUPPORT_REVIEW' : 'RETAINED_FOR_LATER_SCOPE_REVIEW';
    return {
      source_id: id, title: source.title, source_decision_class: sourceClass,
      decision_refs: [...row.decision_refs], source_review_note: row.reconciliation_note,
      review_lane: lane, unrecognized_class: !recognized.has(sourceClass),
      clause_semantics_approved_by_this_projection: false,
      implementation_status: 'NOT_INFERRED_FROM_HEADING_OR_HISTORICAL_INDEX',
      live_verified: false, may_execute_external_actions: false, release_authorized: false,
    };
  });
  const counts = {};
  for (const entry of entries) counts[entry.review_lane] = (counts[entry.review_lane] ?? 0) + 1;
  return {
    schema_version: 'starry.ai0.w1.source-review-queue.v1',
    record_class: 'READ_ONLY_REVIEW_ROUTING_NOT_REQUIREMENT_APPROVAL',
    baseline_sha: '22d7ab1c127546e9e131810d58fdf7e0ccb17882',
    acceptance_strategy_decision: 'https://github.com/starry-phd/id/issues/1#issuecomment-6479057455',
    source_pins: pins, counts, source_count: entries.length,
    g00_pass: false, p05_publishable: false, release_authorized: false, entries,
  };
}
export function loadReviewQueue(directory = new URL('./', import.meta.url)) {
  const read = name => {
    const path = directory instanceof URL ? new URL(name, directory) : resolve(directory, name);
    const bytes = readFileSync(path);
    if (gitBlobSha(bytes) !== pins[name]) throw new Error('SOURCE_PIN_MISMATCH:' + name);
    return JSON.parse(bytes.toString('utf8'));
  };
  return buildReviewQueue(read('original-inventory.v0.json'), read('source-reconciliation-r8.v0.json'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(loadReviewQueue(), null, 2) + '\n');
}
