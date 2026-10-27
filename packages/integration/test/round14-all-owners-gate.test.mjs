import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {LIVE_STARRY_DELETION_CHALLENGE_ISSUANCE} from '../../../modules/starry-id-v1/src/round14-stepup-issuance.ts';
import {LIVE_ONE_USE_DELETION_ENABLED} from '../../../modules/starry-id-v1/src/round13-one-use-deletion.ts';
import {LIVE_BILLING_DELETION_CONSUMER_ENABLED,BILLING_DELETION_ENTITLEMENT_PUBLISHABLE} from '../../rebuild-billing/src/account-deletion-fence.ts';
import {LIVE_BATTERY_DELETION_CONSUMER_ENABLED} from '../../rebuild-ai3/src/auth-deletion-battery-consumer.ts';
import {TASK_DURABLE_OUTBOX_LIVE,TASK_OUTBOX_VERSION} from '../../../apps/api/src/round14-task-transactional-outbox.ts';
import {BILLING_SIGNED_HEAD_LIVE_ENABLED} from '../../rebuild-billing/src/signed-billing-head.ts';
import {LIVE_DUAL_SIGNED_AUDIT_HEAD_ENABLED} from '../../rebuild-ai3/src/signed-audit-head.ts';
import {DUAL_SIGNED_TASK_HEAD_LIVE} from '../../../apps/api/src/round13-dual-signed-task-head.ts';
import {LIVE_RECOVERY_ENABLED,RESTORE_MUTATION_ALLOWED,FENCE_NAMES} from '../../rebuild-ai3/src/recovery-guard.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';

test('AI-0 R14 four real owner modules: all live deletion, Billing/Battery consumers, Task outbox and restore remain OFF',()=>{
 for(const flag of [
  LIVE_STARRY_DELETION_CHALLENGE_ISSUANCE,
  LIVE_ONE_USE_DELETION_ENABLED,
  LIVE_BILLING_DELETION_CONSUMER_ENABLED,
  BILLING_DELETION_ENTITLEMENT_PUBLISHABLE,
  LIVE_BATTERY_DELETION_CONSUMER_ENABLED,
  TASK_DURABLE_OUTBOX_LIVE,
  BILLING_SIGNED_HEAD_LIVE_ENABLED,
  LIVE_DUAL_SIGNED_AUDIT_HEAD_ENABLED,
  DUAL_SIGNED_TASK_HEAD_LIVE,
  LIVE_RECOVERY_ENABLED,RESTORE_MUTATION_ALLOWED,RELEASE_AUTHORIZED,
 ])assert.equal(flag,false);
});
test('AI-0 R14 same-checkout: Task outbox remains a draft, and all seven anti-resurrection recovery domains persist',()=>{
 assert.equal(TASK_OUTBOX_VERSION,'starry.task-outbox.v0-draft');
 assert.deepEqual([...FENCE_NAMES],[
  'deleted_members','revoked_sessions','claimed_registration_gifts',
  'battery_journal','committed_ai_tasks','billing_outbox','audit_events'
 ]);
});
test('AI-0 R14 cross-DB account-deletion shape gap remains explicit, not falsely called wired E2E',()=>{
 const auth=readFileSync(new URL('../../../modules/starry-id-v1/schema/011_starry_one_use_deletion.UP.DRAFT.sql',import.meta.url),'utf8');
 const billing=readFileSync(new URL('../../rebuild-billing/src/account-deletion-fence.ts',import.meta.url),'utf8');
 const battery=readFileSync(new URL('../../rebuild-ai3/src/auth-deletion-battery-consumer.ts',import.meta.url),'utf8');
 assert.match(auth,/starry_deletion_outbox\(event_id,s_user_id,occurred_at,event_type\)/);
 assert.match(billing,/event_ref:string;\s*event_digest:string;auth_version:number/);
 assert.match(battery,/event_id:string;member_ref:string;occurred_at_sec:number/);
 assert.equal(LIVE_BILLING_DELETION_CONSUMER_ENABLED,false);
 assert.equal(LIVE_BATTERY_DELETION_CONSUMER_ENABLED,false);
});
