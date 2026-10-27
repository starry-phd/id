import test from 'node:test';
import assert from 'node:assert/strict';

import {LIVE_AUTH_SIGNED_HEAD_ENABLED} from '../../../modules/starry-id-v1/src/round12-signed-head.ts';
import {LIVE_SIGNED_RECOVERY_WITNESS_ENABLED} from '../../../modules/starry-id-v1/src/round11-signed-recovery-witness.ts';
import {BILLING_SIGNED_WITNESS_LIVE_ENABLED} from '../../rebuild-billing/src/signed-billing-witness.ts';
import {LIVE_BILLING_RECOVERY_ENABLED,BILLING_OUTBOX_RESTORE_ALLOWED} from '../../rebuild-billing/src/recovery-outbox-fence.ts';
import {LIVE_SIGNED_AUDIT_RECOVERY_ENABLED,AUDIT_RESTORE_ALLOWED} from '../../rebuild-ai3/src/signed-audit-recovery.ts';
import {SIGNED_TASK_PROOF_LIVE,SIGNED_TASK_VERSION,SIGNED_TASK_MAX_AGE_MS} from '../../../apps/api/src/round12-signed-task-proof.ts';
import {TASK_COMMIT_ACK_LIVE} from '../../../apps/api/src/task-commit-ack.ts';
import {BATTERY_D1_SETTLEMENT_LIVE} from '../../rebuild-ai3/src/battery-settlement-d1.ts';
import {LIVE_BATTERY_DEEP_RESTORE_ENABLED} from '../../rebuild-ai3/src/battery-recovery-integrity.ts';
import {RESTORE_MUTATION_ALLOWED,LIVE_RECOVERY_ENABLED,FENCE_NAMES} from '../../rebuild-ai3/src/recovery-guard.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';

test('AI-0 R12: real R12 Auth, Billing, Audit and Task TypeScript modules stay default OFF together',()=>{
  for(const live of [
    LIVE_AUTH_SIGNED_HEAD_ENABLED,
    LIVE_SIGNED_RECOVERY_WITNESS_ENABLED,
    BILLING_SIGNED_WITNESS_LIVE_ENABLED,
    LIVE_BILLING_RECOVERY_ENABLED,
    BILLING_OUTBOX_RESTORE_ALLOWED,
    LIVE_SIGNED_AUDIT_RECOVERY_ENABLED,
    AUDIT_RESTORE_ALLOWED,
    SIGNED_TASK_PROOF_LIVE,
    TASK_COMMIT_ACK_LIVE,
    BATTERY_D1_SETTLEMENT_LIVE,
    LIVE_BATTERY_DEEP_RESTORE_ENABLED,
    RESTORE_MUTATION_ALLOWED,
    LIVE_RECOVERY_ENABLED,
    RELEASE_AUTHORIZED,
  ])assert.equal(live,false);
});
test('AI-0 R12: task signed envelope version/freshness is bounded and all seven restore fences persist',()=>{
  assert.equal(SIGNED_TASK_VERSION,1);
  assert.equal(SIGNED_TASK_MAX_AGE_MS,30000);
  assert.deepEqual([...FENCE_NAMES],[
    'deleted_members','revoked_sessions','claimed_registration_gifts',
    'battery_journal','committed_ai_tasks','billing_outbox','audit_events'
  ]);
});
