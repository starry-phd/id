import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto as crypto} from 'node:crypto';
import {btoa} from 'node:buffer';
import {createOfflineDualSignedTaskAuthority,canonicalSignedTaskHeadV1,
 DUAL_SIGNED_TASK_HEAD_LIVE} from '../src/round13-dual-signed-task-head.ts';
import {canonicalTaskProofV1} from '../src/round12-signed-task-proof.ts';
import {TASK_EVIDENCE_SCHEMA} from '../src/task-evidence.ts';
import {createOfflineCommittedTaskDelivery} from '../src/task-commit-ack.ts';
const enc=b=>btoa(String.fromCharCode(...new Uint8Array(b)))
 .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const task=()=>({
 schema_version:TASK_EVIDENCE_SCHEMA,brand_id:'starry',member_ref:'member_01',
 task_ref:'task_01',app_id:'starry-ai',task_type:'generate',policy_version:3,
 rate_version:4,price:2,request_state:'succeeded',proof_state:'committed',
 proof_source:'server_task_engine',proof_revision:2,completed_at:900
});
const rsa=()=>crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
 publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
async function publicPinned(k){
 return crypto.subtle.importKey('spki',await crypto.subtle.exportKey('spki',k.publicKey),
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
}
async function setup(){
 const [tk,hk]=await Promise.all([rsa(),rsa()]);
 const taskKey=await publicPinned(tk),headKey=await publicPinned(hk);
 let envelope=null,head=null,clock=1001;
 let signedReads=0,headReads=0;
 const backend={
  readSignedTask:async()=>{signedReads++;return envelope;},
  readSignedHead:async()=>{headReads++;return head;},
  readServerTime:()=>clock
 };
 const signTask=async(data=task(),sequence=3)=>{
  const a={version:1,brand_id:'starry',environment:'staging',
   task:data,sequence,issued_ms:1000,key_id:'task_signer',signature:''};
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
   tk.privateKey,canonicalTaskProofV1(a));
  envelope={...a,signature:enc(sig)};
  return hex(await crypto.subtle.digest('SHA-256',sig));
 };
 const signHead=async(digest,extra={})=>{
  const a={version:1,brand_id:'starry',environment:'staging',
   source:'independent_protected_head',task_ref:'task_01',
   member_ref:'member_01',sequence:3,proof_revision:2,
   signature_sha256:digest,issued_ms:990,expires_ms:1020,
   key_id:'head_signer',signature:'',...extra};
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
   hk.privateKey,canonicalSignedTaskHeadV1(a));
  head={...a,signature:enc(sig)};
 };
 await signHead(await signTask());
 const create=(enabled=true,overrides={})=>createOfflineDualSignedTaskAuthority({
  enabled,environment:'staging',taskKeyId:'task_signer',headKeyId:'head_signer',
  taskVerifyKey:taskKey,headVerifyKey:headKey,backend,...overrides});
 return {backend,create,taskKey,headKey,tk,hk,
  signHead,signTask,head:()=>head,setHead:x=>{head=x},
  envelope:()=>envelope,setEnvelope:x=>{envelope=x},setClock:x=>{clock=x},
  get signedReads(){return signedReads},get headReads(){return headReads}};
}
test('R13 actual two independent RSA signatures and two head reads yield signed Task',async()=>{
 const x=await setup();
 assert.equal(DUAL_SIGNED_TASK_HEAD_LIVE,false);
 assert.deepEqual(await x.create().verifyCommitted('task_01','member_01',1001),task());
 assert.equal(x.signedReads,1);assert.equal(x.headReads,2);
});
test('R13 an unsigned, tampered, or separately signed wrong head never validates',async()=>{
 const x=await setup(),good=x.head();
 for(const changed of [
  {...good,sequence:4},{...good,member_ref:'other'},
  {...good,signature_sha256:'f'.repeat(64)},
  {...good,signature:good.signature.slice(0,-3)+'aaa'},
  {...good,extra:true}
 ]){
  x.setHead(changed);
  assert.equal(await x.create().verifyCommitted('task_01','member_01',1001),null);
 }
});
test('R13 genuine signed head for stale Task proof revision is denied',async()=>{
 const x=await setup();await x.signHead('a'.repeat(64),{sequence:4,proof_revision:3});
 assert.equal(await x.create().verifyCommitted('task_01','member_01',1001),null);
});
test('R13 post-read head sequence race causes fail-close, even two authentic signatures',async()=>{
 const x=await setup(),old=x.head();
 await x.signHead(old.signature_sha256,{sequence:4});
 const newer=x.head(),backend={...x.backend};let calls=0;
 backend.readSignedHead=async()=>{calls++;return calls===1?old:newer;};
 const v=x.create(true,{backend});
 assert.equal(await v.verifyCommitted('task_01','member_01',1001),null);
 assert.equal(calls,2);
});
test('R13 wrong brand, environment, expiration or future clock does not pass',async()=>{
 for(const extra of [
  {brand_id:'hglobal'},{environment:'production'},
  {expires_ms:991},{issued_ms:1200},{expires_ms:40000}
 ]){
  const x=await setup();await x.signHead(x.head().signature_sha256,extra);
  assert.equal(await x.create().verifyCommitted('task_01','member_01',1001),null);
 }
 const z=await setup();z.setClock(1020);
 assert.equal(await z.create().verifyCommitted('task_01','member_01',1001),null);
});
test('R13 Task signer and head signer key identities cannot be the same',async()=>{
 const x=await setup();
 assert.throws(()=>x.create(true,{headKeyId:'task_signer'}),/SEPARATION_DENIED/);
 assert.throws(()=>x.create(true,{headVerifyKey:x.taskKey}),/SEPARATION_DENIED/);
 assert.throws(()=>x.create(true,{headVerifyKey:x.hk.publicKey}),/PINNED_KEYS_REQUIRED/);
});
test('R13 revoked Proxy, getters and unknown head properties are rejected',async()=>{
 const x=await setup(),r=Proxy.revocable({...x.head()},{});r.revoke();
 for(const v of [r.proxy,{...x.head(),clientSuccess:true},null]){
  x.setHead(v);
  assert.equal(await x.create().verifyCommitted('task_01','member_01',1001),null);
 }
 const y=await setup(),evil={...y.head()};
 Object.defineProperty(evil,'sequence',{enumerable:true,get(){throw Error('secret')}});
 y.setHead(evil);
 assert.equal(await y.create().verifyCommitted('task_01','member_01',1001),null);
});
test('R13 disabled authority and source outage cannot consult or authenticate Task',async()=>{
 const x=await setup();
 assert.equal(await x.create(false).verifyCommitted('task_01','member_01',1001),null);
 assert.equal(x.signedReads,0);assert.equal(x.headReads,0);
 const y=await setup();const backend={...y.backend,
  readSignedHead:async()=>{throw Error('OFFLINE');}};
 assert.equal(await y.create(true,{backend}).verifyCommitted(
  'task_01','member_01',1001),null);
});
test('R13 authentic proof but changed Task price/source fails and R11 ACK retries',async()=>{
 const x=await setup(),a=x.envelope();
 x.setEnvelope({...a,task:{...task(),price:9}});
 assert.equal(await x.create().verifyCommitted('task_01','member_01',1001),null);
 let settled=0,ack=0,retry=0;const auth=x.create();
 const queue=createOfflineCommittedTaskDelivery({brand_id:'starry',environment:'staging'},{
  readCommittedTask:async()=>auth.verifyCommitted('task_01','member_01',1001),
  readCurrentMember:async()=>({brand_id:'starry',member_ref:'member_01',
   status:'active',auth_version:1,revision:1}),
  settleBattery:async()=>{settled++;return {outcome:'committed'}},
  readCommittedBattery:async()=>null,
  persistDeadLetter:async()=>{throw Error('unavailable')}
 });
 assert.equal(await queue.dispatch({body:{task_ref:'task_01'},attempts:1,
  ack:()=>{ack++},retry:()=>{retry++}}),'retried');
 assert.equal(settled,0);assert.equal(ack,0);assert.equal(retry,1);
});
test('R13 same-head/signature replay remains insufficient for real monotone infrastructure',async()=>{
 const x=await setup(),old=x.head();
 // Cryptographically valid old Task + old Head are indistinguishable to an
 // offline verifier if BOTH trusted source ports were rolled back together.
 await x.signHead(old.signature_sha256,{sequence:4,proof_revision:2});
 x.setHead(old);
 assert.deepEqual(await x.create().verifyCommitted('task_01','member_01',1001),task());
});
