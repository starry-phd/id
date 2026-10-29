import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {preflight} from '../../docs/release-readiness/check-release-readiness.mjs';
import {inspectM0,flattenM0} from './m0-guard-policy.mjs';
const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const hashOf=path=>execFileSync('git',['hash-object',path],{cwd:root,encoding:'utf8'}).trim();
const trackedPaths=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const errors=[];
const release=JSON.parse(read('docs/release-readiness/release-readiness.v0.json'));
const state=preflight(release);
if(!state.valid||state.blocked.length!==11||state.manual_review_eligible||state.can_auto_deploy)
 errors.push('Official release validation/freeze is not fully BLOCKED');
// Historic W2/W3 snapshots are immutable evidence. Current active code is NOT pinned to them.
errors.push(...flattenM0(inspectM0({read,hashOf,trackedPaths})));
const worker=read('apps/api/src/index.ts');
const sdk=read('packages/sdk/src/index.ts');
const yaml=read('apps/api/openapi.yaml');
if(!worker.includes("'/v1/health'")||!worker.includes("'liveness-only'"))
 errors.push('Actual public Worker health-liveness contract missing');
if(!sdk.includes('Public liveness client only'))
 errors.push('SDK lost documented live public boundary');
if(!yaml.includes('/v1/health:'))
 errors.push('OpenAPI lost health contract');
if(errors.length){
 console.error(errors.map(e=>'PROMOTION BLOCKED: '+e).join('\n'));
 process.exitCode=1;
}else{
 console.log('PASS: curated health-only Starry foundation, 11/11 Release Gates blocked, no auto/manual deploy, no Consumer API');
 console.log('PASS: UP07/08 evolving inert staging capability, historical provenance, structural configs and workflow denial');
}
