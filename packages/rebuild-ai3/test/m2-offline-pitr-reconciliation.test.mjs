import test from 'node:test';
import assert from 'node:assert/strict';
import {
  M2_PITR_RECONCILER_LIVE_ENABLED,reviewOfflinePitrCandidate,
} from '../src/m2-offline-pitr-reconciliation.ts';

const session=(overrides={})=>({
  session_ref:'session_001',auth_version:8,revoked_at:125,...overrides,
});
const member=(overrides={})=>({
  member_ref:'member_001',status:'deleted',auth_version:8,
  profile_present:false,sessions:[session()],...overrides,
});
const candidate=(overrides={})=>({
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  snapshot_generation:20,members:[member()],...overrides,
});
const witness=(overrides={})=>({
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  observed_generation:20,
  records:[{member_ref:'member_001',minimum_auth_version:8,deleted:true}],
  ...overrides,
});

test('even matching snapshots never authorize restore, API, Battery or Queue ACK',()=>{
  const result=reviewOfflinePitrCandidate(candidate(),witness());
  assert.equal(M2_PITR_RECONCILER_LIVE_ENABLED,false);
  assert.equal(result.status,'quarantined_review_required');
  assert.deepEqual(result.risks,[]);
  assert.equal(result.may_restore,false);
  assert.equal(result.may_open_api,false);
  assert.equal(result.may_grant_battery,false);
  assert.equal(result.may_ack_queue,false);
  assert.equal(result.independent_witness_verified,false);
  assert.equal(result.requires_authoritative_reconciliation,true);
  assert.equal(result.live_enabled,false);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.risks),true);
});

test('older PITR epoch and previously deleted live member are quarantined',()=>{
  const r=reviewOfflinePitrCandidate(
    candidate({snapshot_generation:5,members:[member({
      status:'active',profile_present:true,auth_version:2,
      sessions:[session({auth_version:2,revoked_at:null})],
    })]}),
    witness(),
  );
  assert.deepEqual(r.risks,[
    'AUTH_VERSION_ROLLBACK','DELETED_MEMBER_REAPPEARED',
    'DELETED_PROFILE_REAPPEARED','OLD_SESSION_UNREVOKED',
    'SESSION_ACTIVE_AFTER_DELETION','SNAPSHOT_BEHIND_WITNESS',
  ]);
  assert.equal(r.may_restore,false);
});

test('deleted member with restored profile or active session cannot pass risk review',()=>{
  const r=reviewOfflinePitrCandidate(candidate({members:[
    member({profile_present:true,sessions:[session({revoked_at:null})]}),
  ]}),witness());
  assert.deepEqual(r.risks,[
    'DELETED_PROFILE_REAPPEARED','SESSION_ACTIVE_AFTER_DELETION',
  ]);
});

test('member auth-version rollback remains visible even if profile is erased',()=>{
  const r=reviewOfflinePitrCandidate(candidate({members:[
    member({auth_version:3,profile_present:false,sessions:[]}),
  ]}),witness());
  assert.deepEqual(r.risks,['AUTH_VERSION_ROLLBACK']);
});

test('missing individual witness record refuses to assert covered recovery',()=>{
  const r=reviewOfflinePitrCandidate(candidate(),witness({records:[]}));
  assert.deepEqual(r.risks,['CANDIDATE_MEMBER_NOT_IN_WITNESS']);
  assert.equal(r.may_open_api,false);
});

test('empty or stale independent witness still cannot grant restore',()=>{
  const r=reviewOfflinePitrCandidate(candidate({members:[]}),
    witness({observed_generation:1,records:[]}));
  assert.equal(r.may_restore,false);
  assert.equal(r.independent_witness_verified,false);
});

test('cross-brand, production, environment mismatch and untrusted scope denied',()=>{
  for(const pair of [
    [candidate({brand_id:'hglobal'}),witness()],
    [candidate({environment:'production'}),witness()],
    [candidate(),witness({brand_id:'hglobal'})],
    [candidate(),witness({environment:'development'})],
    [candidate({app_id:'echo-starry'}),witness()],
  ]) assert.throws(()=>reviewOfflinePitrCandidate(...pair),/AI3_RECOVERY_/);
});

test('duplicate sessions, members and witness entries or bad versions are denied',()=>{
  for(const [c,w] of [
    [candidate({members:[member(),member()]}),witness()],
    [candidate({members:[member({sessions:[session(),session()]})]}),witness()],
    [candidate(),witness({records:[...witness().records,...witness().records]})],
    [candidate({snapshot_generation:0}),witness()],
    [candidate(),witness({records:[{member_ref:'member_001',minimum_auth_version:0,deleted:true}]})],
    [candidate({members:[member({sessions:[session({revoked_at:-1})]})]}),witness()],
  ]) assert.throws(()=>reviewOfflinePitrCandidate(c,w),/AI3_RECOVERY_EVIDENCE_DENIED/);
});

test('forged legal permission, unsupported witness assertions and side effect ports are rejected',()=>{
  const spy={restore:0,grant:0,send:0,ack:0,erase:0};
  const c={...candidate(),approved:true,restore:()=>{spy.restore++;},
    grant:()=>{spy.grant++;},send:()=>{spy.send++;},
    ack:()=>{spy.ack++;},erase:()=>{spy.erase++;}};
  assert.throws(()=>reviewOfflinePitrCandidate(c,witness()),/AI3_RECOVERY_EVIDENCE_DENIED/);
  assert.throws(()=>reviewOfflinePitrCandidate(candidate(),
    {...witness(),physically_independent:true}),/AI3_RECOVERY_EVIDENCE_DENIED/);
  assert.deepEqual(spy,{restore:0,grant:0,send:0,ack:0,erase:0});
});

test('accessors, prototypes and symbol keys do not invoke attacker controlled fields',()=>{
  let accessed=0;
  const accessor={...candidate()};
  Object.defineProperty(accessor,'members',{enumerable:true,get(){accessed++;throw Error('unsafe getter');}});
  assert.throws(()=>reviewOfflinePitrCandidate(accessor,witness()),/AI3_RECOVERY_EVIDENCE_DENIED/);
  assert.equal(accessed,0);
  assert.throws(()=>reviewOfflinePitrCandidate(Object.create(candidate()),witness()),/AI3_RECOVERY_EVIDENCE_DENIED/);
  const symbol={...candidate(),[Symbol('extra')]:true};
  assert.throws(()=>reviewOfflinePitrCandidate(symbol,witness()),/AI3_RECOVERY_EVIDENCE_DENIED/);
});

test('replaying the same synthetic evidence never changes admission or touches any resource',()=>{
  for(let i=0;i<30;i++){
    const result=reviewOfflinePitrCandidate(candidate(),witness());
    assert.equal(result.status,'quarantined_review_required');
    assert.equal(result.may_restore,false);
  }
});
