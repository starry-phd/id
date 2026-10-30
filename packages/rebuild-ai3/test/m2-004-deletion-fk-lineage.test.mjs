import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
 inspectLocalMemberErasureForeignKeys,
 inspectLocalM2DeletionRequestChain,
} from '../src/m2-local-erasure-fk-preflight.ts';

const member='synthetic-member-1';
const member2='synthetic-member-2';
const opaque='m2del-'+'a'.repeat(48);
const opaque2='m2del-'+'b'.repeat(48);
const t=1793400000;
function fixture({apply004=true}={}){
 const db=new DatabaseSync(':memory:');
 for(const path of [
  '../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',
  '../../../modules/starry-id-v1/schema/002_m1_local_oauth_attempts.DRAFT.sql',
  '../../../modules/starry-id-v1/schema/003_m2_local_member_self_mutations.DRAFT.sql',
  ...(apply004?['../../../modules/starry-id-v1/schema/004_m2_local_deletion_request_receipt.DRAFT.sql']:[]),
 ])db.exec(readFileSync(new URL(path,import.meta.url),'utf8'));
 for(const id of [member,member2])
  db.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
   .run(id,'active',2,1,'Private name '+id,0,0,t,t);
 return db;
}
function insert(db,id,requestId,second=false){
 db.prepare('INSERT INTO starry_m2_deletion_requests VALUES(?,?,?,?,?,?,?)')
  .run(requestId,id,'starry-id','staging','awaiting_second_confirmation',t,null);
 if(second)db.prepare(
  "UPDATE starry_m2_deletion_requests SET status='pending_processing', second_confirmed_at=? WHERE request_id=?")
  .run(t+1,requestId);
}
function n(db,table){
 return db.prepare('SELECT COUNT(*) AS n FROM "'+table+'"').get().n;
}

test('real 001–004: 004 direct FK stays UNKNOWN to old preflight while new audit-chain inspector counts the TWO levels',()=>{
 const db=fixture();try{
  insert(db,member,opaque,true);
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  const old=inspectLocalMemberErasureForeignKeys(db,member);
  assert.ok(old.blockers.includes('UNRECOGNIZED_MEMBER_FOREIGN_KEY'));
  assert.ok(old.unexpected_member_fk_tables.includes(
    'starry_m2_deletion_requests:s_user_id:s_user_id'));
  assert.equal(old.may_delete_member,false);
  // Old five direct counts are NOT falsely presented as complete.
  assert.deepEqual(Object.values(old.referenced_rows),[0,0,0,0,0]);
  const result=inspectLocalM2DeletionRequestChain(db,member);
  assert.equal(result.schema_chain_verified,true);
  assert.equal(result.counts_verified,true);
  assert.deepEqual([
   result.request_count,result.awaiting_second_confirmation_count,
   result.pending_processing_count,result.first_confirmation_audit_count,
   result.second_confirmation_audit_count,
  ],[1,0,1,1,1]);
  assert.ok(result.blockers.includes('DELETION_REQUEST_ROWS_REMAIN'));
  assert.equal(result.may_delete_member,false);
  assert.equal(result.may_delete_request_or_audit,false);
  assert.equal(result.may_retain_identifiers,false);
  assert.equal(result.may_restore,false);
  assert.equal(result.may_grant_battery,false);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.blockers),true);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
  const output=JSON.stringify(result);
  for(const secret of [member,member2,opaque,'Private name'])
   assert.equal(output.includes(secret),false);
 }finally{db.close();}
});

test('first-only receipt has 1 first-audit and 0 second-audit, NEVER auto-confirm or authorize',()=>{
 const db=fixture();try{
  insert(db,member,opaque);
  const result=inspectLocalM2DeletionRequestChain(db,member);
  assert.deepEqual([
   result.request_count,result.awaiting_second_confirmation_count,
   result.pending_processing_count,result.first_confirmation_audit_count,
   result.second_confirmation_audit_count,
  ],[1,1,0,1,0]);
  assert.ok(!result.blockers.includes('INCOMPLETE_DELETION_REQUEST_AUDIT'));
  assert.equal(result.may_delete_member,false);
  assert.equal(db.prepare('SELECT status FROM starry_m2_deletion_requests').get().status,
   'awaiting_second_confirmation');
 }finally{db.close();}
});

test('scoped two-member chain counts never return other member receipt or ID',()=>{
 const db=fixture();try{
  insert(db,member,opaque);
  insert(db,member2,opaque2,true);
  const one=inspectLocalM2DeletionRequestChain(db,member);
  const two=inspectLocalM2DeletionRequestChain(db,member2);
  assert.deepEqual([one.request_count,one.first_confirmation_audit_count,
   one.second_confirmation_audit_count],[1,1,0]);
  assert.deepEqual([two.request_count,two.first_confirmation_audit_count,
   two.second_confirmation_audit_count],[1,1,1]);
  assert.equal(JSON.stringify(one).includes(opaque2),false);
  assert.equal(JSON.stringify(two).includes(opaque),false);
  const absent=inspectLocalM2DeletionRequestChain(db,'absent-member');
  assert.ok(absent.blockers.includes('ACCOUNT_NOT_PRESENT'));
  assert.equal(absent.counts_verified,false);
  assert.equal(absent.may_delete_member,false);
 }finally{db.close();}
});

test('true 004 SQLite double FK prevents deleting request AND member after Auth/old audit cleanup; rollback leaves all data',()=>{
 const db=fixture();try{
  insert(db,member,opaque,true);
  const before=n(db,'starry_m2_deletion_request_audit');
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('DELETE FROM starry_sessions WHERE s_user_id=?').run(member);
   db.prepare('DELETE FROM starry_identities WHERE s_user_id=?').run(member);
   db.prepare('DELETE FROM starry_admin_grants WHERE s_user_id=?').run(member);
   db.prepare('DELETE FROM starry_m1_audit_intents WHERE s_user_id=?').run(member);
   db.prepare('DELETE FROM starry_m2_member_mutation_audit WHERE s_user_id=?').run(member);
   assert.throws(()=>db.prepare(
    'DELETE FROM starry_m2_deletion_requests WHERE s_user_id=?').run(member),
    /FOREIGN KEY constraint failed/);
   assert.throws(()=>db.prepare('DELETE FROM starry_members WHERE s_user_id=?')
    .run(member),/FOREIGN KEY constraint failed/);
  }finally{db.exec('ROLLBACK');}
  assert.equal(n(db,'starry_m2_deletion_requests'),1);
  assert.equal(n(db,'starry_m2_deletion_request_audit'),before);
  assert.equal(db.prepare('SELECT status FROM starry_members WHERE s_user_id=?')
   .get(member).status,'active');
  assert.equal(db.prepare('SELECT status FROM starry_m2_deletion_requests')
   .get().status,'pending_processing');
 }finally{db.close();}
});


test('real 001–004 first event scope tampering: clean FK + unchanged counts must NOT mean verified provenance',()=>{
 const db=fixture();try{
  insert(db,member,opaque);
  db.exec('BEGIN IMMEDIATE');
  try{
   // 004 permits both dev/staging independently; its FK binds only request_id.
   // This is a real valid UPDATE, NOT a rewritten schema or synthetic FK.
   assert.equal(db.prepare(
    "UPDATE starry_m2_deletion_request_audit SET environment='development' "+
    "WHERE request_id=? AND event_type='first_confirmation_received'")
    .run(opaque).changes,1);
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  const changes=db.prepare('SELECT total_changes() AS n').get().n;
  const review=inspectLocalM2DeletionRequestChain(db,member);
  assert.equal(review.schema_chain_verified,true); // FK graph only
  assert.equal(review.referential_integrity_ok,true);
  assert.deepEqual([review.request_count,review.first_confirmation_audit_count,
   review.second_confirmation_audit_count],[1,1,0]); // counts look normal!
  assert.equal(review.audit_scope_verified,false);
  assert.equal(review.audit_scope_mismatch_count,1);
  assert.equal(review.counts_verified,false);
  assert.ok(review.blockers.includes('DELETION_AUDIT_SCOPE_MISMATCH'));
  assert.ok(!review.blockers.includes('INCOMPLETE_DELETION_REQUEST_AUDIT'));
  assert.equal(review.may_delete_request_or_audit,false);
  assert.equal(review.may_delete_member,false);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,changes);
  for(const secret of [member,opaque])
   assert.equal(JSON.stringify(review).includes(secret),false);
 }finally{db.close();}
});

test('real 001–004 second event mismatch is scoped to its request/member; another member remains verified',()=>{
 const db=fixture();try{
  insert(db,member,opaque,true);
  insert(db,member2,opaque2,true);
  // Valid 004 CHECK, still no broken FK; both original SQLite triggers fired.
  db.prepare(
   "UPDATE starry_m2_deletion_request_audit SET environment='development' "+
   "WHERE request_id=? AND event_type='second_confirmation_received'")
   .run(opaque);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  const corrupted=inspectLocalM2DeletionRequestChain(db,member);
  const other=inspectLocalM2DeletionRequestChain(db,member2);
  assert.equal(corrupted.request_count,1);
  assert.equal(corrupted.first_confirmation_audit_count,1);
  assert.equal(corrupted.second_confirmation_audit_count,1);
  assert.equal(corrupted.audit_scope_mismatch_count,1);
  assert.equal(corrupted.audit_scope_verified,false);
  assert.equal(corrupted.counts_verified,false);
  assert.ok(corrupted.blockers.includes('DELETION_AUDIT_SCOPE_MISMATCH'));
  assert.equal(other.audit_scope_mismatch_count,0);
  assert.equal(other.audit_scope_verified,true);
  assert.equal(other.counts_verified,true);
  assert.ok(!other.blockers.includes('DELETION_AUDIT_SCOPE_MISMATCH'));
  assert.equal(JSON.stringify(other).includes(opaque),false);
  for(const item of [corrupted,other]){
   assert.equal(item.may_delete_member,false);
   assert.equal(item.may_restore,false);
   assert.equal(item.may_grant_battery,false);
  }
 }finally{db.close();}
});

test('app_id disagreement is rejected even when a test explicitly disables SQL CHECK (not a valid production row)',()=>{
 const db=fixture();try{
  insert(db,member,opaque);
  db.exec('PRAGMA ignore_check_constraints=ON');
  try{
   db.prepare(
    "UPDATE starry_m2_deletion_request_audit SET app_id='another-app' "+
    "WHERE request_id=? AND event_type='first_confirmation_received'").run(opaque);
  }finally{db.exec('PRAGMA ignore_check_constraints=OFF');}
  // This last case deliberately manufactures invalid CHECK data while leaving
  // the FK intact. It exercises the app_id half of the read-only comparison;
  // the first two tests show the bug under unmodified *valid* 004 constraints.
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  const review=inspectLocalM2DeletionRequestChain(db,member);
  assert.equal(review.audit_scope_mismatch_count,1);
  assert.equal(review.audit_scope_verified,false);
  assert.equal(review.counts_verified,false);
  assert.ok(review.blockers.includes('DELETION_AUDIT_SCOPE_MISMATCH'));
  assert.equal(review.may_delete_member,false);
 }finally{db.close();}
});

test('missing audit event despite valid FK is detected without erasing or assuming legal retention',()=>{
 const db=fixture();try{
  insert(db,member,opaque,true);
  db.prepare(
   "DELETE FROM starry_m2_deletion_request_audit WHERE event_type='second_confirmation_received'")
   .run();
  const result=inspectLocalM2DeletionRequestChain(db,member);
  assert.equal(result.referential_integrity_ok,true);
  assert.equal(result.pending_processing_count,1);
  assert.equal(result.second_confirmation_audit_count,0);
  assert.ok(result.blockers.includes('INCOMPLETE_DELETION_REQUEST_AUDIT'));
  assert.equal(result.may_delete_request_or_audit,false);
 }finally{db.close();}
});

test('extra inbound FK to request table blocks lineage even with no referencing rows',()=>{
 const db=fixture();try{
  db.exec('CREATE TABLE future_request_link (request_id TEXT REFERENCES starry_m2_deletion_requests(request_id))');
  insert(db,member,opaque);
  const result=inspectLocalM2DeletionRequestChain(db,member);
  assert.equal(result.schema_chain_verified,false);
  assert.equal(result.counts_verified,false);
  assert.ok(result.unexpected_chain_edges.includes(
   'future_request_link:request_id:starry_m2_deletion_requests:request_id:NO ACTION'));
  assert.ok(result.blockers.includes('UNVERIFIED_DELETION_FK_CHAIN'));
  assert.equal(result.may_delete_member,false);
 }finally{db.close();}
});

test('unknown child referencing request audit table is also a new transitive edge, never ignored',()=>{
 const db=fixture();try{
  db.exec('CREATE TABLE future_audit_link (event_id TEXT REFERENCES starry_m2_deletion_request_audit(event_id))');
  const review=inspectLocalM2DeletionRequestChain(db,member);
  assert.equal(review.counts_verified,false);
  assert.ok(review.unexpected_chain_edges.some(e=>e.startsWith(
   'future_audit_link:event_id:starry_m2_deletion_request_audit:')));
 }finally{db.close();}
});

test('without 004, FK disabled, or dangling child records: fail closed and no invented counts',()=>{
 const missing=fixture({apply004:false});try{
  const r=inspectLocalM2DeletionRequestChain(missing,member);
  assert.ok(r.blockers.includes('SOURCE_SCHEMA_INCOMPLETE'));
  assert.ok(r.blockers.includes('UNVERIFIED_DELETION_FK_CHAIN'));
  assert.equal(r.counts_verified,false);
 }finally{missing.close();}
 const disabled=fixture();try{
  insert(disabled,member,opaque);
  disabled.exec('PRAGMA foreign_keys=OFF');
  const r=inspectLocalM2DeletionRequestChain(disabled,member);
  assert.ok(r.blockers.includes('FOREIGN_KEY_ENFORCEMENT_DISABLED'));
  assert.equal(r.counts_verified,false);
  assert.equal(r.may_delete_member,false);
 }finally{disabled.close();}
 const corrupt=fixture();try{
  insert(corrupt,member,opaque);
  corrupt.exec('PRAGMA foreign_keys=OFF');
  dbOrphan(corrupt);
  corrupt.exec('PRAGMA foreign_keys=ON');
  const r=inspectLocalM2DeletionRequestChain(corrupt,member);
  assert.ok(r.blockers.includes('REFERENTIAL_INTEGRITY_FAILURE'));
  assert.equal(r.counts_verified,false);
 }finally{corrupt.close();}
});
function dbOrphan(db){
 db.prepare('INSERT INTO starry_m2_deletion_request_audit VALUES(?,?,?,?,?,?)')
  .run('orphan:first','m2del-'+'f'.repeat(48),'first_confirmation_received',
   'starry-id','staging',t);
}

test('invalid member lookup is rejected, never placed in SQL or written to GitHub output',()=>{
 const db=fixture();try{
  for(const id of [null,{},'../escape','email@example.invalid',''.padEnd(129,'x')])
   assert.throws(()=>inspectLocalM2DeletionRequestChain(db,id),
    /AI3_LOCAL_ERASURE_INVALID_MEMBER_REF/);
  const r=inspectLocalM2DeletionRequestChain(db,member);
  assert.equal(r.may_delete_member,false);
  assert.ok(r.blockers.includes('LEGAL_DISPOSITION_NOT_APPROVED'));
  assert.ok(r.blockers.includes('EXTERNAL_ERASURE_AND_PITR_UNVERIFIED'));
 }finally{db.close();}
});
