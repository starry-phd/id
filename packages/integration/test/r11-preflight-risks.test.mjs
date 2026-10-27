import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
test('AI-0 R11 risk proposal stays separate from authoritative release Gate',()=>{
  const register=read('../../../docs/operations/r11-cross-domain-risks.v0.json');
  const official=read('../../../docs/release-readiness/release-readiness.v0.json');
  const gateIds=new Set(official.gates.map(g=>g.id));
  assert.equal(register.kind,'proposal_only_r11_cross_domain_risk_register');
  assert.equal(register.scope,'starry_only');
  assert.equal(register.hglobal_paused,true);
  assert.equal(register.release_authorized,false);
  assert.equal(register.staging_authorized,false);
  assert.equal(register.risk_items.length,6);
  assert.equal(gateIds.size,11);
  assert.equal(official.release_authorization.granted,false);
  assert.equal(official.deployment_automation.can_auto_deploy,false);
  assert.ok(official.gates.every(g=>g.status==='blocked'));
  const riskIds=new Set();
  for(const risk of register.risk_items){
    assert.equal(risk.status,'blocked');
    assert.equal(risk.approved,false);
    assert.ok(!riskIds.has(risk.id));riskIds.add(risk.id);
    assert.ok(risk.gate_ids.length>0&&risk.gate_ids.every(id=>gateIds.has(id)));
    assert.ok(risk.owners.length>0&&risk.owners.every(x=>/^AI-[0-4]$/.test(x)));
    assert.ok(risk.approval.length>3&&risk.missing.length>3);
  }
});
