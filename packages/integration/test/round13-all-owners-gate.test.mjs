import test from 'node:test';
import assert from 'node:assert/strict';

import {LIVE_ONE_USE_DELETION_ENABLED} from '../../../modules/starry-id-v1/src/round13-one-use-deletion.ts';
import {LIVE_AUTH_SIGNED_HEAD_ENABLED} from '../../../modules/starry-id-v1/src/round12-signed-head.ts';
import {BILLING_SIGNED_HEAD_LIVE_ENABLED,BILLING_SIGNED_HEAD_RESTORE_ALLOWED} from '../../rebuild-billing/src/signed-billing-head.ts';
import {BILLING_SIGNED_WITNESS_LIVE_ENABLED} from '../../rebuild-billing/src/signed-billing-witness.ts';
import {LIVE_DUAL_SIGNED_AUDIT_HEAD_ENABLED,AUDIT_HEAD_MAY_RESTORE,SIGNED_AUDIT_HEAD_SCHEMA} from '../../rebuild-ai3/src/signed-audit-head.ts';
import {LIVE_SIGNED_AUDIT_RECOVERY_ENABLED} from '../../rebuild-ai3/src/signed-audit-recovery.ts';
import {DUAL_SIGNED_TASK_HEAD_LIVE,SIGNED_TASK_HEAD_VERSION,TASK_HEAD_MAX_VALIDITY_MS} from '../../../apps/api/src/round13-dual-signed-task-head.ts';
import {SIGNED_TASK_PROOF_LIVE} from '../../../apps/api/src/round12-signed-task-proof.ts';
import {LIVE_BATTERY_DEEP_RESTORE_ENABLED} from '../../rebuild-ai3/src/battery-recovery-integrity.ts';
import {BATTERY_D1_SETTLEMENT_LIVE} from '../../rebuild-ai3/src/battery-settlement-d1.ts';
import {RESTORE_MUTATION_ALLOWED,FENCE_NAMES} from '../../rebuild-ai3/src/recovery-guard.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';

test('AI-0 R13 same-checkout: four real R13 Owner modules fail closed for every live/deletion/recovery/task/Store action',()=>{
 for(const live of [
  LIVE_ONE_USE_DELETION_ENABLED,LIVE_AUTH_SIGNED_HEAD_ENABLED,
  BILLING_SIGNED_HEAD_LIVE_ENABLED,BILLING_SIGNED_HEAD_RESTORE_ALLOWED,
  BILLING_SIGNED_WITNESS_LIVE_ENABLED,
  LIVE_DUAL_SIGNED_AUDIT_HEAD_ENABLED,AUDIT_HEAD_MAY_RESTORE,LIVE_SIGNED_AUDIT_RECOVERY_ENABLED,
  DUAL_SIGNED_TASK_HEAD_LIVE,SIGNED_TASK_PROOF_LIVE,
  LIVE_BATTERY_DEEP_RESTORE_ENABLED,BATTERY_D1_SETTLEMENT_LIVE,RESTORE_MUTATION_ALLOWED,
  RELEASE_AUTHORIZED,
 ])assert.equal(live,false);
});
test('AI-0 R13 dual-signed heads do not lift signed proof freshness/7-domain PITR safety bounds',()=>{
 assert.equal(SIGNED_TASK_HEAD_VERSION,1);
 assert.equal(TASK_HEAD_MAX_VALIDITY_MS,30000);
 assert.equal(SIGNED_AUDIT_HEAD_SCHEMA,'starry.audit.protected-head.v1');
 assert.deepEqual([...FENCE_NAMES],[
  'deleted_members','revoked_sessions','claimed_registration_gifts',
  'battery_journal','committed_ai_tasks','billing_outbox','audit_events'
 ]);
});
