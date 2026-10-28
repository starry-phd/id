import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessR23G07,inspectCheckout,scanWranglerDeclarations} from '../tools/r23-g07-readiness-preflight.mjs';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const cli=resolve(root,'packages/rebuild-ai3/tools/r23-g07-readiness-preflight.mjs');
const blocked={gates:[{id:'G07-AUDIT-QUEUE',status:'blocked'}],
 release_authorization:{granted:false},deployment_automation:{can_auto_deploy:false}};
const declared='[[env.staging.d1_databases]]\nbinding="BATTERY_DB"\ndatabase_name="starry_battery"\ndatabase_id="00000000-0000-4000-8000-000000000001"\n[[env.staging.queues.producers]]\nbinding="BATTERY_QUEUE"\nqueue="battery-audit"\n[[env.staging.queues.consumers]]\nqueue="battery-audit"\ndead_letter_queue="battery-dlq"';
test('actual checkout: no staging D1/Queue bindings, official G07 remains blocked',()=>{
 const v=inspectCheckout(root);
 assert.equal(v.status,'blocked');
 assert.equal(v.topology.d1_binding_declared,false);
 assert.equal(v.topology.queue_producer_declared,false);
 assert.equal(v.topology.queue_consumer_with_dlq_declared,false);
 for(const s of ['STAGING_D1_BINDING_NOT_DECLARED','OFFICIAL_G07_NOT_PASSED','OWNER_RELEASE_NOT_AUTHORIZED'])
  assert.ok(v.missing.includes(s));
 assert.equal(v.verified_live,false);assert.equal(v.may_deploy,false);
});
test('comments and root-only D1 must not masquerade as staging resources',()=>{
 const text='# '+declared.replaceAll('\n','\n# ')+'\n[[d1_databases]]\nbinding="B"\ndatabase_name="N"\ndatabase_id="00000000-0000-4000-8000-000000000001"';
 const v=assessR23G07({wranglerToml:text,releaseJson:blocked});
 assert.equal(v.topology.d1_binding_declared,false);
 assert.equal(v.topology.queue_producer_declared,false);
});
test('valid-looking D1/Queue/DLQ still never means physically verified or ACK',()=>{
 const v=assessR23G07({wranglerToml:declared,releaseJson:blocked});
 assert.equal(v.topology.d1_binding_declared,true);
 assert.equal(v.topology.queue_consumer_with_dlq_declared,true);
 assert.ok(v.missing.includes('PHYSICAL_D1_QUEUE_AND_ACK_NOT_LIVE_VERIFIED'));
 assert.ok(v.missing.includes('INDEPENDENT_NONROLLBACK_PITR_WITNESS_NOT_ATTESTED'));
 assert.equal(v.status,'blocked');assert.equal(v.may_ack_queue,false);
});
test('forged local official passed/approval is not external attestation',()=>{
 const fake={gates:[{id:'G07-AUDIT-QUEUE',status:'passed'}],
  release_authorization:{granted:true},deployment_automation:{can_auto_deploy:true}};
 const v=assessR23G07({wranglerToml:declared,releaseJson:fake});
 assert.equal(v.status,'blocked');assert.equal(v.may_deploy,false);
 assert.ok(v.missing.includes('CROSS_D1_ADR_87_AB_NOT_APPROVED'));
});
test('production and unrelated environment are not inferred as valid staging',()=>{
 assert.throws(()=>scanWranglerDeclarations(declared,'production'),/INVALID_WRANGLER/);
 assert.equal(scanWranglerDeclarations(declared,'development').d1_count,0);
});
test('placeholder D1 resource cannot count as a real declaration',()=>{
 assert.equal(scanWranglerDeclarations(declared.replace('00000000-0000-4000-8000-000000000001','REPLACE_ME')).d1_count,0);
});
test('missing or duplicate official G07 is a manifest integrity error',()=>{
 assert.throws(()=>assessR23G07({wranglerToml:declared,releaseJson:{...blocked,gates:[]}}),/G07_MANIFEST/);
 assert.throws(()=>assessR23G07({wranglerToml:declared,releaseJson:{...blocked,gates:[blocked.gates[0],blocked.gates[0]]}}),/G07_MANIFEST/);
});
test('report never echoes DB UUID, name or inline secret',()=>{
 const secret='unexpected_private_secret_12345';
 const v=assessR23G07({wranglerToml:declared+'\n[env.staging.vars]\nKEY="'+secret+'"',releaseJson:blocked});
 assert.equal(JSON.stringify(v).includes(secret),false);
 assert.equal(JSON.stringify(v).includes('00000000-0000-4000-8000-000000000001'),false);
});
test('CLI --assert-blocked passes while --assert-ready must fail closed',()=>{
 const a=spawnSync(process.execPath,[cli,'--assert-ready'],{cwd:root,encoding:'utf8'});
 const b=spawnSync(process.execPath,[cli,'--assert-blocked'],{cwd:root,encoding:'utf8'});
 assert.equal(a.status,1,a.stderr);
 assert.equal(b.status,0,b.stderr);
 assert.equal(JSON.parse(b.stdout).verified_live,false);
});
