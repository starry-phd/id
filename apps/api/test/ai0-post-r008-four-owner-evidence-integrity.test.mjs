import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const json = path => JSON.parse(read(path).toString('utf8'));
const manifest = json('docs/ai/AI0-POST-R008-FOUR-OWNER-GATE-EVIDENCE-MANIFEST.v1.json');
const official = json('docs/release-readiness/release-readiness.v0.json');

test('AI-0 imports exactly four immutable owner deliveries / nine unique original files', () => {
  assert.equal(manifest.owner_deliveries.length, 4);
  const files = manifest.owner_deliveries.flatMap(owner => owner.files);
  assert.equal(files.length, 9);
  assert.equal(new Set(files.map(file => file.path)).size, 9);
  assert.deepEqual(manifest.owner_deliveries.map(owner => owner.owner).sort(), ['AI-1','AI-2','AI-3','AI-4']);
  assert.equal(manifest.integrity.owner_original_paths_modified, 0);
});

test('all nine original Owner Git blob SHA-1 values are byte-for-byte preserved', () => {
  for (const owner of manifest.owner_deliveries) {
    for (const file of owner.files) {
      const buffer = read(file.path);
      const sha = createHash('sha1').update('blob ' + buffer.byteLength + '\0').update(buffer).digest('hex');
      assert.equal(sha, file.blob_sha, owner.owner + ': ' + file.path);
    }
  }
});

test('AI-1 / AI-2 / AI-3 approval inputs remain unapproved and non-live', () => {
  const auth = json('modules/starry-id-v1/G02-G03-REAL-EVIDENCE-APPROVALS.v1.json');
  assert.equal(auth.owner_authored_approval, false);
  assert.equal(auth.approval_dependencies.length, 9);
  assert.ok(auth.approval_dependencies.every(dep => dep.approved === false));
  assert.ok(auth.gates.every(g => g.release_status === 'blocked' && g.evidence_urls.length === 0));
  const billing = json('packages/rebuild-billing/docs/POST-R008-G04-G05-AUTHORITY-APPROVAL-MATRIX.v1.json');
  const requests = billing.gates.flatMap(g => g.requests);
  assert.equal(requests.length, 13);
  assert.ok(requests.every(r => r.approval_required === true));
  assert.equal(billing.operative_flags.can_grant, false);
  assert.equal(billing.operative_flags.can_publish, false);
  const audit = json('packages/rebuild-ai3/docs/G07-R008-REAL-EVIDENCE-APPROVAL-MATRIX.v1.json');
  assert.equal(audit.items.length, 8);
  assert.ok(audit.items.every(item => item.gate === 'blocked'));
  assert.equal(audit.approved_live_testing, false);
});

test('AI-4 source-linked evidence is not release authorization', () => {
  const mobile = json('docs/operations/ai4-post-r008-g08-g09-evidence-provenance.v1.json');
  assert.equal(mobile.gates.length, 2);
  assert.ok(mobile.gates.every(g => g.status === 'blocked' && g.release_evidence_count === 0));
  assert.equal(mobile.release.release_authorization_granted, false);
  assert.equal(mobile.release.staging_deploy_authorized, false);
});

test('official release Gates stay blocked and evidence empty with no deployment authority', () => {
  assert.equal(official.gates.length, 11);
  assert.ok(official.gates.every(g => g.status === 'blocked' && Array.isArray(g.evidence) && g.evidence.length === 0));
  assert.equal(official.release_authorization.granted, false);
  assert.equal(official.deployment_automation.can_auto_deploy, false);
  assert.equal(manifest.release_guard.release_authorization_granted, false);
  assert.equal(manifest.release_guard.main_merge_authorized, false);
  assert.equal(manifest.release_guard.p05_publishable, false);
});

test('the imported follow-ons share a common parent and cannot claim a combined CI prematurely', () => {
  assert.equal(manifest.shared_parent.sha, 'ac99611e00c32c0f5945fb9989807b0dd2dda1a9');
  assert.equal(manifest.source_preserving_parent.sha, 'a3a1cd2227e15327c3949cafac4d57197a192c72');
  assert.equal(manifest.r008_four_owner_gate2.result, 'OFFLINE_ONLY_PASS');
  assert.ok(manifest.owner_deliveries.every(owner => owner.workflow_runs.length >= 1));
  assert.ok(manifest.static_only_limits.some(s => s.includes('cannot be claimed as a combined-SHA pass')));
});
