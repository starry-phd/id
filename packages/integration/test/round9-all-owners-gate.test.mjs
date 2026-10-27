import test from 'node:test';
import assert from 'node:assert/strict';
import {isTrustedReviewerReceipt} from '../../../modules/starry-id-v1/src/round9-appeal-reviewer.ts';
import {RECONCILIATION_D1_PUBLISHABLE} from '../../rebuild-billing/src/reconciliation-d1-ports.ts';
import {LIVE_RECOVERY_ENABLED,RESTORE_MUTATION_ALLOWED,FENCE_NAMES} from '../../rebuild-ai3/src/recovery-guard.ts';
import {ATOMIC_TASK_SETTLEMENT_LIVE} from '../../../apps/api/src/task-atomic-settlement.ts';
import {LIVE_BATTERY_WRITES_ENABLED} from '../../rebuild-ai3/src/free-battery.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';
import {BILLING_RECONCILIATION_PUBLISHABLE} from '../../rebuild-billing/src/reconciliation.ts';
import {LIVE_ANONYMOUS_APPEALS_ENABLED} from '../../rebuild-ai3/src/anonymous-appeals.ts';

// Real module imports from all R9 owners in one checkout; OFFLINE only.
// A green result never means Apple/Play, D1 PITR, R2, EAS or OAuth is live.
test('R9 cross-owner release flags remain fail-closed simultaneously',()=>{
  assert.equal(RECONCILIATION_D1_PUBLISHABLE,false);
  assert.equal(LIVE_RECOVERY_ENABLED,false);
  assert.equal(RESTORE_MUTATION_ALLOWED,false);
  assert.equal(ATOMIC_TASK_SETTLEMENT_LIVE,false);
  assert.equal(LIVE_BATTERY_WRITES_ENABLED,false);
  assert.equal(RELEASE_AUTHORIZED,false);
  assert.equal(BILLING_RECONCILIATION_PUBLISHABLE,false);
  assert.equal(LIVE_ANONYMOUS_APPEALS_ENABLED,false);
});
test('R9 anonymous appeal reviewer cannot use a fabricated client JSON receipt',()=>{
  const forged={case_ref:'case_'+('a'.repeat(64)),purpose:'appeal:review_status',
     status:'received',updated_ms:1793000000000,checked_at:1793000000};
  assert.equal(isTrustedReviewerReceipt(forged),false);
  assert.equal(isTrustedReviewerReceipt(Object.freeze({...forged})),false);
});
test('R9 restore fence includes identity deletion, first gift, task, Billing and audits',()=>{
  const required=['deleted_members','revoked_sessions','claimed_registration_gifts',
    'battery_journal','committed_ai_tasks','billing_outbox','audit_events'];
  assert.deepEqual([...FENCE_NAMES],required);
  assert.equal(new Set(FENCE_NAMES).size,required.length);
  assert.equal(RESTORE_MUTATION_ALLOWED,false);
});
