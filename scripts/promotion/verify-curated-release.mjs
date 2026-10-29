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
const tracked=execFileSync('git',['ls-files','-z'],{cwd:new URL('.',root),encoding:'utf8'}).split('\0').filter(Boolean);
const mainOriginals=new Set([".github/CODEOWNERS",".github/agents/ai-0-coordinator.agent.md",".github/agents/ai-1-auth-member.agent.md",".github/agents/ai-2-billing-iap.agent.md",".github/agents/ai-3-battery-trust.agent.md",".github/agents/ai-4-expo-workers.agent.md",".github/dependabot.yml",".github/pull_request_template.md",".gitignore","AGENTS.md","docs/ai/HANDOFF-PROTOCOL.md","docs/ai/OFFICIAL-DEVELOPMENT-KICKOFF-2026-10-26.md","docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md","docs/contracts/FUTURE-STARRY-ADMIN-API.md","docs/operations/GITHUB-TEAM-COPILOT-READINESS.md","scripts/ci/validate_repository.py"]);
for(const name of tracked)assert(allowed.has(name)||mainOriginals.has(name),'Non-curated tracked path: '+name);
if(errors.length){console.error(errors.map(e=>'PROMOTION BLOCKED: '+e).join('\n'));process.exitCode=1;}
else console.log('PASS: curated health-only Starry foundation, 11/11 Release Gates blocked, no auto/manual deploy, no Consumer API');
