import test from 'node:test';
import assert from 'node:assert/strict';
import {isInitialGiftEvidence} from '../../../modules/starry-id-v1/src/round8-first-gift-guard.ts';
import {BILLING_RECONCILIATION_PUBLISHABLE} from '../../rebuild-billing/src/reconciliation.ts';
import {LIVE_ANONYMOUS_APPEALS_ENABLED} from '../../rebuild-ai3/src/anonymous-appeals.ts';
import {AUTOMATED_AUDIT_PURGE_ENABLED,planAuditReview} from '../../rebuild-ai3/src/audit-retention.ts';
import {LIVE_TASK_PROOF_ENABLED,OFFLINE_TEST_PORT_ONLY} from '../../../apps/api/src/task-evidence.ts';
import {LIVE_BATTERY_WRITES_ENABLED} from '../../rebuild-ai3/src/free-battery.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';

test('AI-0 R8 same-checkout: all four new owner modules keep live actions forbidden',()=>{
  assert.equal(BILLING_RECONCILIATION_PUBLISHABLE,false);
  assert.equal(LIVE_ANONYMOUS_APPEALS_ENABLED,false);
  assert.equal(AUTOMATED_AUDIT_PURGE_ENABLED,false);
  assert.equal(LIVE_TASK_PROOF_ENABLED,false);
  assert.equal(OFFLINE_TEST_PORT_ONLY,true);
  assert.equal(LIVE_BATTERY_WRITES_ENABLED,false);
  assert.equal(RELEASE_AUTHORIZED,false);
});
test('AI-0 R8: client JSON cannot forge trusted identity first gift evidence',()=>{
  assert.equal(isInitialGiftEvidence({purpose:'registration_gift_deduplication',
    brand_id:'starry',fingerprint:'fake',checked_at:1793000000}),false);
});
test('AI-0 R8: cross-brand audit review is blocked before legal adapter access',async()=>{
  const legal={status:async()=>{throw Error('must not query');},approvedReview:async()=>true};
  const verdict=await planAuditReview({brand_id:'hglobal',
    event_ref:'event_123',classification:'ordinary',occurred_at_ms:1793000000000},1793100000000,legal);
  assert.equal(verdict.disposition,'blocked');
  assert.equal(verdict.purge_permitted,false);
});
