import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineSignedTaskVerifier,canonicalTaskProofV1,
 SIGNED_TASK_PROOF_LIVE,SIGNED_TASK_VERSION} from '../src/round12-signed-task-proof.ts';
import {TASK_EVIDENCE_SCHEMA} from '../src/task-evidence.ts';
import {createOfflineCommittedTaskDelivery} from '../src/task-commit-ack.ts';
const keys=crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
 publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const proof=()=>({
 schema_version:TASK_EVIDENCE_SCHEMA,brand_id:'starry',member_ref:'member_01',
 task_ref:'task_01',app_id:'starry-ai',task_type:'generate',policy_version:4,
 rate_version:2,price:3,request_state:'succeeded',proof_state:'committed',
 proof_source:'server_task_engine',proof_revision:2,completed_at:980
});
const enc=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-')
 .replace(/\//g,'_').replace(/=+$/,'');
async function setup(){
 const kp=await keys;
 const spki=await crypto.subtle.exportKey('spki',kp.publicKey);
 const publicKey=await crypto.subtle.importKey('spki',spki,
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 let envelope=null,head=null,headReads=0,taskReads=0;
 const backend={
  readSignedTask:async()=>{taskReads++;return envelope;},
  readIndependentHead:async()=>{headReads++;return head;}
 };
 const signer=async(partial={})=>{
  const e={version:1,brand_id:'starry',environment:'staging',task:proof(),
   sequence:1,issued_ms:1000,key_id:'task-key-1',signature:'',...partial};
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,
   canonicalTaskProofV1(e));
  envelope={...e,signature:enc(sig)};
  const hash=await crypto.subtle.digest('SHA-256',sig);
  head={task_ref:e.task.task_ref,member_ref:e.task.member_ref,
   sequence:e.sequence,proof_revision:e.task.proof_revision,
   signature_sha256:Array.from(new Uint8Array(hash),
    x=>x.toString(16).padStart(2,'0')).join('')};
 };
 await signer();
 const verifier=()=>createOfflineSignedTaskVerifier({
  enabled:true,environment:'staging',key_id:'task-key-1',verifyKey:publicKey,backend});
 return {signer,verifier,backend,publicKey,
  envelope:v=>{envelope=v},current:()=>envelope,head:v=>{head=v},
  get taskReads(){return taskReads},get headReads(){return headReads}};
}
test('R12 real RSA-SHA256 valid committed task with anchored latest proof only',async()=>{
 const x=await setup();
 assert.equal(SIGNED_TASK_VERSION,1);
 assert.equal(SIGNED_TASK_PROOF_LIVE,false);
 assert.deepEqual(await x.verifier().verifyCommitted('task_01','member_01',1001),proof());
 assert.equal(x.headReads,1);
});
test('R12 unsigned or forged Task cannot pass and anchor is not consulted',async()=>{
 for(const bad of [null,{...proof()}, {...proof(),clientSuccess:true},
  {...proof(),request_state:'failed'}]){
  const x=await setup();x.envelope(bad);
  assert.equal(await x.verifier().verifyCommitted('task_01','member_01',1001),null);
  assert.equal(x.headReads,0);
 }
});
test('R12 signed exact cost/status/member/policy changed after issuance fails signature',async()=>{
 const changes=[
  {task:{...proof(),price:9}},{task:{...proof(),request_state:'failed'}},
  {task:{...proof(),member_ref:'attacker'}},{task:{...proof(),policy_version:9}},
  {task:{...proof(),proof_revision:9}}
 ];
 for(const change of changes){
  const x=await setup();x.envelope({...x.current(),...change});
  assert.equal(await x.verifier().verifyCommitted('task_01','member_01',1001),null);
 }
});
test('R12 latest external head rejects old VALID signature after revision/sequence advance',async()=>{
 const x=await setup();
 x.head({task_ref:'task_01',member_ref:'member_01',sequence:2,
  proof_revision:3,signature_sha256:'b'.repeat(64)});
 assert.equal(await x.verifier().verifyCommitted('task_01','member_01',1001),null);
});
test('R12 tampered/missing or stale independent head blocks current signed record',async()=>{
 for(const head of [null,{}, {task_ref:'task_01',member_ref:'member_01',
  sequence:1,proof_revision:2,signature_sha256:'0'.repeat(64)},
  {task_ref:'task_01',member_ref:'member_01',sequence:1,
   proof_revision:2,signature_sha256:'0'.repeat(64),clientVerified:true}]){
  const x=await setup();x.head(head);
  assert.equal(await x.verifier().verifyCommitted('task_01','member_01',1001),null);
 }
});
test('R12 wrong member, wrong task reference, wrong environment and expired envelope fail closed',async()=>{
 const x=await setup();
 for(const [ref,member,now] of [['task_02','member_01',1001],
  ['task_01','member_02',1001],['task_01','member_01',31001],
  ['task_01','member_01',999]]){
  assert.equal(await x.verifier().verifyCommitted(ref,member,now),null);
 }
 const wrong=await setup();await wrong.signer({environment:'development'});
 assert.equal(await wrong.verifier().verifyCommitted('task_01','member_01',1001),null);
});
test('R12 invalid getter, extra fields, revoked Proxy and noncanonical Base64URL reject',async()=>{
 const x=await setup();const signed=x.current();
 const rev=Proxy.revocable({...signed},{});rev.revoke();
 for(const invalid of [{...signed,clientApproved:true},rev.proxy,
  {...signed,signature:signed.signature+'='},
  {...signed,signature:'not-canonical'}]){
  x.envelope(invalid);
  assert.equal(await x.verifier().verifyCommitted('task_01','member_01',1001),null);
 }
 const y=await setup(),getter={...y.current()};
 Object.defineProperty(getter,'task',{enumerable:true,get(){throw Error('getter')}});
 y.envelope(getter);
 assert.equal(await y.verifier().verifyCommitted('task_01','member_01',1001),null);
});
test('R12 disabled verifier performs no backend calls; pinned key cannot be extractable',async()=>{
 const x=await setup();
 const disabled=createOfflineSignedTaskVerifier({
  enabled:false,environment:'staging',key_id:'task-key-1',
  verifyKey:x.publicKey,backend:x.backend});
 assert.equal(await disabled.verifyCommitted('task_01','member_01',1001),null);
 assert.equal(x.taskReads,0);
 const kp=await keys;
 assert.throws(()=>createOfflineSignedTaskVerifier({
  enabled:true,environment:'staging',key_id:'task-key-1',
  verifyKey:kp.publicKey,backend:x.backend}),/PINNED_KEY_REQUIRED/);
});
test('R12 source/head outage cannot produce trusted Task completion',async()=>{
 const x=await setup();
 x.backend.readIndependentHead=async()=>{throw Error('independent source offline')};
 assert.equal(await x.verifier().verifyCommitted('task_01','member_01',1001),null);
 const y=await setup();
 y.backend.readSignedTask=async()=>{throw Error('task D1 offline')};
 assert.equal(await y.verifier().verifyCommitted('task_01','member_01',1001),null);
});
test('R12 AI-4 R11 Task→Battery delivery retries if signature/head invalid',async()=>{
 const x=await setup();
 // Adapter reads backend-signed bytes instead of any client boolean.
 const signed=x.verifier();
 let settled=0,acked=0,retried=0;
 const worker=createOfflineCommittedTaskDelivery({brand_id:'starry',environment:'staging'},{
  readCommittedTask:async()=>signed.verifyCommitted('task_01','member_01',1001),
  readCurrentMember:async()=>({brand_id:'starry',member_ref:'member_01',
   status:'active',auth_version:1,revision:1}),
  readCommittedBattery:async()=>null,
  settleBattery:async()=>{settled++;return {outcome:'committed'}},
  persistDeadLetter:async()=>{throw Error('DLQ disabled')}
 });
 const message={body:{task_ref:'task_01'},attempts:1,
  ack:()=>{acked++},retry:()=>{retried++}};
 x.head(null);
 assert.equal(await worker.dispatch(message),'retried');
 assert.equal(settled,0);assert.equal(acked,0);assert.equal(retried,1);
});
