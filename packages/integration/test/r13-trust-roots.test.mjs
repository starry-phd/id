import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson,validateTrustPreflight} from '../../../docs/operations/verify-r13-trust-roots.mjs';

import {LIVE_AUTH_SIGNED_HEAD_ENABLED} from '../../../modules/starry-id-v1/src/round12-signed-head.ts';
import {BILLING_SIGNED_WITNESS_LIVE_ENABLED} from '../../rebuild-billing/src/signed-billing-witness.ts';
import {LIVE_BATTERY_DEEP_RESTORE_ENABLED} from '../../rebuild-ai3/src/battery-recovery-integrity.ts';
import {SIGNED_TASK_PROOF_LIVE} from '../../../apps/api/src/round12-signed-task-proof.ts';
import {LIVE_SIGNED_AUDIT_RECOVERY_ENABLED} from '../../rebuild-ai3/src/signed-audit-recovery.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';

const registry=readJson('docs/operations/r13-trust-roots.v0.json');
const official=readJson('docs/release-readiness/release-readiness.v0.json');
const clone=a=>JSON.parse(JSON.stringify(a));
function rejected(edit,release=official){
 const m=clone(registry);edit(m);
 const result=validateTrustPreflight(m,release);
 assert.equal(result.ok,false,JSON.stringify(result));
}

test('R13 cross-owner trust proposals: all five modules remain closed and official gates remain blocked',()=>{
 const r=validateTrustPreflight(registry,official);
 assert.equal(r.ok,true,r.errors.join('; '));
 assert.equal(r.domain_count,5);
 for(const value of [LIVE_AUTH_SIGNED_HEAD_ENABLED,BILLING_SIGNED_WITNESS_LIVE_ENABLED,LIVE_BATTERY_DEEP_RESTORE_ENABLED,SIGNED_TASK_PROOF_LIVE,LIVE_SIGNED_AUDIT_RECOVERY_ENABLED,RELEASE_AUTHORIZED])
   assert.equal(value,false);
});
test('R13 cannot reuse a signing-key namespace across Auth and Billing',()=>rejected(a=>{a.domains[1].key_namespace=a.domains[0].key_namespace}));
test('R13 cannot invent a real independent anchor',()=>rejected(a=>{a.domains[2].protected_independent_head='present'}));
test('R13 cannot silently mark trusted keys and KMS provisioned',()=>rejected(a=>{a.signing_authority_ready=true}));
test('R13 cannot silently assert authorization to deploy',()=>rejected(a=>{a.deploy_authorized=true}));
test('R13 cannot place H-Global in the Starry trust domain inventory',()=>rejected(a=>{a.scope='starry_and_hglobal'}));
test('R13 cannot omit the Audit domain',()=>rejected(a=>{a.domains.pop()}));
test('R13 cannot fabricate legal retention approval',()=>rejected(a=>{a.domains[0].lawful_retention='approved'}));
test('R13 cannot unlock the real G00 release gate',()=>{
 const release=clone(official);release.gates[0].status='approved';
 const r=validateTrustPreflight(registry,release);assert.equal(r.ok,false);
});
