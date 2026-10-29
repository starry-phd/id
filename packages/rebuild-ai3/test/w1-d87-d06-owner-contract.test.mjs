import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dispatchQueueMessage} from '../src/queue-transport.ts';

const c=JSON.parse(readFileSync(new URL('../docs/W1-D87-D06-AUTH-INBOX-ACK-CONTRACT.v1.json',import.meta.url),'utf8'));
const name='b_'+ 'a'.repeat(64);
const msg=(spy,attempts=1)=>({
  body:{event_ref:name},attempts,
  ack(){spy.ack++},
  retry(){spy.retry++}
});
const fakeDlq={async persist(){throw Error('NO_REAL_DLQ')}};
test('W1 01: D87/D06/D00 are directions, not final schemas or live gates',()=>{
  assert.equal(c.approved_directions.D87,'A_SINGLE_TRANSACTION_AUTHORITY_DIRECTION_ONLY');
  assert.equal(c.approved_directions.D06,'A_BUSINESS_CORE_PLUS_PRIVATE_DELIVERY_ENVELOPE_DIRECTION_ONLY');
  assert.equal(c.contract_not_final,true);
  assert.equal(c.official_g06_13_field_source_unresolved,true);
  assert.equal(c.ai0_r006_17_field_candidate_not_authoritative,true);
  assert.equal(c.flags.w1_live,false);
  assert.equal(c.flags.may_ack_real_queue,false);
  assert.equal(c.flags.formal_p05_schema_approved,false);
  assert.equal(c.gates.G07,'blocked');
  assert.equal(c.gates.release_authorization_granted,false);
});
test('W1 02: D06 core exact 11 fields; no invented 13th or version aliases',()=>{
  assert.deepEqual(c.core.required_review_candidates,[
  'event_id','event_type','schema_version','brand_id','app_id','environment',
  'occurred_at','correlation_id','resource_type','resource_id','result']);
  assert.deepEqual(c.core.conditional_review_candidates,[{field:'idempotency_key',when:'retry, payment or at-least-once delivery'}]);
  assert.equal(c.core.required_review_candidates.includes('issued_at'),false);
  assert.equal(c.core.required_review_candidates.includes('version'),false);
  assert.equal(c.envelope.required_if_verified_delivery_candidate.includes('integrity_signature'),true);
  assert.equal(c.envelope.required_if_verified_delivery_candidate.includes('nonce'),true);
});
test('W1 03: P0 Auth revocation/deletion and P06 erasure use AI-1 source, not Billing consumer',()=>{
  const find=t=>c.events.find(e=>e.event_type===t);
  for(const t of ['identity.session.revoked','identity.member.deleted','privacy.erasure.requested']){
    assert.equal(find(t).phase,'P0_MEMBER');
    assert.match(find(t).source_writer,/AI-1/);
  }
  assert.equal(find('billing.store_state_observed').phase,'LATER_BILLING');
  assert.match(c.legacy_auth_deletion_adapter,/NOT a canonical D06/);
});
test('W1 04: state table with retry, digest conflict, legal hold, late deletion and PITR never permits real ACK',()=>{
  const states=new Set(c.state_matrix.map(x=>x.state));
  assert.equal(states.size,c.state_matrix.length);
  for(const key of ['SOURCE_UNCOMMITTED','AUTH_STALE_OR_REVOKED','LEGAL_UNKNOWN_OR_HOLD','INBOX_TRANSACTION_CRASH','DUPLICATE_COMPETING_DIGEST','LATE_ERASURE_OR_REVOKE','PITR_RESTORED_OLD_FLOOR','WITNESS_NOT_INDEPENDENT','DLQ_PERSIST_FAILED','FINAL_ACK_REVIEW']){
    assert.ok(states.has(key),key);
  }
  for(const row of c.state_matrix){
    assert.equal(row.may_live_ack,false,row.state);
    assert.equal(row.may_real_erase,false,row.state);
    assert.equal(row.may_restore,false,row.state);
    assert.equal(row.may_grant_battery,false,row.state);
  }
});
test('W1 05: public layers reject secrets/PII; Q104/Q119 cannot import an inferred retention period',()=>{
  assert.ok(c.core.forbidden_public_core.includes('raw_session_token'));
  assert.ok(c.core.forbidden_public_core.includes('raw_email'));
  assert.ok(c.envelope.forbidden.includes('client_supplied_verified_true'));
  assert.ok(c.envelope.forbidden.includes('raw_key_material'));
  assert.equal(c.flags.legal_q104_q119_approved,false);
  assert.equal(c.flags.independent_durable_witness_verified,false);
  assert.ok(c.legal_choices.length>=2);
  for(const p of c.legal_choices){assert.equal(p.retention,'UNSPECIFIED');assert.equal(p.status,'proposed_review');}
});
test('W1 06: existing Queue adapter must retry a synthetic ack without ack_safe proof',async()=>{
  const seen={ack:0,retry:0};
  const out=await dispatchQueueMessage(msg(seen),{
    async consume(){return {outcome:'ack',ack_safe:false,reason:'NO_TRUSTED_PROOF',retry_after_ms:0}}
  },fakeDlq);
  assert.equal(out,'retried');assert.deepEqual(seen,{ack:0,retry:1});
});
test('W1 07: existing Queue adapter must retry if DLQ persistence is not durable',async()=>{
  const seen={ack:0,retry:0};
  const out=await dispatchQueueMessage(msg(seen,6),{
    async consume(){return {outcome:'dlq_required',ack_safe:false,reason:'TRANSIENT_SOURCE_ERROR',retry_after_ms:0}}
  },fakeDlq);
  assert.equal(out,'retried');assert.deepEqual(seen,{ack:0,retry:1});
});
