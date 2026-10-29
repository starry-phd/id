import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {preflight} from '../../docs/release-readiness/check-release-readiness.mjs';
test('curated promotion guard executes on actual tracked repository files',()=>{
  assert.match(execFileSync(process.execPath,['scripts/promotion/verify-curated-release.mjs'],
    {encoding:'utf8'}),/PASS: curated health-only/);
});
test('official release authority remains blocked independent of promotion',()=>{
  const gates=JSON.parse(readFileSync(new URL('../../docs/release-readiness/release-readiness.v0.json',import.meta.url),'utf8'));
  const p=preflight(gates);
  assert.equal(p.valid,true);assert.equal(p.blocked.length,11);
  assert.equal(p.manual_review_eligible,false);assert.equal(p.can_auto_deploy,false);
  assert.equal(gates.release_authorization.granted,false);
});
test('production and main-push staging workflows contain no credentials/deploy commands',()=>{
  const prod=readFileSync(new URL('../../.github/workflows/starry-production.yml',import.meta.url),'utf8');
  const ci=readFileSync(new URL('../../.github/workflows/starry-ci.yml',import.meta.url),'utf8');
  assert.match(prod,/exit 1/);
  assert.doesNotMatch(prod,/CLOUDFLARE_API_TOKEN|wrangler deploy|eas build/);
  assert.doesNotMatch(ci,/CLOUDFLARE_API_TOKEN|wrangler deploy --config/);
  assert.doesNotMatch(ci,/^\s+staging:\s*$/m);
  for(const command of ['npm run typecheck','npm run lint','npm test','npm run api:check','npm run release:blocked'])
    assert.ok(ci.includes(command),command);
});
