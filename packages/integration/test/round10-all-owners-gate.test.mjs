import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_STARRY_RECOVERY_FENCES_ENABLED} from '../../../modules/starry-id-v1/src/round10-recovery-fences.ts';
import {RECONCILIATION_D1_PUBLISHABLE} from '../../rebuild-billing/src/reconciliation-d1-ports.ts';
import {BATTERY_D1_SETTLEMENT_LIVE} from '../../rebuild-ai3/src/battery-settlement-d1.ts';
import {LIVE_TASK_RECOVERY_ENABLED,MAX_REVIEW_TASKS} from '../../../apps/api/src/task-recovery-integrity.ts';
import {LIVE_RECOVERY_ENABLED,RESTORE_MUTATION_ALLOWED,FENCE_NAMES} from '../../rebuild-ai3/src/recovery-guard.ts';
import {LIVE_TASK_PROOF_ENABLED} from '../../../apps/api/src/task-evidence.ts';
import {LIVE_ANONYMOUS_APPEALS_ENABLED} from '../../rebuild-ai3/src/anonymous-appeals.ts';
import {LIVE_BATTERY_WRITES_ENABLED} from '../../rebuild-ai3/src/free-battery.ts';
import {ATOMIC_TASK_SETTLEMENT_LIVE} from '../../../apps/api/src/task-atomic-settlement.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';

test('AI-0 R10 all four original owner modules are imported at the same checkout and cannot publish live actions',()=>{
  assert.equal(LIVE_STARRY_RECOVERY_FENCES_ENABLED,false);
  assert.equal(RECONCILIATION_D1_PUBLISHABLE,false);
  assert.equal(BATTERY_D1_SETTLEMENT_LIVE,false);
  assert.equal(LIVE_TASK_RECOVERY_ENABLED,false);
  assert.equal(LIVE_RECOVERY_ENABLED,false);
  assert.equal(RESTORE_MUTATION_ALLOWED,false);
  assert.equal(LIVE_TASK_PROOF_ENABLED,false);
  assert.equal(LIVE_ANONYMOUS_APPEALS_ENABLED,false);
  assert.equal(LIVE_BATTERY_WRITES_ENABLED,false);
  assert.equal(ATOMIC_TASK_SETTLEMENT_LIVE,false);
  assert.equal(RELEASE_AUTHORIZED,false);
});
test('AI-0 R10 recovery scope remains strictly review-only and protects all seven domains',()=>{
  assert.deepEqual([...FENCE_NAMES],[
    'deleted_members','revoked_sessions','claimed_registration_gifts',
    'battery_journal','committed_ai_tasks','billing_outbox','audit_events'
  ]);
  assert.equal(RESTORE_MUTATION_ALLOWED,false);
  assert.equal(MAX_REVIEW_TASKS,256);
});
