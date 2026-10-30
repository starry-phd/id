/**
 * AI-0 UP-08: independent, read-only GitHub Ruleset/CI evidence inspection.
 * This never calls GitHub or grants release, merge, staging or production access.
 * Supply genuine GitHub REST responses; passing synthetic fixtures is NOT live evidence.
 */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha40 = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const isPass = value => record(value) && value.status === 'completed' && value.conclusion === 'success';
const EXPECTED_JOBS = ['App typecheck, lint and tests', 'Repository policy', 'Required validation'];
const EXPECTED_CHECKS = ['Repository policy', 'Required validation'];
// Fixed GitHub Actions App ID observed in the approved live GitHub Ruleset GET.
// This is a source-origin consistency gate, NOT proof that supplied JSON is live.
const GITHUB_ACTIONS_APP_ID = 15368;
const EXPECTED_RULESET_ID = 25839375;
const EXPECTED_REPOSITORY = 'starry-phd/id';
const EXPECTED_REPOSITORY_ID = 1433637276;
const EXPECTED_WORKFLOW_PATH = '.github/workflows/starry-ci.yml';

export function inspectUp08Evidence({ruleset, run, jobs, expectedSha}) {
  const failures = [];
  const fail = message => failures.push(message);
  if (!sha40(expectedSha)) fail('expectedSha must be an exact 40-character lowercase commit SHA');

  // GitHub GET /repos/{owner}/{repo}/rulesets/{ruleset_id}
  if (!record(ruleset)) fail('GitHub Ruleset response missing');
  else {
    if (ruleset.name !== 'Protect-main-Starry-ID' || ruleset.enforcement !== 'active' ||
      ruleset.target !== 'branch') fail('main ruleset is not the active approved branch ruleset');
    // Name-only matching can accept another repository's similar-looking ruleset.
    // Bind the supplied snapshot to this exact repository/ruleset; this still
    // does not authenticate the snapshot or replace a fresh REST readback.
    if (ruleset.id !== EXPECTED_RULESET_ID ||
      ruleset.source_type !== 'Repository' || ruleset.source !== EXPECTED_REPOSITORY ||
      ruleset.current_user_can_bypass !== 'never')
      fail('ruleset ID, repository origin or no-bypass provenance is unverified');
    const ref = ruleset.conditions?.ref_name;
    if (!record(ref) || !Array.isArray(ref.include) || !ref.include.includes('~DEFAULT_BRANCH') ||
      !Array.isArray(ref.exclude) || ref.exclude.length !== 0)
      fail('default branch protection reference is absent or excluded');
    if (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length !== 0)
      fail('ruleset bypass actors are present or not verifiably empty');
    if (!Array.isArray(ruleset.rules)) fail('ruleset rules are unavailable');
    else {
      for (const kind of ['pull_request', 'non_fast_forward', 'deletion']) {
        if (!ruleset.rules.some(rule => rule?.type === kind)) fail('missing main restriction ' + kind);
      }
      const required = ruleset.rules.filter(rule => rule?.type === 'required_status_checks');
      if (required.length !== 1) fail('expected exactly one required_status_checks rule');
      else {
        const params = required[0]?.parameters;
        const contexts = params?.required_status_checks;
        if (!Array.isArray(contexts)) fail('required check contexts are unavailable');
        else {
          const all = contexts.map(c => c?.context);
          for (const name of EXPECTED_CHECKS) {
            if (all.filter(x => x === name).length !== 1)
              fail('required GitHub status check missing/duplicated: ' + name);
          }
          if (new Set(all).size !== all.length ||
            contexts.some(c => !record(c) || typeof c.context !== 'string' ||
              !Number.isInteger(c.integration_id) || c.integration_id !== GITHUB_ACTIONS_APP_ID))
            fail('required check origin is ambiguous or duplicate');
        }
      }
    }
  }

  // GitHub GET /repos/{owner}/{repo}/actions/runs/{run_id}
  if (!record(run)) fail('exact GitHub Actions workflow run response missing');
  else {
    if (!Number.isSafeInteger(run.id) || run.id <= 0 ||
      !sha40(run.head_sha) || run.head_sha !== expectedSha || run.event !== 'push' ||
      run.head_branch !== 'main' || !isPass(run))
      fail('latest main push run SHA, origin or outcome not verified');
    // The canonical-looking URL alone does not prove the payload was emitted
    // by this repository's approved push workflow.
    if (!record(run.repository) || run.repository.id !== EXPECTED_REPOSITORY_ID ||
      run.repository.full_name !== EXPECTED_REPOSITORY ||
      !record(run.head_repository) || run.head_repository.id !== EXPECTED_REPOSITORY_ID ||
      run.head_repository.full_name !== EXPECTED_REPOSITORY ||
      run.path !== EXPECTED_WORKFLOW_PATH)
      fail('Actions run repository/head repository or workflow path is unverified');
    if (run.name !== 'Starry CI' || typeof run.html_url !== 'string' ||
      !/^https:\/\/github\.com\/starry-phd\/id\/actions\/runs\/[1-9][0-9]*$/.test(run.html_url) ||
      run.html_url !== 'https://github.com/starry-phd/id/actions/runs/' + String(run.id))
      fail('run must identify canonical Starry CI evidence URL');
  }

  // GitHub GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
  const arr = Array.isArray(jobs) ? jobs : record(jobs) ? jobs.jobs : null;
  if (!Array.isArray(arr)) fail('GitHub Actions jobs listing missing');
  else {
    for (const name of EXPECTED_JOBS) {
      const matches = arr.filter(job => job?.name === name);
      if (matches.length !== 1 || !isPass(matches[0]))
        fail('required completed-success job missing/failed/skipped: ' + name);
      if (matches.length === 1 && (!Number.isSafeInteger(run?.id) ||
        matches[0].run_id !== run.id))
        fail('job belongs to different workflow run: ' + name);
    }
  }
  return {
    up08_enforced: failures.length === 0,
    release_authorized: false,
    staging_authorized: false,
    ruleset_and_ci_verified: failures.length === 0,
    failures,
  };
}

// Offline CLI reads explicitly supplied source snapshots. NO remote access, no mutation.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const required = ['--ruleset', '--run', '--jobs', '--sha'];
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) options.set(args[i], args[i+1]);
  if (args.length !== 8 || required.some(k => !options.get(k))) {
    console.error('Usage: node up08-ruleset-evidence.mjs --ruleset ruleset.json --run run.json --jobs jobs.json --sha <exact-main-sha>');
    process.exitCode = 2;
  } else {
    try {
      const result = inspectUp08Evidence({
        ruleset: JSON.parse(readFileSync(options.get('--ruleset'), 'utf8')),
        run: JSON.parse(readFileSync(options.get('--run'), 'utf8')),
        jobs: JSON.parse(readFileSync(options.get('--jobs'), 'utf8')),
        expectedSha: options.get('--sha'),
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.up08_enforced) process.exitCode = 1;
    } catch (error) {
      console.error('UP08 evidence rejected:', error instanceof Error ? error.message : 'unreadable source');
      process.exitCode = 1;
    }
  }
}
