import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const source = (relative) => readFileSync(new URL('../../../' + relative, import.meta.url));
const json = (relative) => JSON.parse(source(relative).toString('utf8'));
const blobSha = (bytes) => createHash('sha1')
  .update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes]))
  .digest('hex');

const integrationPath = 'docs/operations/r23-20261028-four-owner-source-integration.v1.json';
const originalPath = 'docs/operations/sbase-20261028-original-source-integration.v0.json';
const officialPath = 'docs/release-readiness/release-readiness.v0.json';
const p0Path = 'docs/portfolio/starry-app-p0-governance.v0.json';

test('AI-0 R23 integrates exact 16 immutable original Git blobs from all four Owners and P0 planning', () => {
  const m = json(integrationPath);
  assert.equal(m.state, 'REVIEW_CANDIDATE_ONLY_NOT_LIVE');
  assert.equal(m.base.pr, 165);
  assert.equal(m.base.inherited_sbase_pr, 164);
  assert.equal(m.source_prs.length, 5);
  const expected = { 'AI-1': [167, 3], 'AI-2': [169, 4], 'AI-3': [168, 3], 'AI-4': [166, 3], 'AI-0': [170, 3] };
  const seen = new Set();
  let checked = 0;
  for (const group of m.source_prs) {
    assert.ok(Object.hasOwn(expected, group.owner));
    assert.equal(group.pr, expected[group.owner][0]);
    assert.equal(group.files.length, expected[group.owner][1]);
    assert.match(group.head_sha, /^[0-9a-f]{40}$/);
    for (const file of group.files) {
      assert.ok(!seen.has(file.path), 'source filename collision');
      seen.add(file.path);
      assert.match(file.path, /^(apps|modules|packages|docs)\//);
      assert.match(file.blob_sha, /^[0-9a-f]{40}$/);
      assert.equal(blobSha(source(file.path)), file.blob_sha, 'drift in original source: ' + file.path);
      checked++;
    }
  }
  assert.equal(checked, m.expected_source_file_count);
  assert.equal(checked, 16);
});

test('new R23 owner integration preserves all 18 exact SBASE #164 source Git blobs', () => {
  const m = json(originalPath);
  assert.equal(m.owner_blobs, 13);
  assert.equal(m.ai0_blobs, 5);
  let checked = 0;
  for (const group of [...m.owner_sources, ...m.ai0_sources]) {
    for (const file of group.files) {
      assert.equal(blobSha(source(file.path)), file.blob_sha, 'drift in inherited SBASE source: ' + file.path);
      checked++;
    }
  }
  assert.equal(checked, 18);
});

test('integrated R23 preflight and portfolio do not override official release gate or grant App rights', () => {
  const m = json(integrationPath);
  const official = json(officialPath);
  const p0 = json(p0Path);
  assert.equal(official.gates.length, 11);
  assert.ok(official.gates.every((g) => g.status === 'blocked'));
  assert.equal(official.release_authorization.granted, false);
  assert.equal(official.deployment_automation.can_auto_deploy, false);
  assert.equal(m.gate_summary.official_release_gates_blocked, 11);
  assert.ok(Object.entries(m.gate_summary).every(([key, value]) =>
    key === 'official_release_gates_blocked' ? value === 11 : value === false));
  assert.ok(Object.values(m.other).every((value) => value === true));
  assert.equal(p0.p0_tests.length, 3);
  assert.equal(p0.portfolio_hypotheses.length, 12);
  assert.equal(p0.decisions.production_deployment_approved, false);
  assert.equal(p0.decisions.store_sandbox_approved, false);
  assert.equal(p0.scope.approved_new_products, 0);
  assert.ok(p0.p0_tests.every((item) =>
    !item.product_approved && !item.may_deploy && !item.may_serve_ads &&
    !item.may_grant_paid_entitlement && item.store_sku === null));
  assert.ok(p0.portfolio_hypotheses.every((item) =>
    !item.approved && !item.implemented && item.score === null));
});
