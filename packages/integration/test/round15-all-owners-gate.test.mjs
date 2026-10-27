import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {
  LIVE_AUTH_DELETION_EVENT_DELIVERY_ENABLED,
  BILLING_HMAC_DELETION_MAPPING_APPROVED,
} from '../../../modules/starry-id-v1/src/round15-deletion-source-contract.ts';
import {LIVE_STARRY_DELETION_CHALLENGE_ISSUANCE} from '../../../modules/starry-id-v1/src/round14-stepup-issuance.ts';
import {
  LIVE_AUTH_BILLING_DELETE_BRIDGE_ENABLED,
  BILLING_DELETE_CONTRACT_PUBLISHABLE,
  BILLING_DELETE_CONTRACT_VERSION,
} from '../../rebuild-billing/src/auth-deletion-contract.ts';
import {LIVE_BILLING_DELETION_CONSUMER_ENABLED} from '../../rebuild-billing/src/account-deletion-fence.ts';
import {LIVE_AUTH_OUTBOX_BATTERY_BRIDGE_ENABLED} from '../../rebuild-ai3/src/auth-deletion-battery-bridge.ts';
import {LIVE_BATTERY_DELETION_CONSUMER_ENABLED} from '../../rebuild-ai3/src/auth-deletion-battery-consumer.ts';
import {
  LIVE_AUTH_DELETION_RELAY,DELETION_RELAY_VERSION,
} from '../../../apps/api/src/round15-deletion-event-relay.ts';
import {TASK_DURABLE_OUTBOX_LIVE} from '../../../apps/api/src/round14-task-transactional-outbox.ts';
import {RELEASE_AUTHORIZED} from '../../../apps/api/src/staged-policy.ts';
import {RESTORE_MUTATION_ALLOWED,FENCE_NAMES} from '../../rebuild-ai3/src/recovery-guard.ts';
import {inspectSqlDraftInventory,readJson} from '../../../docs/operations/verify-r15-sql-inventory.mjs';

test('R15 single checkout: four real owner Auth→Billing/Battery/Task modules remain entirely fail-closed',()=>{
  for(const flag of [
    LIVE_AUTH_DELETION_EVENT_DELIVERY_ENABLED,
    BILLING_HMAC_DELETION_MAPPING_APPROVED,
    LIVE_STARRY_DELETION_CHALLENGE_ISSUANCE,
    LIVE_AUTH_BILLING_DELETE_BRIDGE_ENABLED,
    BILLING_DELETE_CONTRACT_PUBLISHABLE,
    LIVE_BILLING_DELETION_CONSUMER_ENABLED,
    LIVE_AUTH_OUTBOX_BATTERY_BRIDGE_ENABLED,
    LIVE_BATTERY_DELETION_CONSUMER_ENABLED,
    LIVE_AUTH_DELETION_RELAY,
    TASK_DURABLE_OUTBOX_LIVE,
    RESTORE_MUTATION_ALLOWED,
    RELEASE_AUTHORIZED,
  ])assert.equal(flag,false);
});

test('R15 verified Source contract remains a candidate, never silently promoted into P05 or live Queue ACK',()=>{
  assert.equal(BILLING_DELETE_CONTRACT_VERSION,'starry.billing.account_deleted.candidate.v1');
  assert.equal(DELETION_RELAY_VERSION,'starry.account-deleted-relay.v0-draft');
  assert.deepEqual([...FENCE_NAMES],[
    'deleted_members','revoked_sessions','claimed_registration_gifts',
    'battery_journal','committed_ai_tasks','billing_outbox','audit_events'
  ]);
  const sql=readFileSync(new URL('../../../modules/starry-id-v1/schema/011_starry_one_use_deletion.UP.DRAFT.sql',import.meta.url),'utf8');
  assert.match(sql,/starry_deletion_outbox\(event_id,s_user_id,occurred_at,event_type\)/);
});

test('R15 source-added Auth 013 UP/DOWN is explicitly reviewed, Git Blob-pinned and never a real D1 rollback',()=>{
  const original=readJson('docs/operations/r15-sql-migration-inventory.v0.json');
  const current=readJson('docs/operations/r15-sql-additions.v0.json');
  const release=readJson('docs/release-readiness/release-readiness.v0.json');
  assert.equal(original.entries.length,36);
  assert.equal(current.entries.length,2);
  assert.equal(current.source_pr,110);
  assert.equal(current.live_d1_migration_authorized,false);
  assert.equal(current.production_rollback_approved,false);
  const result=inspectSqlDraftInventory(original,release);
  assert.equal(result.ok,true,result.errors.join('; '));
  assert.equal(result.count,36);
  assert.equal(result.real_d1_schema_migrated,false);
});
