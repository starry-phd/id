import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {preflight} from '../../docs/release-readiness/check-release-readiness.mjs';
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path,root),'utf8');
const errors=[];
const assert = (condition,reason) => { if(!condition) errors.push(reason); };
const release=JSON.parse(read('docs/release-readiness/release-readiness.v0.json'));
const status=preflight(release);
assert(status.valid && status.blocked.length===11,'Official eleven Gate manifest invalid or not all blocked');
assert(release.gates.every(g=>g.status==='blocked'&&Array.isArray(g.evidence)&&g.evidence.length===0),
  'Unknown verified Gate or synthetic evidence');
assert(release.release_authorization.granted===false &&
  release.deployment_automation.enabled===false &&
  release.deployment_automation.can_auto_deploy===false,'Release/deployment authorization changed');
const worker=read('apps/api/src/index.ts');
const cfg=read('apps/api/wrangler.toml');
const spec=read('apps/api/openapi.yaml');
const prod=read('.github/workflows/starry-production.yml');
const ci=read('.github/workflows/starry-ci.yml');
assert(worker.includes("'/v1/health'")&&worker.includes("'liveness-only'"),
 'Worker is no longer health-only');
assert(!/\/v1\/(member|starry-id\/members|auth|billing|admin|hglobal)\b/i.test(worker),
 'Protected or cross-brand Worker route surfaced');
assert(!/\/v1\/(member|starry-id\/members|auth|billing|admin|hglobal)\b/i.test(spec),
 'Protected or cross-brand operation published');
assert(!/\[env\.production\]|\[\[d1_databases\]\]|\[\[queues\./i.test(cfg) &&
 cfg.includes('workers_dev = false') && cfg.includes('main = "src/index.ts"'),
 'Wrangler configuration changed to real production/resource-enabled binding');
assert(!/CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|wrangler deploy|wrangler-action|eas build|npm run deploy/i.test(prod),
 'Production workflow contains a deployment or secret path');
assert(prod.includes('exit 1'), 'Production workflow must refuse release');
assert(!/CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|wrangler deploy --config|wrangler-action/i.test(ci),
 'CI exposes staging deploy or Cloudflare secrets');
assert(!/^\s+staging:\s*$/m.test(ci),'CI staging deployment job may run on main push');
assert(ci.includes('npm run typecheck')&&ci.includes('npm run lint')&&
  ci.includes('npm test')&&ci.includes('npm run mobile:config')&&
  ci.includes('npm run api:check')&&ci.includes('npm run release:blocked'),
  'Mandatory CI validation or Worker dry-run missing');
assert(readdirSync(new URL('.github/workflows/',root)).sort().join('|')===
 'starry-ci.yml|starry-production.yml','Legacy 24 workflows unexpectedly promoted');
// The W3 subset is inert source: no Member UI, public protected API, or extra workflows.
for(const path of ['apps/api/src/member-contract.ts','apps/api/openapi.member.DRAFT.yaml',
 'apps/mobile/app/member','apps/api/src/r23-cloudflare-preview-preflight.ts']) {
 assert(!existsSync(new URL(path,root)),'Unapproved public candidate promoted: '+path);
}
const src=read('apps/api/src/index.ts');
assert(!/from ['"][^'"]*(modules\/starry-id-v1|packages\/integration|test-support)/.test(src),
 'Public Worker unexpectedly imports dormant Auth or local-only dispatcher');
const newAllowedSentinel=new Set(["modules/starry-id-v1/src/index.ts","modules/starry-id-v1/src/billing-bridge.ts","modules/starry-id-v1/src/d1-ports.ts","modules/starry-id-v1/src/oidc-crypto.ts","modules/starry-id-v1/src/session-crypto.ts","modules/starry-id-v1/src/r23-signed-session-d1-request-boundary.ts","modules/starry-id-v1/src/w2-r23-auth-outcome-adapter.ts","modules/starry-id-v1/tsconfig.json","modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql","modules/starry-id-v1/test/session-crypto.test.mjs","modules/starry-id-v1/test/d1-ports.test.mjs","modules/starry-id-v1/test/r23-signed-session-d1-request-boundary.test.mjs","modules/starry-id-v1/test/w2-r23-auth-outcome-adapter.test.mjs","packages/integration/src/ai0-w1-isolated-self-profile.ts","packages/integration/src/ai0-w1-isolated-self-profile-client.ts","docs/contracts/AI0-W1-ISOLATED-SELF-PROFILE.openapi.json","apps/api/test-support/ai4-w2-local-worker-composition.ts","apps/api/test/ai0-w1-isolated-self-profile.test.mjs","apps/api/test/ai0-w1-self-profile-roundtrip.test.mjs","apps/api/test/ai4-w2-local-worker-composition.test.mjs"]);
const sourceManifest=JSON.parse(read('docs/operations/AI4-W3-AUTH-SOURCE-CLOSURE.v1.json'));
assert(sourceManifest.schema==='starry.ai4.w3.auth-source-promotion-closure.v1'
 && sourceManifest.source_sha==='6ae5c2bc5cbf71db715e7e70b18833c4cd6f8a79'
 && sourceManifest.selected_count===20 && sourceManifest.source_files?.length===20,
 'W3 approved source closure manifest mismatch');
for(const item of sourceManifest.source_files){
 assert(newAllowedSentinel.has(item.path) && item.mode==='100644' && /^[0-9a-f]{40}$/.test(item.sha),
  'W3 unapproved source path or invalid Git Blob SHA');
 if(newAllowedSentinel.has(item.path)){
  const actual=execFileSync('git',['hash-object',item.path],{cwd:new URL('.',root),encoding:'utf8'}).trim();
  assert(actual===item.sha,'W3 original source blob modified: '+item.path);
 }
}
const sdk=read('packages/sdk/src/index.ts');
assert(sdk.includes('Public liveness client only')&&!sdk.includes('createIsolatedSelfProfileClient'),
 'SDK live protected capability exported');
const app=JSON.parse(read('apps/mobile/app.json')).expo;
assert(app.ios.bundleIdentifier==='phd.starry.id.dev'&&app.android.package==='phd.starry.id.dev'&&
 !('eas' in app)&&!('ads' in app),'Expo identity/monetization accidentally promoted');
const home=read('apps/mobile/app/index.tsx');
assert(!home.includes('href="/member"')&&!home.includes('href="/auth"'),
 'Unavailable member/auth UI route advertised');
const allowed=new Set([".github/workflows/starry-ci.yml",".github/workflows/starry-production.yml","apps/api/openapi.yaml","apps/api/package.json","apps/api/src/index.ts","apps/api/test-support/ai4-w2-local-worker-composition.ts","apps/api/test/ai0-w1-isolated-self-profile.test.mjs","apps/api/test/ai0-w1-self-profile-roundtrip.test.mjs","apps/api/test/ai4-w2-local-worker-composition.test.mjs","apps/api/test/health.test.mjs","apps/api/test/openapi-parity.test.mjs","apps/api/wrangler.toml","apps/mobile/app.json","apps/mobile/app/_layout.tsx","apps/mobile/app/about.tsx","apps/mobile/app/index.tsx","apps/mobile/expo-env.d.ts","apps/mobile/package.json","apps/mobile/test/promotion-dev-harness.test.mjs","apps/mobile/tsconfig.json","docs/contracts/AI0-W1-ISOLATED-SELF-PROFILE.openapi.json","docs/operations/AI4-MAIN-PROMOTION-CURATED-HEALTH-RELEASE.md","docs/operations/AI4-MAIN-PROMOTION-RECURSIVE-TREE-DIFF.v1.json","docs/operations/AI4-W3-AUTH-SOURCE-CLOSURE.v1.json","docs/release-readiness/check-release-readiness.mjs","docs/release-readiness/release-readiness.v0.json","eslint.config.mjs","modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql","modules/starry-id-v1/src/billing-bridge.ts","modules/starry-id-v1/src/d1-ports.ts","modules/starry-id-v1/src/index.ts","modules/starry-id-v1/src/oidc-crypto.ts","modules/starry-id-v1/src/r23-signed-session-d1-request-boundary.ts","modules/starry-id-v1/src/session-crypto.ts","modules/starry-id-v1/src/w2-r23-auth-outcome-adapter.ts","modules/starry-id-v1/test/d1-ports.test.mjs","modules/starry-id-v1/test/r23-signed-session-d1-request-boundary.test.mjs","modules/starry-id-v1/test/session-crypto.test.mjs","modules/starry-id-v1/test/w2-r23-auth-outcome-adapter.test.mjs","modules/starry-id-v1/tsconfig.json","package-lock.json","package.json","packages/integration/src/ai0-w1-isolated-self-profile-client.ts","packages/integration/src/ai0-w1-isolated-self-profile.ts","packages/sdk/package.json","packages/sdk/src/index.ts","packages/sdk/test/health.test.mjs","scripts/promotion/verify-curated-release.mjs","scripts/promotion/verify-curated-release.test.mjs","scripts/promotion/w3-auth-dependency-closure.test.mjs","tsconfig.json"]);

const finalW3=JSON.parse(read('docs/operations/AI4-W3-FINAL-PROMOTION-CLOSURE.v1.json'));
const finalW3Allowed=[{"path":"modules/starry-id-v1/src/w3-local-vnext-typed-self-profile.ts","sha":"4063e75d2ee20c191599f40fc0b8e5f7ff821359"},{"path":"modules/starry-id-v1/test/w3-local-vnext-typed-self-profile.test.mjs","sha":"b760568effdf8d6b8f81423bb2773c11a79afb28"},{"path":"packages/rebuild-billing/src/trusted-store-namespace.ts","sha":"e7a8734980f23282750e5701d0721f44b70fe782"},{"path":"packages/rebuild-billing/test/trusted-store-namespace.test.mjs","sha":"3bda222c7fcc7194dbda65bcd13412718f112f12"},{"path":"packages/rebuild-ai3/src/w3-offline-only-factory.ts","sha":"c00f2bb02a38d361537c8cc77cf1644c5216b03a"},{"path":"packages/rebuild-ai3/test/w3-offline-only-factory.test.mjs","sha":"83a539cf37c720558ee7b5238a1481a8d072aaa8"},{"path":"packages/rebuild-ai3/src/index.ts","sha":"20a12af5cfb07940a041bd4fa633192dcad3f27f"},{"path":"packages/rebuild-ai3/src/queue-transport.ts","sha":"f75d3d4928874012eac88f460d6ca6435540d3c0"},{"path":"packages/rebuild-ai3/src/queue-consumer.ts","sha":"291d8758b5cad03dca32a08a0ae5ec7b50e404b8"},{"path":"packages/rebuild-ai3/src/d1-audit-adapter.ts","sha":"b1c7b56f05c9fb4a37500c271b906fb9e2fea533"}];
assert(finalW3.schema==='starry.ai4.w3.final-promotion-source-closure.v1'
  && finalW3.base_sha==='83f3dac0e65da54b426817d27ba89f9981557c01'
  && finalW3.source_w3_sha==='ab21c72f6be4c68df8c5a2abc0f67a483463a76a'
  && finalW3.source_ai2_corrected.startsWith('dd1f1ccb')
  && finalW3.selected_count===10 && finalW3.new_owner_blobs===6
  && finalW3.ai3_original_dependencies===4 && finalW3.preserved_w2_20_count===20
  && JSON.stringify(finalW3.source_files.map(({path,sha})=>({path,sha})))===JSON.stringify(finalW3Allowed),
  'W3 final exact source whitelist or source provenance changed');
for(const item of finalW3Allowed){
  allowed.add(item.path);
  assert(execFileSync('git',['hash-object',item.path],{cwd:new URL('.',root),encoding:'utf8'}).trim()===item.sha,
    'W3 original owner/AI3 dependency modified: '+item.path);
}
allowed.add('docs/operations/AI4-W3-FINAL-PROMOTION-CLOSURE.v1.json');
allowed.add('scripts/promotion/w3-final-source-closure.test.mjs');
// GOV v1.0: one reviewed documentation path; no runtime allowlist expansion.
allowed.add('docs/ai/OPTIMIZED-DEVELOPMENT.md');
const tracked=execFileSync('git',['ls-files','-z'],{cwd:new URL('.',root),encoding:'utf8'}).split('\0').filter(Boolean);
const mainOriginals=new Set([".github/CODEOWNERS",".github/agents/ai-0-coordinator.agent.md",".github/agents/ai-1-auth-member.agent.md",".github/agents/ai-2-billing-iap.agent.md",".github/agents/ai-3-battery-trust.agent.md",".github/agents/ai-4-expo-workers.agent.md",".github/dependabot.yml",".github/pull_request_template.md",".gitignore","AGENTS.md","docs/ai/HANDOFF-PROTOCOL.md","docs/ai/OFFICIAL-DEVELOPMENT-KICKOFF-2026-10-26.md","docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md","docs/contracts/FUTURE-STARRY-ADMIN-API.md","docs/operations/GITHUB-TEAM-COPILOT-READINESS.md","scripts/ci/validate_repository.py"]);
for(const name of tracked)assert(allowed.has(name)||mainOriginals.has(name),'Non-curated tracked path: '+name);
if(errors.length){console.error(errors.map(e=>'PROMOTION BLOCKED: '+e).join('\n'));process.exitCode=1;}
else console.log('PASS: curated health-only Starry foundation, 11/11 Release Gates blocked, no auto/manual deploy, no Consumer API');
