import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {holdUnapprovedPrivacyAction, M2_PRIVACY_LIVE_ENABLED} from '../src/m2-privacy-hold.ts';

const matrix = JSON.parse(readFileSync(
  new URL('../docs/m2-privacy-retention-review.v1.json', import.meta.url), 'utf8'));
const actions = [
  'battery_first_gift',
  'retain_cross_account_dedupe_identifier',
  'pitr_snapshot_restore',
  'erase_with_unapproved_retention_plan',
];

test('M2 privacy hold never authorizes execution, Battery grant, retention or restore', () => {
  assert.equal(M2_PRIVACY_LIVE_ENABLED, false);
  for (const action of actions) {
    const result = holdUnapprovedPrivacyAction(action);
    assert.equal(result.action, action);
    assert.equal(result.may_execute, false);
    assert.equal(result.may_grant_battery, false);
    assert.equal(result.may_retain_identifier, false);
    assert.equal(result.may_restore, false);
    assert.equal(result.may_erase_without_approved_plan, false);
    assert.equal(result.live_enabled, false);
    assert.ok(Object.isFrozen(result));
  }
  assert.equal(holdUnapprovedPrivacyAction('battery_first_gift').status, 'pending_eligibility');
});

test('untrusted legal approvals and caller side effect ports cannot promote HOLD', () => {
  const spy = {grant: 0, erase: 0, restore: 0, persist: 0};
  const forged = {action: 'battery_first_gift', approved: true, legal_basis: 'self_asserted',
    grant: () => { spy.grant++; }, erase: () => { spy.erase++; },
    restore: () => { spy.restore++; }, persist: () => { spy.persist++; }};
  assert.throws(() => holdUnapprovedPrivacyAction(forged), /AI3_PRIVACY_ACTION_DENIED/);
  assert.throws(() => holdUnapprovedPrivacyAction(null), /AI3_PRIVACY_ACTION_DENIED/);
  assert.throws(() => holdUnapprovedPrivacyAction('__proto__'), /AI3_PRIVACY_ACTION_DENIED/);
  assert.deepEqual(spy, {grant: 0, erase: 0, restore: 0, persist: 0});
});

test('review ledger cannot be misrepresented as approved legal retention or release', () => {
  assert.equal(matrix.schema_version, 'ai3.m2.privacy-retention-review.v1');
  assert.equal(matrix.scope.brand_id, 'starry');
  assert.equal(matrix.scope.production_enabled, false);
  assert.equal(matrix.state, 'REVIEW_ONLY_NOT_APPROVED');
  for (const value of Object.values(matrix.approvals)) assert.equal(value, false);
  assert.equal(matrix.execution.first_registration_battery_gift, false);
  assert.equal(matrix.execution.pitr_restore, false);
  assert.equal(matrix.execution.cross_account_persistent_tracking, false);
  assert.equal(matrix.execution.account_reregistration_allowed, true);
  assert.equal(matrix.execution.eligibility_status, 'PENDING_VERIFICATION');
});

test('every personal data category has a unique owner and unapproved legal/retention fields', () => {
  const ids = new Set();
  assert.ok(matrix.categories.length >= 10);
  for (const entry of matrix.categories) {
    assert.equal(ids.has(entry.id), false, 'duplicated category ' + entry.id);
    ids.add(entry.id);
    assert.ok(typeof entry.owner === 'string' && entry.owner.length > 0);
    assert.equal(entry.approved, false);
    assert.equal(entry.legal_basis, null);
    assert.equal(entry.retention_duration, null);
    assert.equal(entry.anti_pitr, 'REQUIRES_INDEPENDENT_EVIDENCE');
    assert.equal(entry.external_propagation, 'REQUIRES_MAPPING');
  }
  for (const required of ['member_profile','provider_identity','sessions_and_refresh',
    'oauth_attempts','battery_first_gift','billing_finance','audit_and_outbox',
    'backups_and_pitr','external_processors']) assert.equal(ids.has(required), true);
});

test('repeated evaluation cannot switch from hold to permission', () => {
  for (let i = 0; i < 40; i++) {
    const decision = holdUnapprovedPrivacyAction(actions[i % actions.length]);
    assert.equal(decision.may_execute, false);
  }
});
