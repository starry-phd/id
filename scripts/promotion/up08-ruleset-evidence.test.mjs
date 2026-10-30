import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectUp08Evidence} from './up08-ruleset-evidence.mjs';

const sha = 'f153aa601e0a1971366edd9fc5e44b439d2f3c8f';
const ruleset = {
  name: 'Protect-main-Starry-ID', enforcement: 'active', target: 'branch',
  conditions: {ref_name: {include: ['~DEFAULT_BRANCH'], exclude: []}},
  bypass_actors: [],
  rules: [
    {type: 'pull_request'}, {type: 'deletion'}, {type: 'non_fast_forward'},
    {type: 'required_status_checks', parameters: {required_status_checks: [
      {context: 'Repository policy', integration_id: 15368},
      {context: 'Required validation', integration_id: 15368},
    ]}},
  ],
};
const run = {id: 40989834519, event: 'push', head_branch: 'main', head_sha: sha,
  status: 'completed', conclusion: 'success', name: 'Starry CI',
  html_url: 'https://github.com/starry-phd/id/actions/runs/40989834519'};
const jobs = ['Repository policy', 'App typecheck, lint and tests', 'Required validation']
  .map((name, i) => ({id: i + 1, run_id: run.id, name, status: 'completed', conclusion: 'success'}));
const inspect = (changes={}) => inspectUp08Evidence({ruleset, run, jobs, expectedSha: sha, ...changes});

test('UP08 valid source snapshots prove required status checks, NEVER release/deployment authority', () => {
  assert.deepEqual(inspect(), {up08_enforced: true, release_authorized: false,
    staging_authorized: false, ruleset_and_ci_verified: true, failures: []});
});
test('UP08 current GitHub ruleset: policy-only status check is NOT required validation enforcement', () => {
  const changed = structuredClone(ruleset);
  changed.rules.at(-1).parameters.required_status_checks.pop();
  const result = inspect({ruleset: changed});
  assert.equal(result.up08_enforced, false);
  assert.match(result.failures.join(' '), /Required validation/);
});
test('UP08 denies bypasses, disabled policies, wrong branches and wrong check origins', () => {
  for (const mutation of [
    x => x.enforcement = 'evaluate',
    x => x.target = 'repository',
    x => x.conditions.ref_name.include = ['refs/heads/dev'],
    x => x.conditions.ref_name.exclude = ['refs/heads/main'],
    x => x.bypass_actors.push({actor_id: 1}),
    x => x.rules.shift(),
    x => x.rules.at(-1).parameters.required_status_checks[1].integration_id = null,
    x => x.rules.at(-1).parameters.required_status_checks[0].integration_id = 100000,
    x => x.rules.at(-1).parameters.required_status_checks[1].integration_id = 999999,
    x => x.rules.at(-1).parameters.required_status_checks.push({context:'Required validation', integration_id:15368}),
  ]) {
    const bad = structuredClone(ruleset);
    mutation(bad);
    assert.equal(inspect({ruleset: bad}).up08_enforced, false);
  }
});
test('UP08 rejects mismatched SHA, PR-only runs, pending/skipped/cancelled jobs and missing job evidence', () => {
  for (const mutation of [
    x => x.head_sha = '0'.repeat(40),
    x => x.event = 'pull_request',
    x => x.head_branch = 'staging',
    x => x.status = 'queued',
    x => x.conclusion = 'cancelled',
    x => x.name = 'Different Workflow',
    x => delete x.id,
    x => x.id = 0,
    x => x.id = 41000266185,
    x => x.html_url = 'https://github.com/starry-phd/id/actions/runs/42',
  ]) {
    const bad = structuredClone(run); mutation(bad);
    assert.equal(inspect({run: bad}).up08_enforced, false);
  }
  for (const mutation of [
    x => x[2].conclusion = 'skipped',
    x => x[1].status = 'in_progress',
    x => x[0].run_id = 42,
    x => x.splice(2,1),
    x => x.push({...x[0]}),
  ]) {
    const bad = structuredClone(jobs); mutation(bad);
    assert.equal(inspect({jobs: bad}).up08_enforced, false);
  }
  assert.equal(inspect({jobs: null}).up08_enforced, false);
  assert.equal(inspect({expectedSha: 'short'}).up08_enforced, false);
  assert.equal(inspect({ruleset: null, run: null}).release_authorized, false);
});
