import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSqlDraftInventory,readJson} from '../../../docs/operations/verify-r15-sql-inventory.mjs';

const baseline=readJson('docs/operations/r15-sql-migration-inventory.v0.json');
const gates=readJson('docs/release-readiness/release-readiness.v0.json');
const copy=x=>JSON.parse(JSON.stringify(x));
const rejected=(mutate,release=gates,options)=>{
 const state=copy(baseline);mutate(state);
 const result=inspectSqlDraftInventory(state,release,options);
 assert.equal(result.ok,false,JSON.stringify(result));
};
test('R15: exactly 36 real SQL draft paths are inventoried with no production authorization',()=>{
 const result=inspectSqlDraftInventory(baseline,gates);
 assert.equal(result.ok,true,result.errors.join('; '));
 assert.deepEqual(result.byDomain,{auth:20,billing:5,battery_audit:10,task:1});
 assert.equal(result.count,36);
 assert.equal(result.real_d1_schema_migrated,false);
 assert.equal(result.production_rollback_approved,false);
});
test('R15: auth revisions 005 through 012 have named UP/DOWN peers, not approved production rollback',()=>{
 const paths=new Set(baseline.entries.map(x=>x.path));
 for(let revision=5;revision<=12;revision++){
  const prefix=String(revision).padStart(3,'0')+'_';
  const up=baseline.entries.filter(x=>x.domain==='auth'&&x.kind==='versioned_up'&&
   x.path.split('/').at(-1).startsWith(prefix));
  assert.equal(up.length,1);
  assert.ok(paths.has(up[0].paired_source));
  assert.equal(up[0].production_rollback_verified,false);
 }
});
test('R15: false production migration approval fails closed',()=>rejected(x=>{x.live_execution_authorized=true}));
test('R15: false staging migration approval fails closed',()=>rejected(x=>{x.staging_execution_authorized=true}));
test('R15: false production rollback approval fails closed',()=>rejected(x=>{x.production_rollback_verified=true}));
test('R15: removing Auth critical DOWN pair fails closed',()=>rejected(x=>{
 x.entries=x.entries.filter(e=>!e.path.endsWith('012_starry_stepup_challenge_scope.DOWN.DRAFT.sql'));
}));
test('R15: pretending a standalone Task schema has an approved DOWN fails closed',()=>rejected(x=>{
 x.entries.find(e=>e.domain==='task').kind='versioned_up';
}));
test('R15: mixing H-Global source scope fails closed',()=>rejected(x=>{x.scope='starry_and_hglobal'}));
test('R15: inventing a phantom SQL file fails closed',()=>rejected(x=>{
 x.entries[0].path='modules/starry-id-v1/schema/999_fake.DRAFT.sql';
}));
test('R15: new R15 SQL file must be reviewed and recorded, not silently ignored',()=>{
 const paths=baseline.entries.map(e=>e.path);
 const result=inspectSqlDraftInventory(baseline,gates,{
  listPaths:[...paths,'packages/rebuild-ai3/schema/0011_unreviewed_DRAFT.sql']
 });
 assert.equal(result.ok,false);
 assert.ok(result.errors.some(s=>s.includes('new SQL path not triaged')));
});
test('R15: migration source removed from checkout must be detected',()=>{
 const paths=baseline.entries.map(e=>e.path).slice(1);
 const result=inspectSqlDraftInventory(baseline,gates,{listPaths:paths});
 assert.equal(result.ok,false);
});
test('R15: unblocking authoritative release Gate fails closed',()=>{
 const g=copy(gates);g.gates[0].status='approved';
 assert.equal(inspectSqlDraftInventory(baseline,g).ok,false);
});
test('R15: turning on auto deploy fails closed',()=>{
 const g=copy(gates);g.deployment_automation.can_auto_deploy=true;
 assert.equal(inspectSqlDraftInventory(baseline,g).ok,false);
});
