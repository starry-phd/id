import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parseRestrictedWrangler, inspectM0, flattenM0} from './m0-guard-policy.mjs';

const readReal = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const realTracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: new URL('../../', import.meta.url), encoding: 'utf8',
}).split('\0').filter(Boolean);
const blob = text => createHash('sha1')
  .update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
function fixture(overrides = {}, trackedPaths = realTracked) {
  const read = path => Object.hasOwn(overrides, path) ? overrides[path] : readReal(path);
  return {
    read,
    trackedPaths,
    hashOf: path => blob(read(path)),
  };
}
const evaluate = (overrides = {}, trackedPaths) => inspectM0(fixture(overrides, trackedPaths));

test('M0: real checked-out release, provenance, capability and Wrangler all have independent PASS', () => {
  const x = evaluate();
  assert.deepEqual(x, {release: [], provenance: [], capability: [], runtime: []}, flattenM0(x).join('\n'));
  assert.deepEqual(flattenM0(x), []);
});

test('M0: structured local/staging Wrangler accepts reviewed keys without deploying', () => {
  const parsed = parseRestrictedWrangler(readReal('apps/api/wrangler.toml'));
  assert.equal(parsed[''].main, 'src/index.ts');
  assert.equal(parsed['env.staging.vars'].STARRY_ENVIRONMENT, 'staging');
  assert.deepEqual(Object.keys(parsed).sort(), ['', 'env.staging', 'env.staging.vars', 'vars'].sort());
});

test('M0: nested/unknown env, array-of-tables, binding, dotted key and duplicate table fail closed', () => {
  const original = readReal('apps/api/wrangler.toml');
  const invalid = [
    original + '\n[env.production]\nname = "id-production"\n',
    original + '\n[env.preview.vars]\nSTARRY_ENVIRONMENT = "staging"\n',
    original + '\n[env.staging.vars.deep]\nSTARRY_APP_ID = "starry-id"\n',
    original + '\n[[env.staging.d1_databases]]\nbinding = "DB"\n',
    original + '\n[[queues.producers]]\nbinding = "QUEUE"\n',
    original + '\n[env.staging.routes]\npattern = "*"\n',
    original + '\n[vars.secret]\nkey = "BAD"\n',
    original.replace('STARRY_APP_ID = "starry-id"', 'STARRY_APP_ID = "starry-id"\nDB = "sensitive"'),
    original.replace('workers_dev = false', 'workers_dev = true'),
    original.replace('main = "src/index.ts"', 'main = "src/auth.ts"'),
    original.replace('STARRY_APP_ID = "starry-id"', 'STARRY_APP_ID = "foreign"'),
    original.replace('STARRY_APP_ID = "starry-id"', 'STARRY_APP_ID = {nested = "unsafe"}'),
    original + '\n[vars]\nSTARRY_APP_ID = "starry-id"\n',
    original + '\n[env.staging.vars]\nSTARRY_APP_ID = "starry-id"\n',
    original + '\n[vars]\nSTARRY_APP_ID.other = "unsafe"\n',
    original + '\n[observability]\nenabled = true\n',
    original + '\n[env.staging.vars]\nSTARRY_APP_ID = "starry-id"\n',
  ];
  for (const bad of invalid) {
    assert.throws(() => parseRestrictedWrangler(bad), Error, bad.slice(-120));
    const x = evaluate({'apps/api/wrangler.toml': bad});
    assert.ok(x.runtime.length > 0, 'nested env must be denied');
    assert.deepEqual(x.release, [], 'runtime change must not confer release approval');
  }
});

test('M0: comment containing fake bindings does not create a deployment configuration', () => {
  const original = readReal('apps/api/wrangler.toml');
  const parsed = parseRestrictedWrangler(original + '\n# [[d1_databases]]\n');
  assert.equal(parsed.vars.STARRY_APP_ID, 'starry-id');
});

test('M0: no release eligibility even if capability manifest and runtime are otherwise valid', () => {
  const m = JSON.parse(readReal('docs/release-readiness/release-readiness.v0.json'));
  m.gates[0].status = 'verified';
  m.gates[0].evidence = [{commit_sha: 'a'.repeat(40), url:'https://invalid.example', kind:'synthetic'}];
  m.release_authorization.granted = true;
  const changed = evaluate({'docs/release-readiness/release-readiness.v0.json': JSON.stringify(m)});
  assert.ok(changed.release.length > 0, 'freeze and Gate authority must deny');
  assert.deepEqual(changed.capability, []);
  assert.deepEqual(changed.provenance, []);
});

test('M0: altering, removing or unblocking production workflow is rejected independently of source capability', () => {
  const original = readReal('.github/workflows/starry-production.yml');
  for (const candidate of [
    original.replace('exit 1', 'exit 0'),
    original.replace('exit 1', 'wrangler deploy --env production'),
    original + '\n# an unreviewed tweak\n',
  ]) {
    const x = evaluate({'.github/workflows/starry-production.yml': candidate});
    assert.ok(x.release.length > 0);
    assert.deepEqual(x.capability, []);
  }
});

test('M0: extra workflow, especially deploy via another file, is blocked', () => {
  const extra = [...realTracked, '.github/workflows/unreviewed.yml'];
  const x = evaluate({}, extra);
  assert.ok(x.release.some(e => e.includes('workflow path')));
});

test('M0: dormant W3 original blob modification cannot be authorized by health capability', () => {
  const original = readReal('packages/rebuild-billing/src/trusted-store-namespace.ts');
  const x = evaluate({'packages/rebuild-billing/src/trusted-store-namespace.ts': original + '\n// unreviewed\n'});
  assert.ok(x.provenance.length > 0);
  assert.deepEqual(x.release, []);
});

test('M0: changing SDK / Worker / OpenAPI requires a reviewed capability revision, never deployment authority', () => {
  for (const path of ['apps/api/src/index.ts', 'apps/api/openapi.yaml', 'packages/sdk/src/index.ts']) {
    const x = evaluate({[path]: readReal(path) + '\n// candidate\n'});
    assert.ok(x.capability.some(e => e.includes(path)), path);
    assert.deepEqual(x.release, [], path);
  }
  const capPath = 'docs/operations/AI4-M0-PLATFORM-CAPABILITIES.v1.json';
  const cap = JSON.parse(readReal(capPath));
  cap.public_routes.push('/v1/auth/login');
  const x = evaluate({[capPath]: JSON.stringify(cap)});
  assert.ok(x.capability.length > 0);
  assert.deepEqual(x.release, []);
});

test('M0: tracked workerd test is not an optional evidence stub', () => {
  const list = realTracked.filter(p => p !== 'apps/api/test/workerd-runtime.test.mjs');
  assert.ok(evaluate({}, list).runtime.some(e => e.includes('runtime regression')));
});

test('M0: missing manifest never silently falls back to success', () => {
  const path = 'docs/operations/AI4-M0-PLATFORM-CAPABILITIES.v1.json';
  const ctx = fixture();
  const failing = inspectM0({
    ...ctx,
    read: p => { if (p === path) throw new Error('missing'); return ctx.read(p); },
  });
  assert.ok(failing.capability.length > 0);
});
