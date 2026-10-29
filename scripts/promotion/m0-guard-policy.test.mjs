import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseDocument} from 'yaml';
import {parseRestrictedWrangler, inspectWorkflow, pathAllowed,validateCapability,
 inspectM0,flattenM0} from './m0-guard-policy.mjs';

const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const hash=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex');
const evaluate=(overrides={},paths=tracked)=>{
 const get=p=>Object.hasOwn(overrides,p)?overrides[p]:read(p);
 return inspectM0({read:get,trackedPaths:paths,hashOf:p=>hash(get(p))});
};
const pass=(m={},p=tracked)=>assert.deepEqual(flattenM0(evaluate(m,p)),[]);
test('UP07 M0 genuine checkout passes',()=>pass());
test('UP07 lawful inert staging member route contract is accepted',()=>{
 const cap=JSON.parse(read('docs/operations/AI4-M0-PLATFORM-CAPABILITIES.v1.json'));
 assert.deepEqual(validateCapability(cap),[]);
 assert.equal(cap.routes[1].enabled,false);
 assert.equal(cap.routes[1].auth,'starry-session');
 assert.deepEqual(cap.routes[1].environments,['staging']);
 assert.deepEqual(cap.routes[1].aliases,[]);
 assert.equal(cap.routes[1].bindings[0].provisioned,false);
});
test('UP07 legal original repairs + new src/schema/tests/docs are a POSITIVE guard exit',()=>{
 for(const p of ['modules/starry-id-v1/src/issuer.ts','modules/starry-id-v1/schema/002_m1.sql',
  'modules/starry-id-v1/test/issuer.test.mjs','apps/api/src/staging-inert.ts',
  'apps/api/schema/test.sql','apps/api/test/guard.test.mjs','docs/operations/m1-review.md']){
   assert.equal(pathAllowed(p),true,p);pass({},[...tracked,p]);
 }
 for(const p of ['modules/starry-id-v1/src/index.ts',
  'packages/rebuild-billing/src/trusted-store-namespace.ts','apps/api/src/index.ts',
  'packages/sdk/src/index.ts'])pass({[p]:read(p)+'\n// reviewed patch test\n'});
});
test('UP07 historic ledgers remain frozen but no longer pin current original source',()=>{
 const p='docs/operations/AI4-W3-FINAL-PROMOTION-CLOSURE.v1.json';
 const m=JSON.parse(read(p));m.source_files[0].sha='b'.repeat(40);
 assert.ok(evaluate({[p]:JSON.stringify(m)}).provenance.some(e=>e.includes('Historical')));
 pass({'modules/starry-id-v1/src/index.ts':read('modules/starry-id-v1/src/index.ts')+'\n// local fix\n'});
});
test('UP07 route negative: unknown alias, unsafe method, live auth, production, real binding',()=>{
 const p='docs/operations/AI4-M0-PLATFORM-CAPABILITIES.v1.json';
 const original=JSON.parse(read(p));
 for(const edit of [c=>c.routes[1].enabled=true,c=>c.routes[1].auth='none',
  c=>c.routes[1].method='POST',c=>c.routes[1].aliases=['/v1/profile'],
  c=>c.routes[1].environments.push('production'),c=>c.routes[1].bindings[0].kind='d1',
  c=>c.routes[1].bindings[0].provisioned=true,c=>c.routes.push({...c.routes[1]})]){
   const x=structuredClone(original);edit(x);
   assert.ok(validateCapability(x).length>0);
   assert.ok(evaluate({[p]:JSON.stringify(x)}).capability.length>0);
 }
});
test('UP08 TOML and equivalent Wrangler JSON alternative are structurally accepted',()=>{
 const w=parseRestrictedWrangler(read('apps/api/wrangler.toml'));
 const json={...w[''],vars:w.vars,env:{staging:{...w['env.staging'],vars:w['env.staging.vars']}}};
 assert.deepEqual(parseRestrictedWrangler(JSON.stringify(json)),w);
});
test('UP08 nested, alternative JSON env, resource bindings, unknown keys, duplicate tables denied',()=>{
 const path='apps/api/wrangler.toml',t=read(path),w=parseRestrictedWrangler(t);
 const json={...w[''],vars:w.vars,env:{staging:{...w['env.staging'],vars:w['env.staging.vars']}}};
 const bad=[t+'\n[env.production]\nname="x"',t+'\n[env.staging.vars.deep]\nsecret="x"',
  t+'\n[[env.staging.d1_databases]]\nbinding="DB"',
  t+'\n[[queues.producers]]\nbinding="QUEUE"',
  t+'\n[vars]\nSTARRY_APP_ID="other"',
  t.replace('workers_dev = false','workers_dev = true'),
  t.replace('main = "src/index.ts"','main = "src/secret.ts"'),
  JSON.stringify({...json,env:{...json.env,production:json.env.staging}}),
  JSON.stringify({...json,d1_databases:[{binding:'DB'}]}),
  JSON.stringify({...json,env:{staging:{...json.env.staging,vars:{...json.env.staging.vars,DB:{nested:'x'}}}}}),
 ];
 for(const x of bad){
  assert.throws(()=>parseRestrictedWrangler(x),Error,x.slice(-80));
  assert.ok(evaluate({[path]:x}).runtime.length>0);
 }
});
test('UP08 original YAML and JSON serialization both pass workflow structural review',()=>{
 for(const [p,k] of [['.github/workflows/starry-ci.yml','ci'],
  ['.github/workflows/starry-production.yml','production']]){
  const y=read(p);
  assert.deepEqual(inspectWorkflow(y,k),[]);
  assert.deepEqual(inspectWorkflow(JSON.stringify(parseDocument(y).toJS()),k),[]);
 }
});
test('UP08 workflow rejects triggers, secrets, permissions, nested env, deploy commands',()=>{
 const p='.github/workflows/starry-ci.yml',base=parseDocument(read(p)).toJS();
 const mutations=[
  y=>y.permissions={contents:'write'},
  y=>y.jobs['app-tests'].permissions={contents:'write'},
  y=>y.jobs['app-tests'].environment='production',
  y=>y.jobs['app-tests'].steps.push({run:'npx wrangler deploy --env staging'}),
  y=>y.jobs['app-tests'].steps.push({run:'echo '+ '$'+'{{ secrets.CLOUDFLARE_API_TOKEN }}'}),
  y=>y.jobs['app-tests'].steps.push({run:'echo '+ '$'+'{{ github.token }}'}),
  y=>y.jobs['evil']={steps:[{run:'echo hi'}]},
  y=>y.on.push={branches:['main']},
  y=>y.jobs['app-tests'].steps=y.jobs['app-tests'].steps.filter(s=>s.run!=='npm run promotion:verify'),
 ];
 for(const mutate of mutations){
  const copy=structuredClone(base);mutate(copy);const s=JSON.stringify(copy);
  assert.ok(inspectWorkflow(s,'ci').length>0,s.slice(-100));
  assert.ok(evaluate({[p]:s}).release.length>0);
 }
});
test('UP08 production must hard reject in only manual environment job',()=>{
 const p='.github/workflows/starry-production.yml',base=parseDocument(read(p)).toJS();
 for(const edit of [
  y=>y.jobs.blocked.steps[0].run='exit 0',
  y=>y.jobs.blocked.steps[0].run='wrangler deploy --env production\nexit 1',
  y=>y.jobs.blocked.steps.push({run:'echo hi'}),
  y=>y.on.push={branches:['main']},y=>y.permissions={contents:'write'}
 ]){
  const x=structuredClone(base);edit(x);
  assert.ok(inspectWorkflow(JSON.stringify(x),'production').length>0);
 }
});
test('UP07 official release stays false independently of inert capability',()=>{
 const p='docs/release-readiness/release-readiness.v0.json';
 const x=JSON.parse(read(p));x.release_authorization.granted=true;
 assert.ok(evaluate({[p]:JSON.stringify(x)}).release.length>0);
 const y=structuredClone(x);y.gates[0].status='verified';
 assert.ok(evaluate({[p]:JSON.stringify(y)}).release.length>0);
});
test('UP07 no unknown workflows, secrets or runtime deployment scripts allowed',()=>{
 for(const p of ['.github/workflows/new-deploy.yml','apps/api/.env.production',
  'apps/api/src/secrets/private.key','apps/api/production-deploy.sh']){
  assert.equal(pathAllowed(p),false);
  assert.ok(evaluate({},[...tracked,p]).provenance.length>0);
 }
});
