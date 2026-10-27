import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_BATTERY_DEEP_RESTORE_ENABLED,createOfflineBatteryRecoveryReview,
 createOfflineBatteryBoundRestore} from '../src/battery-recovery-integrity.ts';
const scope={brand_id:'starry',environment:'isolated-test',dataset:'battery'};
const baseJournal=[
 {revision:1,kind:'registration_grant',event_ref:'initial_registration',delta:10,
  balance_after:10,reason_code:'REGISTER_ONCE',policy_version:1,at_ms:100},
 {revision:2,kind:'reserve',event_ref:'task_1',delta:-7,
  balance_after:3,reason_code:'TASK_RESERVE',policy_version:1,at_ms:1000},
 {revision:3,kind:'commit',event_ref:'task_1',delta:0,
  balance_after:3,reason_code:'TASK_SUCCEEDED',policy_version:1,at_ms:1100}
];
const hold={task_ref:'task_1',app_id:'starry-ai',task_type:'chat',price:7,
 rate_version:1,policy_version:1,created_ms:1000,expires_ms:181000,status:'committed'};
const wallet={member_ref:'member_1',balance:3,version:3,overdraft_used:0,
 registration_granted:true,first_task_granted:false,revoked:false,
 holds:[hold],journal:baseJournal};
const clone=x=>structuredClone(x);
const ports=(d={})=>({readCurrent:async()=>[clone(wallet)],readPitr:async()=>[clone(wallet)],
 readIndependent:async()=>[clone(wallet)],verifyProtectedAnchor:async()=>true,...d});
const review=(p=ports(),s=scope)=>createOfflineBatteryRecoveryReview(p).review(s);
test('R11 live restore disabled and only review-only possible',async()=>{
 assert.equal(LIVE_BATTERY_DEEP_RESTORE_ENABLED,false);
 const r=await review();assert.equal(r.disposition,'review_only');assert.equal(r.may_restore,false);
 assert.match(r.digest_sha256,/^[a-f0-9]{64}$/);
});
test('R11 canonical row sorting ignores harmless holder/journal source order',async()=>{
 const p=ports({readIndependent:async()=>[{...clone(wallet),journal:[...clone(baseJournal)].reverse()}]});
 assert.equal((await review(p)).disposition,'review_only');
});
test('R11 different but same-count old wallet or stolen reserve fails',async()=>{
 for(const change of [
  {...clone(wallet),balance:4},
  {...clone(wallet),holds:[{...clone(hold),price:8}]},
  {...clone(wallet),holds:[{...clone(hold),status:'held'}]},
  {...clone(wallet),journal:clone(baseJournal).map((x,i)=>i===2?{...x,at_ms:1200}:x)}
 ]){
  const r=await review(ports({readPitr:async()=>[change]}));
  assert.equal(r.disposition,'blocked');
 }
});
test('R11 forged snapshot with rebalanced journal but old reserve price is blocked',async()=>{
 const changed=clone(wallet);
 changed.holds[0].price=8;changed.journal[1].delta=-8;
 changed.journal[1].balance_after=2;changed.journal[2].balance_after=2;changed.balance=2;
 const r=await review(ports({readPitr:async()=>[changed]}));
 assert.equal(r.disposition,'blocked');
});
test('R11 prevent deleted member wallet resurrection',async()=>{
 const dead=clone(wallet);dead.balance=0;dead.revoked=true;dead.holds[0].status='committed';
 dead.journal.push({revision:4,kind:'revoke',event_ref:'deleted_account',delta:-3,
  balance_after:0,reason_code:'ACCOUNT_DELETED',policy_version:1,at_ms:1200});dead.version=4;
 const p=ports({readCurrent:async()=>[dead]});
 assert.equal((await review(p)).disposition,'blocked');
 const p2=ports({readCurrent:async()=>[dead],readPitr:async()=>[dead],readIndependent:async()=>[dead]});
 assert.equal((await review(p2)).disposition,'review_only');
});
test('R11 duplicate journal revision, duplicate first gift, arithmetic jump rejected',async()=>{
 for(const altered of [
  {...clone(wallet),journal:[baseJournal[0],baseJournal[0],baseJournal[2]]},
  {...clone(wallet),journal:[{...baseJournal[0],balance_after:11},...baseJournal.slice(1)]},
  {...clone(wallet),journal:[baseJournal[0],baseJournal[1],{...baseJournal[2],kind:'first_task_grant'}]},
  {...clone(wallet),journal:[...baseJournal.slice(0,2),{...baseJournal[2],kind:'release',delta:7,balance_after:10}]}
 ]){
  assert.equal((await review(ports({readCurrent:async()=>[altered]}))).disposition,'blocked');
 }
});
test('R11 reject late success, missing hold, non-contiguous revision, fake overdraft',async()=>{
 for(const bad of [
  {...clone(wallet),journal:[...baseJournal.slice(0,2),{...baseJournal[2],at_ms:181000}]},
  {...clone(wallet),holds:[]},
  {...clone(wallet),journal:[baseJournal[0],{...baseJournal[1],revision:5},baseJournal[2]]},
  {...clone(wallet),overdraft_used:2},
  {...clone(wallet),version:2}
 ])assert.equal((await review(ports({readIndependent:async()=>[bad]}))).disposition,'blocked');
});
test('R11 independent anchor must verify even when all three snapshots match',async()=>{
 let calls=0;const r=await review(ports({verifyProtectedAnchor:async()=>{calls++;return false}}));
 assert.equal(r.reason,'INDEPENDENT_WITNESS_MISSING');assert.equal(calls,1);
});
test('R11 scope HGlobal, production or audit rejected before backend access',async()=>{
 let access=0;const p=ports({readCurrent:async()=>{access++;return [wallet]}});
 for(const s of [{...scope,brand_id:'hglobal'}, {...scope,environment:'production'},
  {...scope,dataset:'audit'},{...scope,authority:true}]){
  assert.equal((await review(p,s)).reason,'INVALID_SCOPE');
 }
 assert.equal(access,0);
});
test('R11 reject getter, hidden personal data, malformed array and revoked proxy',async()=>{
 const hidden=clone(wallet);Object.defineProperty(hidden,'oauth_subject',{value:'secret',enumerable:false});
 const getter=clone(wallet);Object.defineProperty(getter,'member_ref',{enumerable:true,get(){return 'member_1'}});
 const revoked=Proxy.revocable(clone(wallet),{});revoked.revoke();
 for(const bad of [hidden,getter,revoked.proxy]){
  assert.equal((await review(ports({readPitr:async()=>[bad]}))).disposition,'blocked');
 }
 const array=[clone(wallet)];Object.defineProperty(array,'email',{value:'private'});
 assert.equal((await review(ports({readCurrent:async()=>array}))).disposition,'blocked');
});
test('R11 duplicate members, missing independent source and outage fail closed',async()=>{
 for(const p of [ports({readCurrent:async()=>[wallet,wallet]}),
  ports({readIndependent:async()=>null}),ports({readCurrent:async()=>{throw Error('D1 OUTAGE')}})]){
  assert.equal((await review(p)).disposition,'blocked');
 }
});
test('R11 cross Gate: deep proof alone never bypasses Q116 legal hold/fences',async()=>{
 const b={scope,request_ref:'review_1234',requested_ms:5000,artifacts:[
  {source:'d1_pitr',artifact_ref:'pitr_1234',manifest_sha256:'a'.repeat(64),
   captured_ms:2000,checkpoints:{deleted_members:1,revoked_sessions:1,
    claimed_registration_gifts:1,battery_journal:1,committed_ai_tasks:1,billing_outbox:1,audit_events:1}},
  {source:'independent_backup',artifact_ref:'vault_1234',manifest_sha256:'b'.repeat(64),
   captured_ms:2000,checkpoints:{deleted_members:1,revoked_sessions:1,
    claimed_registration_gifts:1,battery_journal:1,committed_ai_tasks:1,billing_outbox:1,audit_events:1}}
 ]};
 const restore={verifyPitr:async()=>true,verifyIndependentBackup:async()=>true,
  readAuthoritativeFences:async()=>b.artifacts[0].checkpoints,readLegalHold:async()=> 'held',
  verifyOperatorStepUp:async()=>true,recordReviewEvidence:async()=>true};
 const bound=createOfflineBatteryBoundRestore(ports(),restore);
 assert.equal((await bound.review(b,5000)).reason,'Q116_LEGAL_SEVEN_FENCE_GATE_BLOCKED');
 const legal={...restore,readLegalHold:async()=> 'clear'};
 const ok=await createOfflineBatteryBoundRestore(ports(),legal).review(b,5000);
 assert.equal(ok.disposition,'review_only');assert.equal(ok.may_restore,false);
});
test('R11 protected witness outage or forged proto rejected',async()=>{
 const d=Object.create({evil:true});Object.assign(d,clone(wallet));
 assert.equal((await review(ports({readIndependent:async()=>[d]}))).disposition,'blocked');
 const p=ports({verifyProtectedAnchor:async()=>{throw Error('ANCHOR DOWN')}});
 assert.equal((await review(p)).reason,'SOURCE_OR_WITNESS_UNAVAILABLE');
});
