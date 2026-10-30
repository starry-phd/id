import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {inspectLocalMemberErasureForeignKeys,
  M2_PHYSICAL_ERASURE_LIVE_ENABLED} from '../src/m2-local-erasure-fk-preflight.ts';

const load = path => readFileSync(new URL(path, import.meta.url),'utf8');
const ID='test-user-0001', NOW=1793400000;
function fixture({audit=true,m1=true,m2=true}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(load('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql'));
  if(m1)db.exec(load('../../../modules/starry-id-v1/schema/002_m1_local_oauth_attempts.DRAFT.sql'));
  if(m2)db.exec(load('../../../modules/starry-id-v1/schema/003_m2_local_member_self_mutations.DRAFT.sql'));
  db.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
    .run(ID,'active',2,1,'synthetic display name',1,1,NOW,NOW);
  db.prepare('INSERT INTO starry_identities VALUES(?,?,?)')
    .run('google','synthetic-subject',ID);
  db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)')
    .run('session-one',ID,'starry-id','staging',2,'synthetic-refresh-hash',NOW+600);
  db.prepare('INSERT INTO starry_admin_grants VALUES(?,?,?,?,?,?,?)')
    .run('grant-one',ID,'starry-id','staging','member:suspend',NOW+600,null);
  if(audit && m1) db.prepare(
    'INSERT INTO starry_m1_audit_intents VALUES(?,?,?,?,?,?,?,?)')
    .run('event-one','operation-one','session_issued','starry','starry-id','staging',ID,NOW);
  if(audit && m2) db.prepare(
    'INSERT INTO starry_m2_member_mutation_audit(event_id,event_type,s_user_id,session_id,app_id,environment,profile_revision,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('m2-profile-'+ID+'-1','profile_updated',ID,null,'starry-id',null,1,NOW);
  return db;
}
function row(db,sql,...params){return db.prepare(sql).get(...params);}
function counts(db){
  return {
    member:row(db,'SELECT COUNT(*) AS n FROM starry_members WHERE s_user_id=?',ID).n,
    member_version:row(db,'SELECT auth_version FROM starry_members WHERE s_user_id=?',ID)?.auth_version,
    active:row(db,'SELECT status FROM starry_members WHERE s_user_id=?',ID)?.status,
    revoked:row(db,"SELECT revoked_at FROM starry_sessions WHERE session_id='session-one'")?.revoked_at,
    m1:row(db,'SELECT COUNT(*) AS n FROM starry_m1_audit_intents').n,
    m2:row(db,'SELECT COUNT(*) AS n FROM starry_m2_member_mutation_audit').n,
  };
}
test('real 001+002+003 schema: TWO audit FKs and source Auth edges block physical deletion',()=>{
  const db=fixture();try{
    const before=row(db,'SELECT total_changes() AS n').n;
    const review=inspectLocalMemberErasureForeignKeys(db,ID);
    assert.equal(M2_PHYSICAL_ERASURE_LIVE_ENABLED,false);
    assert.equal(review.status,'quarantined_source_review');
    assert.equal(review.foreign_keys_enforced,true);
    assert.equal(review.referential_integrity_ok,true);
    assert.deepEqual({...review.referenced_rows},{
      provider_identity:1,session_refresh:1,admin_grant:1,
      m1_audit_intent:1,m2_mutation_audit:1,
    });
    assert.deepEqual(review.unexpected_member_fk_tables,[]);
    assert.ok(review.blockers.includes('REFERENCING_MEMBER_ROWS'));
    assert.equal(review.may_delete_member,false);
    assert.equal(review.may_erase_audit,false);
    assert.equal(review.may_execute_transaction,false);
    assert.equal(review.may_restore,false);
    assert.equal(review.may_grant_battery,false);
    assert.equal(Object.isFrozen(review),true);
    assert.equal(row(db,'SELECT total_changes() AS n').n,before);
    assert.equal(JSON.stringify(review).includes(ID),false);
    assert.equal(JSON.stringify(review).includes('synthetic-subject'),false);
  }finally{db.close();}
});

test('actual FK constraint prevents physical removal even AFTER identity/session/admin cleanup, as both audit tables still link member',()=>{
  const db=fixture();try{
    db.exec('BEGIN IMMEDIATE');
    db.prepare('DELETE FROM starry_sessions WHERE s_user_id=?').run(ID);
    db.prepare('DELETE FROM starry_identities WHERE s_user_id=?').run(ID);
    db.prepare('DELETE FROM starry_admin_grants WHERE s_user_id=?').run(ID);
    const linked=db.prepare('SELECT COUNT(*) AS n FROM starry_m1_audit_intents WHERE s_user_id=?').get(ID).n
      +db.prepare('SELECT COUNT(*) AS n FROM starry_m2_member_mutation_audit WHERE s_user_id=?').get(ID).n;
    assert.equal(linked,2);
    assert.throws(()=>db.prepare('DELETE FROM starry_members WHERE s_user_id=?').run(ID),
      /FOREIGN KEY constraint failed/);
    db.exec('ROLLBACK');
    assert.deepEqual(counts(db),{
      member:1,member_version:2,active:'active',revoked:null,m1:1,m2:1,
    });
  }finally{db.close();}
});

test('same-source status change, auth version bump and all-session revocation must ROLLBACK if physical erasure fails',()=>{
  const db=fixture();try{
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare("UPDATE starry_members SET status='deleted',auth_version=auth_version+1,display_name=NULL,directory_opt_in=0,display_name_public=0,updated_at=? WHERE s_user_id=? AND status='active' AND auth_version=?")
        .run(NOW+1,ID,2);
      db.prepare('UPDATE starry_sessions SET revoked_at=? WHERE s_user_id=? AND revoked_at IS NULL')
        .run(NOW+1,ID); // real 003 trigger inserts *another linked audit FK*.
      assert.equal(row(db,"SELECT COUNT(*) AS n FROM starry_m2_member_mutation_audit").n,2);
      db.prepare('DELETE FROM starry_identities WHERE s_user_id=?').run(ID);
      db.prepare('DELETE FROM starry_sessions WHERE s_user_id=?').run(ID);
      db.prepare('DELETE FROM starry_admin_grants WHERE s_user_id=?').run(ID);
      assert.throws(()=>db.prepare('DELETE FROM starry_members WHERE s_user_id=?').run(ID),
        /FOREIGN KEY constraint failed/);
    }finally{db.exec('ROLLBACK');}
    assert.deepEqual(counts(db),{
      member:1,member_version:2,active:'active',revoked:null,m1:1,m2:1,
    });
    const profile=row(db,'SELECT display_name,directory_opt_in FROM starry_members WHERE s_user_id=?',ID);
    assert.equal(profile.display_name,'synthetic display name');
    assert.equal(profile.directory_opt_in,1);
  }finally{db.close();}
});

test('even a member with no linked rows cannot be deemed legally erased or restored by an FK-only preflight',()=>{
  const db=fixture({audit:false});try{
    db.prepare('DELETE FROM starry_sessions WHERE s_user_id=?').run(ID);
    db.prepare('DELETE FROM starry_identities WHERE s_user_id=?').run(ID);
    db.prepare('DELETE FROM starry_admin_grants WHERE s_user_id=?').run(ID);
    const review=inspectLocalMemberErasureForeignKeys(db,ID);
    assert.ok(Object.values(review.referenced_rows).every(value=>value===0));
    assert.equal(review.blockers.includes('REFERENCING_MEMBER_ROWS'),false);
    assert.ok(review.blockers.includes('LEGAL_DISPOSITION_NOT_APPROVED'));
    assert.ok(review.blockers.includes('EXTERNAL_ERASURE_AND_PITR_UNVERIFIED'));
    assert.equal(review.may_delete_member,false);
  }finally{db.close();}
});

test('new unexpected inbound FK fails closed, even if no linked rows yet exist',()=>{
  const db=fixture();try{
    db.exec('CREATE TABLE another_member_reference(ref TEXT REFERENCES starry_members(s_user_id))');
    const review=inspectLocalMemberErasureForeignKeys(db,ID);
    assert.equal(review.unexpected_member_fk_tables.length,1);
    assert.equal(review.unexpected_member_fk_tables[0],
      'another_member_reference:ref:s_user_id');
    assert.ok(review.blockers.includes('UNRECOGNIZED_MEMBER_FOREIGN_KEY'));
    assert.equal(review.may_execute_transaction,false);
  }finally{db.close();}
});

test('FK disabled, incomplete source migration and invalid references each prevent credible erasure inspection',()=>{
  const disabled=fixture();try{
    disabled.exec('PRAGMA foreign_keys=OFF');
    const review=inspectLocalMemberErasureForeignKeys(disabled,ID);
    assert.ok(review.blockers.includes('FOREIGN_KEY_ENFORCEMENT_DISABLED'));
    assert.equal(review.may_delete_member,false);
  }finally{disabled.close();}
  const incomplete=fixture({m1:false,m2:false});try{
    const review=inspectLocalMemberErasureForeignKeys(incomplete,ID);
    assert.ok(review.blockers.includes('SOURCE_SCHEMA_INCOMPLETE'));
    assert.ok(review.blockers.includes('UNRECOGNIZED_MEMBER_FOREIGN_KEY'));
  }finally{incomplete.close();}
  const corrupt=fixture();try{
    corrupt.exec('PRAGMA foreign_keys=OFF');
    corrupt.prepare('INSERT INTO starry_identities VALUES(?,?,?)')
      .run('apple','orphan-identity','nonexistent-user');
    corrupt.exec('PRAGMA foreign_keys=ON');
    const review=inspectLocalMemberErasureForeignKeys(corrupt,ID);
    assert.equal(review.referential_integrity_ok,false);
    assert.ok(review.blockers.includes('REFERENTIAL_INTEGRITY_FAILURE'));
  }finally{corrupt.close();}
});

test('preflight rejects non-member references; no writable capability is ever returned',()=>{
  const db=fixture();try{
    for(const id of [null,'',{},'../danger','invalid email@domain','x'.repeat(129)])
      assert.throws(()=>inspectLocalMemberErasureForeignKeys(db,id),
        /AI3_LOCAL_ERASURE_INVALID_MEMBER_REF/);
    const review=inspectLocalMemberErasureForeignKeys(db,ID);
    assert.equal(Object.hasOwn(review,'delete'),false);
    assert.equal(Object.hasOwn(review,'commit'),false);
    assert.equal(Object.hasOwn(review,'audit_rows'),false);
  }finally{db.close();}
});
