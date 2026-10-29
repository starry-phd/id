import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../../../',import.meta.url);
const amendment=JSON.parse(readFileSync(new URL('packages/rebuild-ai3/docs/W2-D06-PRIVATE-ENVELOPE-VOCAB-AMENDMENT.v1.json',root),'utf8'));
const blobSHA=(path)=>{
  const b=readFileSync(new URL(path,root));
  return createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
};
test('W2 static 01: exact integrated AI1/AI3 source Git blobs remain unchanged',()=>{
  assert.equal(amendment.upstream.fixed_parent,'7316ee0f014a01649eea87a62b3ad6cdb6b1febd');
  for(const s of amendment.source_provenance){
    assert.equal(blobSHA(s.path),s.blob,s.path);
  }
});
test('W2 static 02: names exist in actual pinned owner sources but are not automatic aliases',()=>{
  const ai1=readFileSync(new URL('modules/starry-id-v1/src/w1-auth-boundary-contract.ts',root),'utf8');
  const ai3=JSON.parse(readFileSync(new URL('packages/rebuild-ai3/docs/W1-D87-D06-AUTH-INBOX-ACK-CONTRACT.v1.json',root),'utf8'));
  for(const n of ['issuer','signature','session_version','auth_version','kid','nonce'])assert.match(ai1,new RegExp("'"+n+"'"));
  for(const n of ['issuer_ref','integrity_signature'])assert.ok(ai3.envelope.required_if_verified_delivery_candidate.includes(n),n);
  for(const n of ['current_auth_version','current_session_version'])assert.ok(ai3.envelope.conditional_server_only_candidates.includes(n),n);
  const pairs=amendment.field_reconciliation;
  for(const [a,b] of amendment.critical_distinctions.no_automatic_aliases)
    assert.ok(pairs.some(p=>p.ai1===a&&p.ai3===b&&p.mapping==='NO_ALIAS'),a+'/'+b);
});
test('W2 static 03: candidate vocabulary does not collapse origin and observed Session or proof classes',()=>{
  const v=amendment.canonical_review_vocabulary;
  assert.ok(v.source_session_version&&v.observed_session_version);
  assert.ok(v.source_auth_version&&v.observed_auth_version);
  assert.ok(v.source_issuer_identity&&v.issuer_registry_ref);
  assert.ok(v.integrity_proof&&v.business_core_digest);
  assert.notEqual(v.source_session_version,v.observed_session_version);
  assert.match(amendment.version_strategy.compatibility,/explicit/);
  assert.match(amendment.version_strategy.canonicalization,/No final wire format/);
  assert.equal(amendment.proof_status,'SOURCE_GROUNDED_STATIC_REVIEW_ONLY');
});
test('W2 static 04: server-origin revoke/delete not blocked merely due to invalidated member session',()=>{
  const [server,user]=amendment.delivery_modes;
  assert.equal(server.name,'SERVER_COMMITTED_REVOCATION_OR_DELETION');
  assert.equal(server.member_session_requirement,'DO_NOT_REQUIRE_ACTIVE_MEMBER_SESSION_AFTER_REVOKE');
  assert.ok(server.event_types.includes('identity.member.deleted'));
  assert.ok(server.event_types.includes('identity.session.revoked'));
  assert.match(server.trusted_source,/AI-1 Auth unique writer/);
  assert.equal(user.name,'USER_NOTIFICATION_DELIVERY');
  assert.equal(user.member_session_requirement,'REQUIRE_CURRENT_ACTIVE_AUTH_SESSION_WHEN_POLICY_APPLICABLE');
  assert.deepEqual(user.event_types,['notification.delivery.queued']);
  for(const mode of amendment.delivery_modes){assert.equal(mode.status,'REVIEW_ONLY');assert.equal(mode.may_ack,false);assert.equal(mode.may_send,false);}
});
test('W2 static 05: this is not a live signer, issuer release or legally-approved retention',()=>{
  assert.equal(amendment.release.gates_blocked,11);
  for(const k of ['p05_publishable','authorization_granted','independent_witness_verified','legal_q104_q119_approved','ads_enabled','may_ack','may_send','may_sign','may_erase','may_restore','may_deploy','may_change_shared_schema']) assert.equal(amendment.release[k],false,k);
  assert.equal(amendment.release.battery_free,true);
  assert.equal(amendment.version_strategy.decision_status,'PROPOSAL_NOT_APPROVED');
  assert.match(amendment.version_strategy.layer1,/unknown G06 thirteenth field/);
});
