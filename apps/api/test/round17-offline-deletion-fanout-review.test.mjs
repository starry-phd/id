import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineDeletionFanoutReview,LIVE_R17_DELETION_FANOUT,
 R17_FANOUT_CONTRACT} from '../src/round17-offline-deletion-fanout-review.ts';

const event='delete_'+'f'.repeat(32);
const scope={brand_id:'starry',environment:'staging'};
function fixture(){
 let revision='law-v1',approved=true,member='member_01',version=3,deleted=true;
 let calls=0,policyReads=0,authReads=0,sinkReads=0;
 const receipts=new Map();
 for(const sink of ['battery','billing','task']){
  receipts.set(sink,{sink,...scope,event_id:event,member_ref:member,auth_version:version,
   policy_revision:revision,local_inbox_applied:true,blocked_from_regrant:true,
   pending_operations:0});
 }
 const ports={
  readPolicy:async()=>{policyReads++;return {revision,processing_approved:approved}},
  readCurrentDeletion:async()=>{authReads++;return { ...scope,event_id:event,
   member_ref:member,auth_version:version,deleted}},
  deliverLocal:async()=>{calls++;return Object.freeze({
   status:'local_recorded',reason:'SINK_REVOCATION_LOCALLY_DURABLE_ONLY',
   may_ack_queue:false,may_regrant:false,live:false,
   sole_publisher:'AI-1_AUTH_COMMITTED_OUTBOX'})},
  readLocalSink:async(sink)=>{sinkReads++;return receipts.get(sink)??null}
 };
 return {ports,receipts,review:()=>createOfflineDeletionFanoutReview(scope,'law-v1',ports),
  setRevision:v=>{revision=v},setApproved:v=>{approved=v},
  setMember:v=>{member=v},setVersion:v=>{version=v},setDeleted:v=>{deleted=v},
  get calls(){return calls},get policyReads(){return policyReads},
  get authReads(){return authReads},get sinkReads(){return sinkReads}};
}
function noRemoteAction(result){
 for(const key of ['may_ack_queue','may_dlq','may_regrant','may_release_task','publishable','live'])
  assert.equal(result[key],false,key);
 assert.equal(Object.isFrozen(result),true);
}
test('R17 three private local sink receipts may show candidate consistency, never Queue ACK',async()=>{
 const f=fixture();const a=await f.review().review(event,1700000060);
 assert.equal(a.status,'candidate_consistent');
 assert.equal(a.reason,'ONLY_LOCAL_CANDIDATE_NOT_AN_ACK');
 assert.equal(f.calls,1);assert.equal(f.sinkReads,3);
 assert.equal(f.policyReads,3);assert.equal(f.authReads,2);
 assert.equal(LIVE_R17_DELETION_FANOUT,false);
 assert.equal(R17_FANOUT_CONTRACT,'starry.deletion-fanout-review.v0-draft');
 noRemoteAction(a);
});
test('R17 invalid scope, policy, ports or event fail closed before coordinator invocation',async()=>{
 const f=fixture();
 assert.throws(()=>createOfflineDeletionFanoutReview({...scope,brand_id:'hglobal'},'law-v1',f.ports),/SCOPE_DENIED/);
 assert.throws(()=>createOfflineDeletionFanoutReview({...scope,environment:'production'},'law-v1',f.ports),/SCOPE_DENIED/);
 assert.throws(()=>createOfflineDeletionFanoutReview(scope,'',f.ports),/REVISION_REQUIRED/);
 assert.throws(()=>createOfflineDeletionFanoutReview(scope,'law-v1',{}),/PORTS_REQUIRED/);
 for(const x of [null,{},'abc',{event_id:event}]){
  const a=await f.review().review(x,1700000060);assert.equal(a.status,'blocked');noRemoteAction(a);
 }
 assert.equal((await f.review().review(event,Number.MAX_SAFE_INTEGER)).status,'blocked');
 assert.equal(f.calls,0);
});
test('R17 local approval missing or Auth deleted projection not current: no Battery write invocation',async()=>{
 const f=fixture();f.setApproved(false);
 let a=await f.review().review(event,1700000060);
 assert.equal(a.status,'blocked');assert.equal(f.calls,0);noRemoteAction(a);
 f.setApproved(true);f.setDeleted(false);
 a=await f.review().review(event,1700000060);
 assert.equal(a.status,'blocked');assert.equal(f.calls,0);noRemoteAction(a);
});
test('R17 partial fanout and each missing sink independently require retry',async()=>{
 for(const sink of ['battery','billing','task']){
  const f=fixture();f.receipts.delete(sink);
  const a=await f.review().review(event,1700000060);
  assert.equal(a.status,'retry',sink);assert.equal(f.calls,1,sink);noRemoteAction(a);
 }
});
test('R17 reject wrong member, policy, environment, version, pending operations and false durable proof',async()=>{
 const changes=[
  {member_ref:'other'},{policy_revision:'old-law'},{environment:'production'},
  {auth_version:7},{pending_operations:1},{local_inbox_applied:false},
  {blocked_from_regrant:false},{brand_id:'hglobal'}
 ];
 for(const changed of changes){
  const f=fixture();f.receipts.set('billing',{...f.receipts.get('billing'),...changed});
  const a=await f.review().review(event,1700000060);
  assert.equal(a.status,'retry',JSON.stringify(changed));noRemoteAction(a);
 }
});
test('R17 local policy revision or legality revoked AFTER R16 attempt cannot be misreported as delivery success',async()=>{
 for(const change of ['revision','approved']){
  const f=fixture();const old=f.ports.deliverLocal;
  f.ports.deliverLocal=async(...args)=>{
   const result=await old(...args);
   if(change==='revision')f.setRevision('law-v2');else f.setApproved(false);
   return result;
  };
  const a=await f.review().review(event,1700000060);
  assert.equal(a.status,'retry');assert.equal(a.reason,'POLICY_CHANGED_AFTER_LOCAL_DELIVERY');
  assert.equal(f.calls,1);noRemoteAction(a);
 }
});
test('R17 legal version switch during last receipt readback rejects old candidate',async()=>{
 const f=fixture();const old=f.ports.readLocalSink;
 f.ports.readLocalSink=async(...args)=>{
  const result=await old(...args);
  if(args[0]==='task')f.setRevision('law-v2');
  return result;
 };
 const a=await f.review().review(event,1700000060);
 assert.equal(a.status,'retry');assert.equal(a.reason,'POLICY_CHANGED_AFTER_READBACK');noRemoteAction(a);
});
test('R17 changed Auth identity/version or fake cross-environment projection after readback is denied',async()=>{
 for(const change of ['member','version','environment']){
  const f=fixture();const old=f.ports.readLocalSink;
  f.ports.readLocalSink=async(...args)=>{
   const result=await old(...args);
   if(args[0]==='task'){
    if(change==='member')f.setMember('other');
    else if(change==='version')f.setVersion(7);
    else f.ports.readCurrentDeletion=async()=>({...scope,environment:'production',
     event_id:event,member_ref:'member_01',auth_version:3,deleted:true});
   }
   return result;
  };
  const a=await f.review().review(event,1700000060);
  assert.equal(a.status,'retry',change);noRemoteAction(a);
 }
});
test('R17 cannot trust alleged R16 ACK, publisher, flags, retries or remote success',async()=>{
 const invalid=[
  {may_ack_queue:true},{may_regrant:true},{live:true},
  {sole_publisher:'AI-4'},{status:'sent_live'}, {status:'retry'}
 ];
 for(const change of invalid){
  const f=fixture();const previous=f.ports.deliverLocal;
  f.ports.deliverLocal=async(...args)=>({...await previous(...args),...change});
  const a=await f.review().review(event,1700000060);
  assert.notEqual(a.status,'candidate_consistent');noRemoteAction(a);
 }
});
test('R17 missing/hostile getter evidence and transient readback failure never ACK or DLQ',async()=>{
 const f=fixture();
 f.receipts.set('battery',Object.defineProperty({},'sink',{enumerable:true,get(){throw Error('getter')}}));
 let a=await f.review().review(event,1700000060);
 assert.equal(a.status,'retry');noRemoteAction(a);
 f.ports.readLocalSink=async()=>{throw Error('sink disconnected')};
 a=await f.review().review(event,1700000060);
 assert.equal(a.status,'retry');noRemoteAction(a);
});
test('R17 repeated local review stays read-only, no second sender, no ACK authority',async()=>{
 const f=fixture();
 const first=await f.review().review(event,1700000060);
 f.ports.deliverLocal=async()=>({...await Promise.resolve(first),
  status:'duplicate_local',reason:'ALREADY_CONSUMED_IN_SINK',
  sole_publisher:'AI-1_AUTH_COMMITTED_OUTBOX'});
 const again=await f.review().review(event,1700000061);
 assert.equal(again.status,'candidate_consistent');noRemoteAction(again);
});
