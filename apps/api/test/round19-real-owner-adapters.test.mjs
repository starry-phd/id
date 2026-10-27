import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createOfflineCanonicalAuthDeletionPublisher} from
 '../../../modules/starry-id-v1/src/round16-canonical-deletion-publisher.ts';
import {createOfflineAuthCommittedSagaPreflight} from
 '../../../modules/starry-id-v1/src/round18-auth-committed-saga-preflight.ts';
import {createOfflineR18BatteryRecoveryReview} from
 '../../../packages/rebuild-ai3/src/r18-cross-d1-recovery-review.ts';
import {R16_CANDIDATE_SINGLE_PUBLISHER} from
 '../../../packages/rebuild-ai3/src/r16-battery-publisher-receipt.ts';
import {BILLING_R18_MEMORY_DDL,BILLING_R18_REFUND_READ_SQL} from
 '../../../packages/rebuild-billing/src/r18-refund-inbox.ts';
import {createR19OfflineFourDomainWire} from
 '../src/round19-offline-four-domain-wiring.ts';

const scope={brand_id:'starry',environment:'staging'};
const now=1793000000,event='starry-delete-'+'e'.repeat(64);
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sqlPort=db=>({prepare:sql=>({bind:(...params)=>({
 first:async()=>db.prepare(sql).get(...params)??null,
 all:async()=>db.prepare(sql).all(...params)
})})});
function ownerFixture(){
 // Five truly independent SQL connections; schemas are original owner SQL.
 const auth=new DatabaseSync(':memory:'),battery=new DatabaseSync(':memory:'),
  billing=new DatabaseSync(':memory:'),task=new DatabaseSync(':memory:'),
  witness=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const filename of [
  '001_starry_identity.DRAFT.sql',
  '007_starry_age_deletion_admin.UP.DRAFT.sql',
  '011_starry_one_use_deletion.UP.DRAFT.sql',
  '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
  '013_starry_deletion_source_immutability.UP.DRAFT.sql'
 ])auth.exec(read('../../../modules/starry-id-v1/schema/'+filename));
 auth.exec(read('../../../modules/starry-id-v1/test/fixtures/round16_auth_dispatch_lease.DRAFT.sql'));
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'member',1,1,?,?)")
  .run(now,now);
 const createSession=auth.prepare(
  'INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
 createSession.run('s1','u1','app-a','staging',3,'a'.repeat(64),now+120,'passkey',now-5,now+90);
 createSession.run('s2','u1','app-b','staging',3,'b'.repeat(64),now+120,null,null,null);
 auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
  .run('a'.repeat(64),'u1','s1',3,event,now,now+60);
 assert.equal(auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=?')
  .run(now,'a'.repeat(64)).changes,1);
 battery.exec(read('../../../packages/rebuild-ai3/schema/0005_free_battery_DRAFT.sql'));
 battery.exec(read('../../../packages/rebuild-ai3/schema/0010_auth_delete_battery_inbox_DRAFT.sql'));
 task.exec('CREATE TABLE ai3_r18_offline_task_projection(task_ref TEXT,member_ref TEXT,environment TEXT,status TEXT)');
 witness.exec('CREATE TABLE floor(event_id TEXT,member_ref TEXT,environment TEXT)');
 billing.exec('CREATE TABLE billing_entitlement_candidate_DRAFT(environment TEXT,member_ref TEXT,candidate_state TEXT)');
 billing.exec(BILLING_R18_MEMORY_DDL);
 const authPort=sqlPort(auth),batteryPort=sqlPort(battery),taskPort=sqlPort(task);
 const approved=async()=>true;
 const issuer=createOfflineCanonicalAuthDeletionPublisher({
  enabled:true,scope,db:authPort,
  lawfulDeletionProcessingApprovedNow:approved,readServerNow:()=>now
 });
 const guard=createOfflineAuthCommittedSagaPreflight({
  enabled:true,scope,db:authPort,lawfulDeletionProcessingApprovedNow:approved,
  lawfulMinimalRetentionApprovedNow:approved,readServerNow:()=>now
 });
 const recovery=createOfflineR18BatteryRecoveryReview({
  enabled:true,scope,publisher_id:R16_CANDIDATE_SINGLE_PUBLISHER,
  publisher:{readCommittedOriginal:async eventId=>{
   return auth.prepare('SELECT event_id,s_user_id,occurred_at,event_type FROM starry_deletion_outbox WHERE event_id=?').get(eventId)??null;
  }},
  authDb:authPort,batteryDb:batteryPort,taskDb:taskPort,
  independentFloor:{read:async()=>null},
  lawfulPurposeNow:approved,lawfulRetentionNow:approved,
  approvedPolicyVersionNow:async()=>1
 });
 return {auth,battery,billing,task,witness,issuer,guard,recovery,
  close:()=>{auth.close();battery.close();billing.close();task.close();witness.close()}};
}
test('R19 really invokes sealed AI-1 R18 Auth SQL/lease with separate AI-3 R18 Battery SQLite and denies incomplete sink',async()=>{
 const f=ownerFixture();try{
  const claim=await f.issuer.claim(event);
  assert.ok(claim,'genuine sealed AI-1 claim from committed Auth outbox');
  const source=await f.guard.inspect(claim);
  assert.equal(source?.disposition,'offline_auth_source_review_only');
  assert.equal(source?.auth_version,4);
  const battery=await f.recovery.assess(event,(now+1)*1000);
  assert.equal(battery.status,'review_only');
  assert.equal(battery.reason,'BATTERY_RECEIPT_MISSING_TRUNCATED_OR_STALE');
  assert.equal(battery.may_ack_queue,false);
  const rows=f.billing.prepare(BILLING_R18_REFUND_READ_SQL)
   .all('staging','apple','r_'+'a'.repeat(64));
  assert.deepEqual(rows,[],'real Billing R18 refund SQL has NO deletion proof');
  let sagaCalls=0,authCalls=0;
  const gate=createR19OfflineFourDomainWire(scope,'law-v1',{
   readPolicy:async()=>({revision:'law-v1',processing_approved:true,retention_approved:true}),
   inspectAuth:async()=>{authCalls++;return f.guard.inspect(claim)},
   readBilling:async()=>null,
   inspectBattery:async()=>f.recovery.assess(event,(now+1)*1000),
   readTask:async()=>null,
   inspectExistingSaga:async()=>{sagaCalls++;throw Error('MUST NOT REACH SAGA')}
  });
  const r=await gate.inspect(event,now+1);
  assert.equal(r.status,'blocked');
  assert.equal(r.reason,'OWNER_READBACK_MISSING_OR_DIVERGED');
  assert.equal(authCalls,1);assert.equal(sagaCalls,0);
  for(const field of ['may_ack_queue','may_dlq','may_release_task',
   'may_settle_task','may_regrant','may_restore','may_publish','publishable','live'])
   assert.equal(r[field],false);
  assert.equal(f.auth.prepare('SELECT COUNT(*) AS n FROM starry_deletion_outbox').get().n,1);
  assert.equal(f.billing.prepare('SELECT COUNT(*) AS n FROM billing_r18_refund_inbox_DRAFT').get().n,0);
 }finally{f.close()}
});
test('R19 direct real AI-1 source proof remains sealed; cross-brand/late Session mutation cannot become a transport event',async()=>{
 const f=ownerFixture();try{
  const claim=await f.issuer.claim(event);assert.ok(claim);
  assert.equal(await f.guard.inspect({...claim}),null);
  assert.ok(await f.guard.inspect(claim));
  // A late new session is not proof of deletion-time revocation; Auth must deny.
  f.auth.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?)')
   .run('late','u1','app-c','staging',4,'c'.repeat(64),now+100,now+1);
  assert.equal(await f.guard.inspect(claim),null);
 }finally{f.close()}
});
