import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditDraftStack} from '../../../docs/operations/audit-ai0-pr-stack.mjs';

const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const original=read('../../../docs/operations/ai0-pr-stack-snapshot-r11.json');
const gates=read('../../../docs/release-readiness/release-readiness.v0.json');
const clone=v=>JSON.parse(JSON.stringify(v));
const bad=(change,release=gates)=>{
  const m=clone(original);change(m);
  const result=auditDraftStack(m,release);
  assert.equal(result.ok,false,JSON.stringify(result));
};
test('AI-0 snapshot baseline validates nine exact Draft PR links and blocked release',()=>{
  const res=auditDraftStack(original,gates);
  assert.equal(res.ok,true,res.failures.join('; '));
  assert.equal(res.count,9);
  assert.equal(res.verified_release,false);
  assert.match(res.warning,/historical snapshot/);
});
test('a stale/wrong PR base is detected rather than silently stacked',()=>bad(m=>m.prs[7].base_branch='ai0/rebuild-round9-four-owner-optimized-20261027'));
test('duplicate head commit SHA is rejected',()=>bad(m=>m.prs[8].head_sha=m.prs[7].head_sha));
test('a Draft reported as merged is an error in this snapshot',()=>bad(m=>m.prs[8].merged=true));
test('a PR targeting main unexpectedly cannot pass stack checker',()=>bad(m=>m.prs[8].base_branch='main'));
test('the manifest cannot misstate the latest verified integration HEAD',()=>bad(m=>m.latest_verified_integration_sha=m.prs[7].head_sha));
test('unblocking G00 cannot silently pass audit',()=>{
  const g=clone(gates);
  g.gates.find(x=>x.id==='G00-SSOT').status='approved';
  assert.equal(auditDraftStack(original,g).ok,false);
});
test('changing auto-deploy authorization cannot silently pass audit',()=>{
  const g=clone(gates);g.deployment_automation.can_auto_deploy=true;
  assert.equal(auditDraftStack(original,g).ok,false);
});
