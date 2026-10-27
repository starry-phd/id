import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath,URL} from 'node:url';
import {createOfflineTaskTransactionalOutbox,TASK_DURABLE_OUTBOX_LIVE,
 TASK_OUTBOX_VERSION} from '../src/round14-task-transactional-outbox.ts';
import {TASK_EVIDENCE_SCHEMA} from '../src/task-evidence.ts';
const path=fileURLToPath(new URL('../contracts/task-commit-outbox.v0.DRAFT.sql',import.meta.url));
const task=()=>({
 schema_version:TASK_EVIDENCE_SCHEMA,brand_id:'starry',member_ref:'m01',
 task_ref:'task_01',app_id:'starry-ai',task_type:'generate',
 policy_version:2,rate_version:3,price:5,request_state:'succeeded',
 proof_state:'committed',proof_source:'server_task_engine',
 proof_revision:2,completed_at:1000
});
function dbFixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(path,'utf8'));
 const begin=()=>db.exec('BEGIN IMMEDIATE');
 const commit=()=>db.exec('COMMIT');
 const rollback=()=>{try{db.exec('ROLLBACK')}catch{/* transaction never opened */}};
 const seed=(ref='task_01')=>{
  db.prepare('INSERT INTO ai4_task_record VALUES (?,?,?,?,?,?,?,?,?,?,?)')
   .run('starry',ref,'m01','starry-ai','generate',2,3,5,'accepted',1,null);
 };
 seed();
 let writes=0,reads=0,fail=null;
 const port={
  async commitTaskAndOutbox(t,eventRef){
   writes++;
   // This is a real SQLite same-connection transaction, NOT a second D1.
   try{
    begin();
    const changed=db.prepare("UPDATE ai4_task_record SET request_state=?,proof_revision=?,completed_at=? WHERE brand_id='starry' AND task_ref=? AND member_ref=? AND app_id=? AND task_type=? AND policy_version=? AND rate_version=? AND price=? AND request_state='accepted' AND proof_revision=1 AND completed_at IS NULL")
     .run(t.request_state,t.proof_revision,t.completed_at,t.task_ref,t.member_ref,
      t.app_id,t.task_type,t.policy_version,t.rate_version,t.price).changes;
    if(changed===0){
     const stored=db.prepare("SELECT request_state,proof_revision,completed_at,price,policy_version,rate_version,member_ref,app_id,task_type FROM ai4_task_record WHERE task_ref=?").get(t.task_ref);
     const row=db.prepare('SELECT * FROM ai4_task_outbox WHERE task_ref=?').get(t.task_ref);
     if(stored&&row&&stored.request_state===t.request_state&&
      stored.proof_revision===t.proof_revision&&stored.completed_at===t.completed_at&&
      stored.price===t.price&&stored.policy_version===t.policy_version&&
      stored.rate_version===t.rate_version&&stored.member_ref===t.member_ref&&
      stored.app_id===t.app_id&&stored.task_type===t.task_type&&
      row.event_ref===eventRef&&row.member_ref===t.member_ref&&
      row.proof_revision===t.proof_revision&&row.request_state===t.request_state&&
      row.price===t.price&&row.policy_version===t.policy_version&&
      row.rate_version===t.rate_version){
      commit();return {outcome:'duplicate',task_ref:t.task_ref,
       proof_revision:t.proof_revision};
     }
     throw Error('CONFLICT');
    }
    if(fail==='after_task_update')throw Error('SIMULATED_CRASH_AFTER_TASK_UPDATE');
    db.prepare('INSERT INTO ai4_task_outbox VALUES (?,?,?,?,?,?,?,?)')
     .run(eventRef,t.task_ref,t.member_ref,t.proof_revision,t.request_state,
      t.price,t.policy_version,t.rate_version);
    if(fail==='after_outbox_insert')throw Error('SIMULATED_CRASH_AFTER_OUTBOX_INSERT');
    commit();
    return {outcome:'committed',task_ref:t.task_ref,
     proof_revision:t.proof_revision};
   }catch(e){rollback();throw e;}
  },
  async readCommittedPair(ref){
   reads++;
   const a=db.prepare('SELECT * FROM ai4_task_record WHERE task_ref=?').get(ref);
   const o=db.prepare('SELECT * FROM ai4_task_outbox WHERE task_ref=?').get(ref);
   if(!a||!o)return null;
   return {task:{
    schema_version:TASK_EVIDENCE_SCHEMA,brand_id:a.brand_id,
    member_ref:a.member_ref,task_ref:a.task_ref,app_id:a.app_id,
    task_type:a.task_type,policy_version:a.policy_version,
    rate_version:a.rate_version,price:a.price,
    request_state:a.request_state,proof_state:'committed',
    proof_source:'server_task_engine',proof_revision:a.proof_revision,
    completed_at:a.completed_at},
    outbox:{task_ref:o.task_ref,member_ref:o.member_ref,
     proof_revision:o.proof_revision,request_state:o.request_state,
     price:o.price,policy_version:o.policy_version,
     rate_version:o.rate_version,event_ref:o.event_ref}};
  }
 };
 const gate=createOfflineTaskTransactionalOutbox({
  brand_id:'starry',environment:'staging'},port);
 return {db,seed,gate,port,fail:v=>{fail=v},close:()=>db.close(),
  get writes(){return writes},get reads(){return reads}};
}
test('R14 true SQLite Task CAS + unique Outbox commit, two post-commit reads, never ACK',async()=>{
 const f=dbFixture();
 try{
  assert.equal(TASK_DURABLE_OUTBOX_LIVE,false);
  assert.equal(TASK_OUTBOX_VERSION,'starry.task-outbox.v0-draft');
  assert.deepEqual(await f.gate.commit(task(),'evt_01'),
   {outcome:'recorded_offline',ack_safe:false,wallet_grant_allowed:false,live:false});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM ai4_task_outbox').get().n,1);
  assert.equal(f.db.prepare('SELECT request_state FROM ai4_task_record').get().request_state,'succeeded');
  assert.equal(f.reads,2);
 }finally{f.close();}
});
test('R14 replay same exact task+event is idempotent; changed event or price denied',async()=>{
 const f=dbFixture();
 try{
  assert.equal((await f.gate.commit(task(),'evt_01')).outcome,'recorded_offline');
  assert.equal((await f.gate.commit(task(),'evt_01')).outcome,'unchanged_offline');
  for(const [t,event] of [[task(),'evt_02'],[{...task(),price:9},'evt_01'],
   [{...task(),request_state:'failed'},'evt_01']]){
   assert.equal((await f.gate.commit(t,event)).outcome,'blocked');
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM ai4_task_outbox').get().n,1);
 }finally{f.close();}
});
test('R14 crash after Task UPDATE rolls back both Task and Outbox, retry commits once',async()=>{
 const f=dbFixture();
 try{
  f.fail('after_task_update');
  assert.equal((await f.gate.commit(task(),'evt_01')).outcome,'blocked');
  assert.equal(f.db.prepare('SELECT request_state FROM ai4_task_record').get().request_state,'accepted');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM ai4_task_outbox').get().n,0);
  f.fail(null);
  assert.equal((await f.gate.commit(task(),'evt_01')).outcome,'recorded_offline');
 }finally{f.close();}
});
test('R14 crash after Outbox INSERT before COMMIT leaves zero events and original Task',async()=>{
 const f=dbFixture();
 try{
  f.fail('after_outbox_insert');
  assert.equal((await f.gate.commit(task(),'evt_01')).outcome,'blocked');
  assert.equal(f.db.prepare('SELECT request_state FROM ai4_task_record').get().request_state,'accepted');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM ai4_task_outbox').get().n,0);
 }finally{f.close();}
});
test('R14 outbox duplicate eventRef on another task aborts second atomic Task update',async()=>{
 const f=dbFixture();
 try{
  assert.equal((await f.gate.commit(task(),'evt_01')).outcome,'recorded_offline');
  f.seed('task_02');
  assert.equal((await f.gate.commit({...task(),task_ref:'task_02'},'evt_01')).outcome,'blocked');
  assert.equal(f.db.prepare("SELECT request_state FROM ai4_task_record WHERE task_ref='task_02'").get().request_state,'accepted');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM ai4_task_outbox').get().n,1);
 }finally{f.close();}
});
test('R14 schema final rows/outbox cannot be changed or removed after durable commit',async()=>{
 const f=dbFixture();
 try{
  await f.gate.commit(task(),'evt_01');
  assert.throws(()=>f.db.exec("UPDATE ai4_task_record SET price=999 WHERE task_ref='task_01'"),/FINAL_TASK_IMMUTABLE/);
  assert.throws(()=>f.db.exec("DELETE FROM ai4_task_record WHERE task_ref='task_01'"),/FINAL_TASK_IMMUTABLE/);
  assert.throws(()=>f.db.exec("UPDATE ai4_task_outbox SET price=999 WHERE task_ref='task_01'"),/TASK_OUTBOX_IMMUTABLE/);
  assert.throws(()=>f.db.exec("DELETE FROM ai4_task_outbox WHERE task_ref='task_01'"),/TASK_OUTBOX_IMMUTABLE/);
 }finally{f.close();}
});
test('R14 schema rejects mismatched outbox before finalizing source task',()=>{
 const f=dbFixture();
 try{
  assert.throws(()=>f.db.prepare('INSERT INTO ai4_task_outbox VALUES (?,?,?,?,?,?,?,?)')
   .run('evt_01','task_01','m01',2,'succeeded',5,2,3),/TASK_OUTBOX_SOURCE_MISMATCH/);
 }finally{f.close();}
});
test('R14 malformed committed source, brand, extras, proxy never invoke Task database',async()=>{
 const f=dbFixture();
 try{
  const rev=Proxy.revocable(task(),{});rev.revoke();
  for(const t of [null,{...task(),brand_id:'hglobal'},
   {...task(),proof_revision:1},{...task(),request_state:'accepted'},
   {...task(),extra:true},rev.proxy]){
   assert.equal((await f.gate.commit(t,'evt_01')).outcome,'blocked');
  }
  assert.equal(f.writes,0);
 }finally{f.close();}
});
test('R14 candidate success without durable pair or with forged receipt never authorizes ACK',async()=>{
 const fake={
  commitTaskAndOutbox:async()=>({outcome:'committed',task_ref:'task_01',proof_revision:2}),
  readCommittedPair:async()=>null
 };
 const g=createOfflineTaskTransactionalOutbox({brand_id:'starry',environment:'staging'},fake);
 assert.equal((await g.commit(task(),'evt_01')).outcome,'blocked');
});
test('R14 racing post-commit Task/outbox readback makes response blocked',async()=>{
 const f=dbFixture();
 try{
  let n=0;
  f.port.readCommittedPair=async()=>{n++;return n===1?{
   task:task(),outbox:{task_ref:'task_01',member_ref:'m01',
    proof_revision:2,request_state:'succeeded',price:5,
    policy_version:2,rate_version:3,event_ref:'evt_01'}
   }:{task:{...task(),price:6},outbox:{task_ref:'task_01',member_ref:'m01',
    proof_revision:2,request_state:'succeeded',price:6,
    policy_version:2,rate_version:3,event_ref:'evt_01'}}};
  assert.equal((await f.gate.commit(task(),'evt_01')).outcome,'blocked');
 }finally{f.close();}
});
test('R14 status failed is durable, but cannot masquerade as successful Battery grant',async()=>{
 const f=dbFixture();
 try{
  assert.equal((await f.gate.commit({...task(),request_state:'failed'},'evt_fail')).outcome,'recorded_offline');
  assert.equal(f.db.prepare('SELECT request_state FROM ai4_task_outbox').get().request_state,'failed');
 }finally{f.close();}
});
