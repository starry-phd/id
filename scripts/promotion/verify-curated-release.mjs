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
for(const path of ['modules','packages/integration','packages/rebuild-ai3','packages/rebuild-billing',
 'apps/api/src/member-contract.ts','apps/api/openapi.member.DRAFT.yaml',
 'apps/mobile/app/member']) {
 assert(!existsSync(new URL(path,root)),'Unapproved offline domain/consumer candidate promoted: '+path);
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
const allowed=new Set([".github/workflows/starry-ci.yml",".github/workflows/starry-production.yml","apps/api/openapi.yaml","apps/api/package.json","apps/api/src/index.ts","apps/api/test/health.test.mjs","apps/api/test/openapi-parity.test.mjs","apps/api/wrangler.toml","apps/mobile/app.json","apps/mobile/app/_layout.tsx","apps/mobile/app/about.tsx","apps/mobile/app/index.tsx","apps/mobile/expo-env.d.ts","apps/mobile/package.json","apps/mobile/test/promotion-dev-harness.test.mjs","apps/mobile/tsconfig.json","docs/operations/AI4-MAIN-PROMOTION-CURATED-HEALTH-RELEASE.md","docs/operations/AI4-MAIN-PROMOTION-RECURSIVE-TREE-DIFF.v1.json","docs/release-readiness/check-release-readiness.mjs","docs/release-readiness/release-readiness.v0.json","eslint.config.mjs","package-lock.json","package.json","packages/sdk/package.json","packages/sdk/src/index.ts","packages/sdk/test/health.test.mjs","scripts/promotion/verify-curated-release.mjs","scripts/promotion/verify-curated-release.test.mjs","tsconfig.json"]);
const tracked=execFileSync('git',['ls-files','-z'],{cwd:new URL('.',root),encoding:'utf8'}).split('\0').filter(Boolean);
const mainOriginals=new Set([".github/CODEOWNERS",".github/agents/ai-0-coordinator.agent.md",".github/agents/ai-1-auth-member.agent.md",".github/agents/ai-2-billing-iap.agent.md",".github/agents/ai-3-battery-trust.agent.md",".github/agents/ai-4-expo-workers.agent.md",".github/dependabot.yml",".github/pull_request_template.md",".gitignore","AGENTS.md","docs/ai/HANDOFF-PROTOCOL.md","docs/ai/OFFICIAL-DEVELOPMENT-KICKOFF-2026-10-26.md","docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md","docs/contracts/FUTURE-STARRY-ADMIN-API.md","docs/operations/GITHUB-TEAM-COPILOT-READINESS.md","scripts/ci/validate_repository.py"]);
for(const name of tracked)assert(allowed.has(name)||mainOriginals.has(name),'Non-curated tracked path: '+name);
if(errors.length){console.error(errors.map(e=>'PROMOTION BLOCKED: '+e).join('\n'));process.exitCode=1;}
else console.log('PASS: curated health-only Starry foundation, 11/11 Release Gates blocked, no auto/manual deploy, no Consumer API');
