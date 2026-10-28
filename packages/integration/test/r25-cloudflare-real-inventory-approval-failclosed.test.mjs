import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const json = (path) => JSON.parse(readFileSync(new URL('../../../'+path,import.meta.url),'utf8'));
const inv = json('docs/operations/r25-20261028-starry-cloudflare-readonly-inventory.v1.json');
const release = json('docs/release-readiness/release-readiness.v0.json');
test('R25 inventory contains external GET observations only; no resource-write action or sensitive account IDs',()=>{
  assert.equal(inv.evidence_class,'LIVE_READ_ONLY_ACCOUNT_SCOPE_METADATA');
  assert.equal(inv.account_scope_only,true);
  assert.equal(inv.state,'LIVE_METADATA_OBSERVED_AUTHORIZATION_NOT_GRANTED');
  assert.ok(inv.operations_performed.length>=6);
  assert.ok(inv.operations_performed.every(x=>x.startsWith('GET /accounts/{account_id}/')));
  assert.ok(!JSON.stringify(inv).includes('9ff1b4c261141730ac2fe0683f730062'));
  assert.ok(!JSON.stringify(inv).includes('@gmail.com'));
});
test('Cloudflare account resource counts cannot be misreported as verified central services',()=>{
  assert.equal(inv.observations.d1_databases_count,1);
  assert.equal(inv.observations.queues_count,0);
  assert.equal(inv.observations.id_starry_script_found,true);
  assert.equal(inv.observations.id_starry_settings_bindings_count,0);
  assert.equal(inv.observations.physical_auth_d1_verified,false);
  assert.equal(inv.observations.physical_billing_d1_verified,false);
  assert.equal(inv.observations.physical_battery_d1_verified,false);
  assert.equal(inv.observations.physical_queue_dlq_verified,false);
  assert.equal(inv.observations.latest_cloudflare_preview_success_verified,false);
  assert.ok(inv.important_limitations.some(x=>x.includes('account')));
});
test('read-only physical metadata cannot set official release, Store, billing or new D1/Queue permissions',()=>{
  assert.ok(Object.entries(inv.gates).every(([k,v])=>k==='official_release_gates_blocked'?v===11:v===false));
  assert.equal(release.gates.length,11);
  assert.ok(release.gates.every(x=>x.status==='blocked'));
  assert.equal(release.release_authorization.granted,false);
  assert.equal(release.deployment_automation.can_auto_deploy,false);
  assert.equal(inv.decision_requests.R25_00.includes('authorize'),true);
});
