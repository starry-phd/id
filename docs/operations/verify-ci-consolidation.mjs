import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'../..');
const legacy=[
 'ai0-rebuild-composition.yml','ai0-rebuild-round2-union.yml',
 'ai0-rebuild-round3-union.yml','ai0-round4-union.yml',
 'ai0-round5-union.yml','ai0-round6-union.yml',
 'ai0-round6-four-owner.yml','ai4-rebuild-foundation.yml',
 'ai4-rebuild-round2.yml','ai4-rebuild-round3.yml',
 'ai4-rebuild-round4.yml','ai4-rebuild-round5.yml',
 'ai4-rebuild-round6.yml'
];
const read=p=>readFileSync(join(root,p),'utf8');
for(const n of legacy){
 const s=read('.github/workflows/'+n);
 if(!/^on:\n  workflow_dispatch:\s*\n/m.test(s)||
    /^  (pull_request|push|schedule):/m.test(s)||
    !/^permissions:\n  contents: read/m.test(s)||
    !/^jobs:/m.test(s))throw Error('Historical workflow not manual-only/read-only: '+n);
}
const current=read('.github/workflows/ai0-current-offline-gate.yml');
for(const snippet of [
 'on:\n  pull_request:','concurrency:','cancel-in-progress: true',
 'permissions:\n  contents: read',
 'verify-source-reconciliation-r8.mjs','--assert-blocked',
 'verify-ci-consolidation.mjs','npm run api:check',
 "node --experimental-strip-types --test packages/integration/test/*.test.mjs",
 "python3 -m unittest discover -s packages/rebuild-ai3/test"
])if(!current.includes(snippet))throw Error('Current offline CI missing safety check: '+snippet);
if(/\n\s+(?:deploy|eas build|eas update|wrangler deploy)(?:\s|$)/im.test(current.replace(/npm run api:check/g,'')))throw Error('Unexpected live deploy operation');
const required=read('.github/workflows/starry-ci.yml');
if(!required.includes('name: Repository policy')||
   !/^  pull_request:\n    branches: \[main\]/m.test(required)||
   !/^  push:\n    branches: \[main\]/m.test(required)||
   !/^permissions:\n  contents: read/m.test(required))throw Error('Required main policy changed');
const production=read('.github/workflows/starry-production.yml');
if(!production.includes('workflow_dispatch:')||
   !production.includes('DEPLOY-STARRY-PRODUCTION'))throw Error('Production manual gate changed');
console.log('CI consolidation guards PASS; 13 historical workflows manual-only; main policy/production gate retained');
