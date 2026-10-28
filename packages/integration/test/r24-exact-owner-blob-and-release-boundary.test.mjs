import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const file = (path) => readFileSync(new URL('../../../' + path, import.meta.url));
const json = (path) => JSON.parse(file(path).toString('utf8'));
const gitBlob = (buffer) => createHash('sha1')
  .update(Buffer.concat([Buffer.from('blob ' + buffer.length + '\0'), buffer]))
  .digest('hex');
const r24 = json('docs/operations/r24-20261028-all-owner-original-blob-integration.v1.json');
const prior = json('docs/operations/r23-20261028-four-owner-source-integration.v1.json');

test('new R24 sources exactly match 18 immutable final-head blobs across four owners and AI-0', () => {
  assert.equal(r24.state, 'REVIEW_CANDIDATE_OFFLINE_ONLY');
  assert.equal(r24.base.pr, 171);
  assert.equal(r24.sources.length, 5);
  const expected = {'AI-1':[172,4], 'AI-2':[174,3], 'AI-3':[173,3], 'AI-4':[175,3], 'AI-0':[176,5]};
  const paths = new Set();
  let total=0;
  for(const group of r24.sources){
    assert.deepEqual([group.pr,group.files.length],expected[group.owner]);
    assert.match(group.head,/^[a-f0-9]{40}$/);
    for(const item of group.files){
      assert.ok(!paths.has(item.path),'duplicate '+item.path);
      paths.add(item.path);
      assert.equal(gitBlob(file(item.path)),item.sha,'drift in final source '+item.path);
      total++;
    }
  }
  assert.equal(total,r24.total_new_original_blobs);
  assert.equal(total,18);
});

test('new intake checker and final corrected AI-1 test are preserved without replacing historical files', () => {
  const ai1=r24.sources.find(x=>x.owner==='AI-1');
  const ai0=r24.sources.find(x=>x.owner==='AI-0');
  assert.equal(ai1.head,'0e83fe7b31283a876a597809e42ddceff24d712a');
  assert.equal(ai1.files.find(f=>f.path.endsWith('r23-auth-g02-g03-live-preflight.test.mjs')).sha,
    'eeecc65052b6ca0e6a9f386a3d0b56e12b3efd84');
  assert.ok(!ai1.files.some(f=>f.sha==='690b11aba0c36553e1a1c20dabba814699bbe396'));
  assert.equal(ai0.pr,176);
  assert.ok(ai0.files.some(f=>f.path.endsWith('ai0-app-intake-evidence-gate.test.mjs')));
});

test('all previous R23 16 owner and portfolio Git blob identities remain unmodified', () => {
  assert.equal(prior.source_prs.length,5);
  let count=0;
  for(const group of prior.source_prs) for(const old of group.files){
    assert.equal(gitBlob(file(old.path)),old.blob_sha,'inherited R23 source drift '+old.path);
    count++;
  }
  assert.equal(count,16);
});

test('formal release gates stay blocked and R24 source manifests cannot grant external permissions', () => {
  const official=json('docs/release-readiness/release-readiness.v0.json');
  const inventory=json('docs/portfolio/starry-app-p0-governance.v0.json');
  assert.equal(official.gates.length,11);
  assert.ok(official.gates.every(g=>g.status==='blocked'));
  assert.equal(official.release_authorization.granted,false);
  assert.equal(official.deployment_automation.can_auto_deploy,false);
  assert.equal(r24.verification.release_gates_blocked,11);
  assert.equal(r24.verification.final_integrated_ci_status,'PENDING');
  assert.ok(Object.entries(r24.verification).every(([k,v])=>
    k==='exact_owner_blobs_checked_with_github_fetch_file' ? v===true :
    k==='release_gates_blocked' ? v===11 :
    k==='final_integrated_ci_status' ? v==='PENDING' :
    k==='product_approved_count' ? v===0 : v===false
  ));
  assert.ok(Object.values(r24.restrictions).every(v=>v===true));
  assert.equal(inventory.scope.approved_new_products,0);
  assert.equal(inventory.decisions.production_deployment_approved,false);
  assert.ok(inventory.p0_tests.every(x=>!x.may_deploy && !x.may_serve_ads && !x.may_grant_paid_entitlement));
});
