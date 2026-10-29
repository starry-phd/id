// M0: immutable release denial, source provenance and reviewed capability scope are independent.
// Only local repository artifacts are read; this module never deploys or accesses Cloudflare.
const TABLE_KEYS = Object.freeze({
  '': ['name', 'main', 'compatibility_date', 'workers_dev'],
  vars: ['STARRY_ENVIRONMENT', 'STARRY_APP_ID'],
  'env.staging': ['name', 'workers_dev'],
  'env.staging.vars': ['STARRY_ENVIRONMENT', 'STARRY_APP_ID'],
});
const FROZEN = Object.freeze({
  readinessSha: '0ea2e40692fb2e9f7e0c282ac1ece91ad2c740ba',
  productionSha: '900f49b561a4fc2a89ed054d3e37e2b2c20e549b',
  workflowPaths: ['.github/workflows/starry-ci.yml', '.github/workflows/starry-production.yml'],
  capabilityPaths: ['apps/api/src/index.ts', 'apps/api/openapi.yaml', 'packages/sdk/src/index.ts'],
});
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function withoutComment(line) {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (c === '#' && !inString) return line.slice(0, i).trim();
  }
  if (inString) throw new Error('unterminated TOML string');
  return line.trim();
}

/**
 * Deliberately restrictive structured TOML subset for this exact reviewed Wrangler artifact.
 * Do not silently accept new TOML tables, arrays-of-tables, dotted keys or nested env values.
 * A more complex configuration needs a reviewed parser/schema upgrade, not a regex bypass.
 */
export function parseRestrictedWrangler(source) {
  if (typeof source !== 'string') throw new Error('Wrangler source must be a string');
  const tables = {'': Object.create(null)};
  let section = '';
  for (const [i, raw] of source.split(/\r?\n/).entries()) {
    const line = withoutComment(raw);
    if (!line) continue;
    const header = /^\[([a-zA-Z][a-zA-Z0-9_.-]*)\]$/.exec(line);
    if (header) {
      section = header[1];
      if (!has(TABLE_KEYS, section)) throw new Error('Unknown/nested Wrangler table: ' + section);
      if (has(tables, section)) throw new Error('Duplicate Wrangler table: ' + section);
      tables[section] = Object.create(null);
      continue;
    }
    if (line.startsWith('[')) throw new Error('Unsupported Wrangler array/table at line ' + (i + 1));
    const pair = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!pair) throw new Error('Unsupported Wrangler syntax/dotted key at line ' + (i + 1));
    const key = pair[1];
    if (!TABLE_KEYS[section].includes(key)) throw new Error('Unknown Wrangler key ' + section + '/' + key);
    if (has(tables[section], key)) throw new Error('Duplicate Wrangler key ' + section + '/' + key);
    let value;
    try { value = JSON.parse(pair[2]); } catch { throw new Error('Non-literal Wrangler value at line ' + (i + 1)); }
    if (typeof value !== 'string' && typeof value !== 'boolean') {
      throw new Error('Disallowed Wrangler value type at line ' + (i + 1));
    }
    tables[section][key] = value;
  }
  for (const [section, keys] of Object.entries(TABLE_KEYS)) {
    if (!has(tables, section)) throw new Error('Missing Wrangler table: ' + section);
    if (Object.keys(tables[section]).sort().join('|') !== [...keys].sort().join('|')) {
      throw new Error('Missing/extra Wrangler keys in ' + section);
    }
  }
  const root = tables[''];
  const staging = tables['env.staging'];
  const vars = tables.vars;
  const stageVars = tables['env.staging.vars'];
  if (root.name !== 'starry-id-api-local' ||
      root.main !== 'src/index.ts' ||
      root.compatibility_date !== '2026-10-01' ||
      root.workers_dev !== false ||
      vars.STARRY_ENVIRONMENT !== 'development' ||
      vars.STARRY_APP_ID !== 'starry-id' ||
      staging.name !== 'starry-id-api-staging' ||
      staging.workers_dev !== false ||
      stageVars.STARRY_ENVIRONMENT !== 'staging' ||
      stageVars.STARRY_APP_ID !== 'starry-id') {
    throw new Error('Unreviewed Worker deployment identity or environment');
  }
  return tables;
}

/**
 * Fail closed across three *independent* dimensions. Runtime source evolution cannot
 * make a blocked release eligible; a source pin cannot authorize a public API route.
 * The official readiness file and the production workflow are pinned separately.
 */
export function inspectM0({read, hashOf, trackedPaths}) {
  const result = {release: [], provenance: [], capability: [], runtime: []};
  const fail = (group, message) => result[group].push(message);
  const check = (group, condition, message) => { if (!condition) fail(group, message); };
  const readSafe = (path, group) => {
    try { return read(path); } catch { fail(group, 'Missing required artifact: ' + path); return null; }
  };
  const hashSafe = (path, group) => {
    try { return hashOf(path); } catch { fail(group, 'Cannot hash artifact: ' + path); return null; }
  };

  // Release authority is independent of all future capability promotions.
  check('release', hashSafe('docs/release-readiness/release-readiness.v0.json', 'release') === FROZEN.readinessSha,
    'Official readiness freeze changed without independent Gate approval');
  const official = readSafe('docs/release-readiness/release-readiness.v0.json', 'release');
  if (official !== null) {
    try {
      const r = JSON.parse(official);
      check('release', Array.isArray(r.gates) && r.gates.length === 11 &&
        r.gates.every(g => g.status === 'blocked' && Array.isArray(g.evidence) && g.evidence.length === 0),
        'Official G00-G10 no longer wholly blocked and evidence-free');
      check('release', r.release_authorization?.granted === false &&
        r.deployment_automation?.enabled === false &&
        r.deployment_automation?.can_auto_deploy === false, 'Release/deployment permission escalated');
    } catch { fail('release', 'Unreadable official release manifest'); }
  }
  check('release', hashSafe('.github/workflows/starry-production.yml', 'release') === FROZEN.productionSha,
    'Production workflow hard-denial blob changed');
  const prod = readSafe('.github/workflows/starry-production.yml', 'release');
  check('release', typeof prod === 'string' && /\bexit 1\b/.test(prod) &&
    !/CLOUDFLARE_API_TOKEN|wrangler deploy|eas build/i.test(prod),
    'Production workflow not demonstrably blocked');
  const actualWorkflows = trackedPaths.filter(p => p.startsWith('.github/workflows/')).sort();
  check('release', JSON.stringify(actualWorkflows) === JSON.stringify([...FROZEN.workflowPaths].sort()),
    'Unreviewed workflow path added, deleted or renamed');
  const ci = readSafe('.github/workflows/starry-ci.yml', 'release');
  check('release', typeof ci === 'string' &&
    ci.includes('required-validation:') && ci.includes('needs: [repository-policy, app-tests]') &&
    ci.includes('npm run release:blocked') && ci.includes('npm run promotion:verify') &&
    ci.includes('npm run api:runtime') &&
    !/CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|wrangler-action|wrangler deploy --config/i.test(ci),
    'Required CI validation or no-deploy boundary changed');

  // Source closure is independent of what runtime endpoint an owner wants next.
  for (const manifestPath of [
    'docs/operations/AI4-W3-AUTH-SOURCE-CLOSURE.v1.json',
    'docs/operations/AI4-W3-FINAL-PROMOTION-CLOSURE.v1.json',
  ]) {
    const raw = readSafe(manifestPath, 'provenance');
    if (raw === null) continue;
    try {
      const manifest = JSON.parse(raw);
      const sources = manifest.source_files;
      check('provenance', Array.isArray(sources) &&
        sources.length === manifest.selected_count &&
        new Set(sources.map(s => s.path)).size === sources.length,
        'Malformed source closure ' + manifestPath);
      if (Array.isArray(sources)) for (const source of sources) {
        check('provenance', typeof source.path === 'string' &&
          /^[0-9a-f]{40}$/.test(source.sha) && hashSafe(source.path, 'provenance') === source.sha,
          'Original Git blob changed: ' + source.path);
      }
    } catch { fail('provenance', 'Invalid provenance JSON: ' + manifestPath); }
  }

  // M0 reviewed capability slice is strictly liveness; separate M1 PR may amend
  // *only this slice* after review but must not grant deployment authorization.
  const capRaw = readSafe('docs/operations/AI4-M0-PLATFORM-CAPABILITIES.v1.json', 'capability');
  if (capRaw !== null) {
    try {
      const cap = JSON.parse(capRaw);
      check('capability', cap.schema === 'starry.ai4.m0.platform-capabilities.v1' &&
        cap.stage === 'source_only_not_publishable' &&
        JSON.stringify(cap.public_routes) === JSON.stringify(['/v1/health']) &&
        cap.auth_enabled === false && cap.production_enabled === false,
        'Capability scope exceeds reviewed M0 liveness-only slice');
      check('capability', Array.isArray(cap.artifact_blobs) &&
        cap.artifact_blobs.length === FROZEN.capabilityPaths.length &&
        JSON.stringify(cap.artifact_blobs.map(x => x.path).sort()) ===
        JSON.stringify([...FROZEN.capabilityPaths].sort()),
        'Capability source list is incomplete or expanded');
      if (Array.isArray(cap.artifact_blobs)) for (const item of cap.artifact_blobs) {
        check('capability', typeof item.path === 'string' && FROZEN.capabilityPaths.includes(item.path) &&
          /^[0-9a-f]{40}$/.test(item.sha) && hashSafe(item.path, 'capability') === item.sha,
          'Runtime API/SDK/OpenAPI differs from reviewed blob: ' + item.path);
      }
    } catch { fail('capability', 'Invalid capability manifest JSON'); }
  }

  const wrangler = readSafe('apps/api/wrangler.toml', 'runtime');
  if (wrangler !== null) {
    try { parseRestrictedWrangler(wrangler); }
    catch (e) { fail('runtime', 'Wrangler scope denied: ' + e.message); }
  }
  check('runtime', trackedPaths.includes('apps/api/test/workerd-runtime.test.mjs'),
    'Actual workerd runtime regression test absent');
  return result;
}

export function flattenM0(result) {
  return Object.entries(result).flatMap(([group, failures]) =>
    failures.map(message => 'M0 ' + group.toUpperCase() + ': ' + message));
}
