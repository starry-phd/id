import test from 'node:test';
import assert from 'node:assert/strict';

import {LIVE_SIGNED_RECOVERY_WITNESS_ENABLED} from '../../../modules/starry-id-v1/src/round11-signed-recovery-witness.ts';
import {LIVE_BILLING_RECOVERY_ENABLED,BILLING_OUTBOX_RESTORE_ALLOWED} from '../../rebuild-billing/src/recovery-outbox-fence.ts';
import {LIVE_BATTERY_DEEP_RESTORE_ENABLED,MAX_REVIEW_WALLETS,MAX_REVIEW_ENTRIES} from '../../rebuild-ai3/src/battery-recovery-integrity.ts';
import {TASK_COMMIT_ACK_LIVE,TASK_DELIVERY_PROTOCOL} from '../../../apps/api/src/task-commit-ack.ts';
import {RESTORE_MUTATION_ALLOWED,LIVE_RECOVERY_ENABLED,FENCE_NAMES} from '../../rebuild-ai3/src/recovery-guard.ts';
import {RECONCILIATION_D1_PUBLISHABLE} from '../../rebuild-billing/src/reconciliation-d1-ports.ts';
import {BATTERY_D1_SETTLEMENT_LIVE} from '../../rebuild-ai3/src/battery-settlement-d1.ts';
import {ATOMIC_TASK_SETTLEMENT_LIVE} from '../../../apps/api/src/task-atomic-settlement.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';

test('R11 same-checkout: real Auth/Billing/Battery/Task owner module exports retain all release prohibitions',()=>{
  assert.equal(LIVE_SIGNED_RECOVERY_WITNESS_ENABLED,false);
  assert.equal(LIVE_BILLING_RECOVERY_ENABLED,false);
  assert.equal(BILLING_OUTBOX_RESTORE_ALLOWED,false);
  assert.equal(LIVE_BATTERY_DEEP_RESTORE_ENABLED,false);
  assert.equal(TASK_COMMIT_ACK_LIVE,false);
  assert.equal(RESTORE_MUTATION_ALLOWED,false);
  assert.equal(LIVE_RECOVERY_ENABLED,false);
  assert.equal(RECONCILIATION_D1_PUBLISHABLE,false);
  assert.equal(BATTERY_D1_SETTLEMENT_LIVE,false);
  assert.equal(ATOMIC_TASK_SETTLEMENT_LIVE,false);
  assert.equal(RELEASE_AUTHORIZED,false);
});

test('R11 same-checkout: bounded restoration and replay fences are maintained',()=>{
  assert.deepEqual([...FENCE_NAMES],[
    'deleted_members','revoked_sessions','claimed_registration_gifts',
    'battery_journal','committed_ai_tasks','billing_outbox','audit_events'
  ]);
  assert.equal(MAX_REVIEW_WALLETS,64);
  assert.equal(MAX_REVIEW_ENTRIES,256);
  assert.equal(TASK_DELIVERY_PROTOCOL,'starry.task-delivery.v0-draft');
});
