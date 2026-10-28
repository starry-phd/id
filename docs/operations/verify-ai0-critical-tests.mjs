// Always invoked by verify-ci-consolidation.mjs even if the test glob is changed.
// Prevent silent success if any critical AI-0 rounds or Q4 security tests disappear.
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'../..');
const wf=readFileSync(join(root,'.github/workflows/ai0-current-offline-gate.yml'),'utf8');
const requiredGlobs=[
 'node --experimental-strip-types --test packages/integration/test/*.test.mjs',
 'node --experimental-strip-types --test modules/starry-id-v1/test/*.test.mjs',
 'node --experimental-strip-types --test packages/rebuild-billing/test/*.test.mjs',
 'node --experimental-strip-types --test packages/rebuild-ai3/test/*.test.mjs',
 'node --experimental-strip-types --test apps/api/test/',
 'node docs/release-readiness/check-release-readiness.mjs --assert-blocked'
];
for(const part of requiredGlobs){
 // API tests run through npm test / api:check, not the same shell line as Owner glob.
 if(part==='node --experimental-strip-types --test apps/api/test/'){
  if(!wf.includes('npm test')||!wf.includes('npm run api:check'))
   throw Error('AI-0 CI lost API test and contract gate');
 }else if(!wf.includes(part))throw Error('AI-0 CI lost critical coverage: '+part);
}
for(const directory of ['apps/**','modules/**','packages/**',
 'docs/operations/**','docs/release-readiness/**']){
 if(!wf.includes("'"+directory+"'"))
  throw Error('AI-0 pull request workflow path cannot see '+directory);
}
const required=[
 'packages/integration/test/ai0-wave1-ci-evidence-gate.test.mjs',
 'packages/integration/test/ai0-wave1-r002-original-owner-blob-gate.test.mjs',
 'packages/integration/test/ai0-wave1-r003-cross-owner-gate.test.mjs',
 'packages/integration/test/ai0-wave1-r004-cross-owner-gate.test.mjs',
 'packages/integration/test/ai0-q4-admob-selection-ads-off.test.mjs',
 'packages/integration/test/ai0-r005-p05-canonical-offline-verifier.test.mjs',
 'packages/integration/test/ai0-r006-p05-canonical-proposal.test.mjs'
];
for(const p of required){
 const path=join(root,p);
 if(!existsSync(path))throw Error('MISSING_MANDATORY_AI0_GATE_TEST: '+p);
 const file=readFileSync(path,'utf8');
 if((file.match(/\btest\s*\(/g)||[]).length<2)
  throw Error('MANDATORY_AI0_TEST_BODY_MISSING: '+p);
}
for(const p of [
 'docs/operations/ai0-wave1-r003-owner-blobs.v1.json',
 'docs/operations/ai0-wave1-r004-owner-blobs.v1.json',
 'docs/operations/ai0-q4-admob-owner-approved.v1.json',
 'packages/integration/src/ai0-r005-p05-canonical-offline-verifier.ts'
])if(!existsSync(join(root,p)))throw Error('MISSING_AI0_SOURCE_GATE: '+p);
console.log('AI-0 critical source and test coverage gate: mandatory suites present, covered by read-only CI');
