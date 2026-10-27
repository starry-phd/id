import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineCommittedTaskDelivery,TASK_COMMIT_ACK_LIVE,
 TASK_DELIVERY_PROTOCOL} from '../src/task-commit-ack.ts';
import {TASK_EVIDENCE_SCHEMA} from '../src/task-evidence.ts';
const scope={brand_id:'starry',environment:'staging'};
const task=()=>({
 schema_version:TASK_EVIDENCE_SCHEMA,brand_id:'starry',member_ref:'m01',
 task_ref:'task_01',app_id:'starry-ai',task_type:'summarize',policy_version:2,
 rate_version:4,price:3,request_state:'succeeded',proof_state:'committed',
 proof_source:'server_task_engine',proof_revision:3,completed_at:1000
});
const member=()=>({brand_id:'starry',member_ref:'m01',status:'active',
 auth_version:4,revision:8});
const battery=()=>({brand_id:'starry',member_ref:'m01',task_ref:'task_01',
 task_proof_revision:3,policy_version:2,rate_version:4,price:3,
 result:'committed',wallet_revision:12,durable:true});
function fixture(){
 let source=task(),auth=member(),wallet=null,writeCount=0;
 let taskReads=0,memberReads=0,dlq=null,failStore=false,failDLQ=false;
 const ports={
  readCommittedTask:async()=>{taskReads++;return source;},
  readCurrentMember:async()=>{memberReads++;return auth;},
  settleBattery:async(t)=>{
   if(failStore)throw Error('D1 write unavailable');
   writeCount++;
   wallet=battery();
   return {outcome:'committed'};
  },
  readCommittedBattery:async()=>wallet,
  persistDeadLetter:async(ref,reason,attempt)=>{
   if(failDLQ)throw Error('DLQ down');
   dlq={ref,reason,attempt};
   return {task_ref:ref,outcome:'durably_written'};
  }
 };
 function msg(attempts=1,body={task_ref:'task_01'}){
  let ack=0,retry=0;
  return {body,attempts,ack:()=>{ack++;},retry:()=>{retry++;},
   get ackCount(){return ack;},get retryCount(){return retry;}};
 }
 return {handler:createOfflineCommittedTaskDelivery(scope,ports),ports,msg,
  source:x=>{source=x},auth:x=>{auth=x},wallet:x=>{wallet=x},
  failStore:()=>{failStore=true},failDLQ:()=>{failDLQ=true},
  get writeCount(){return writeCount},get taskReads(){return taskReads},
  get memberReads(){return memberReads},get dlq(){return dlq}};
}
test('R11 source-after-commit plus wallet and active member double check is sole ACK path',async()=>{
 const f=fixture();const q=f.msg();
 assert.equal(TASK_COMMIT_ACK_LIVE,false);
 assert.equal(TASK_DELIVERY_PROTOCOL,'starry.task-delivery.v0-draft');
 assert.equal(await f.handler.dispatch(q),'acked');
 assert.equal(q.ackCount,1);assert.equal(q.retryCount,0);
 assert.equal(f.writeCount,1);assert.equal(f.taskReads,2);
 assert.equal(f.memberReads,2);
 const replay=f.msg();
 assert.equal(await f.handler.dispatch(replay),'acked');
 assert.equal(f.writeCount,1); // durable committed receipt, NO second wallet write
});
test('R11 cannot ACK task accepted/uncommitted/forged provider/client success',async()=>{
 for(const bad of [null,{...task(),request_state:'accepted',completed_at:null},
  {...task(),proof_state:'pending'},{...task(),proof_source:'client'},
  {...task(),clientApproved:true},{...task(),brand_id:'hglobal'}]){
  const f=fixture();f.source(bad);const q=f.msg();
  assert.equal(await f.handler.dispatch(q),'retried');
  assert.equal(q.retryCount,1);assert.equal(q.ackCount,0);
  assert.equal(f.writeCount,0);
 }
});
test('R11 source changes between settlement and ACK -> must retry',async()=>{
 const f=fixture();let reads=0;
 f.ports.readCommittedTask=async()=>{
  reads++;return reads===1?task():{...task(),proof_revision:4};
 };
 const q=f.msg();assert.equal(await f.handler.dispatch(q),'retried');
 assert.equal(q.ackCount,0);
});
test('R11 session deletion or auth_version change between reads blocks ACK',async()=>{
 for(const second of [{...member(),status:'deleted'}, {...member(),auth_version:5}]){
  const f=fixture();let calls=0;
  f.ports.readCurrentMember=async()=>{calls++;return calls===1?member():second;};
  const q=f.msg();assert.equal(await f.handler.dispatch(q),'retried');
  assert.equal(q.ackCount,0);
 }
});
test('R11 missing actual AI3 persisted journal or mismatched cost/revision blocks ACK',async()=>{
 for(const w of [null,{...battery(),price:4},{...battery(),task_proof_revision:9},
  {...battery(),durable:false},{...battery(),result:'released'},
  {...battery(),clientApproved:true}]){
  const f=fixture();f.wallet(w);f.failStore();const q=f.msg();
  assert.equal(await f.handler.dispatch(q),'retried');
  assert.equal(q.ackCount,0);
 }
});
test('R11 expired session, wrong identity and fake message fields cannot reach settled wallet',async()=>{
 for(const body of [null,{},[],{task_ref:'task_01',success:true},
  {task_ref:'hglobal_payment'},{task_ref:'task_01',price:999}]){
  const f=fixture();const q=f.msg(1,body);
  if(body&&typeof body==='object'&&Object.keys(body).length===1&&body.task_ref==='hglobal_payment'){
   assert.equal(await f.handler.dispatch(q),'retried');
  }else assert.equal(await f.handler.dispatch(q),'retried');
  assert.equal(q.ackCount,0);
 }
 const f=fixture();f.auth({...member(),status:'suspended'});
 assert.equal(await f.handler.dispatch(f.msg()),'retried');
 assert.equal(f.writeCount,0);
});
test('R11 bounded retry max attempts only ACK after durable DLQ exact task receipt',async()=>{
 const f=fixture();f.source(null);
 const q=f.msg(5);
 assert.equal(await f.handler.dispatch(q),'dead_letter_acked');
 assert.equal(q.ackCount,1);assert.deepEqual(f.dlq,{
  ref:'task_01',reason:'AUTHORITY_RETRY_EXHAUSTED',attempt:5
 });
 const z=fixture();z.source(null);z.failDLQ();
 const fail=z.msg(7);
 assert.equal(await z.handler.dispatch(fail),'retried');
 assert.equal(fail.ackCount,0);assert.equal(fail.retryCount,1);
});
test('R11 DLQ fake receipt, source throwing and revoked Proxy all fail-closed',async()=>{
 const f=fixture();f.source(null);
 f.ports.persistDeadLetter=async()=>({task_ref:'wrong',outcome:'durably_written'});
 const msg=f.msg(7);assert.equal(await f.handler.dispatch(msg),'retried');
 assert.equal(msg.ackCount,0);
 const x=fixture();x.ports.readCommittedTask=async()=>{throw Error('offline');};
 assert.equal(await x.handler.dispatch(x.msg()),'retried');
 const z=fixture();const r=Proxy.revocable(task(),{});r.revoke();z.source(r.proxy);
 assert.equal(await z.handler.dispatch(z.msg()),'retried');
});
test('R11 failed task requires persisted release and no wallet credit',async()=>{
 const f=fixture(),failed={...task(),request_state:'failed'};
 f.source(failed);f.ports.settleBattery=async()=>{
  f.wallet({...battery(),result:'released'});return {outcome:'committed'};
 };
 const q=f.msg();assert.equal(await f.handler.dispatch(q),'acked');
 assert.equal(q.ackCount,1);
 const v=fixture();v.source(failed);
 assert.equal(await v.handler.dispatch(v.msg()),'retried');
});
test('R11 queue retry failure propagates to prevent silent auto-ACK',async()=>{
 const f=fixture();f.source(null);
 const msg={body:{task_ref:'task_01'},attempts:1,ack:()=>{},
  retry:()=>{throw Error('explicit retry failed')}};
 await assert.rejects(f.handler.dispatch(msg),/explicit retry failed/);
});
