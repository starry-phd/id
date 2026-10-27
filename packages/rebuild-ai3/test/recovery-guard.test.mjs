import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_RECOVERY_ENABLED,RESTORE_MUTATION_ALLOWED,FENCE_NAMES,
 assessIsolatedRestore} from '../src/recovery-guard.ts';
const now=1730000000000;
const fence=Object.fromEntries(FENCE_NAMES.map((k,i)=>[k,i+20]));
const scope={brand_id:'starry',environment:'isolated-test',dataset:'battery'};
const manifest={scope,request_ref:'review_1234',requested_ms:now-1000,artifacts:[
 {source:'d1_pitr',artifact_ref:'pitr_1234',manifest_sha256:'a'.repeat(64),captured_ms:now-3000,checkpoints:fence},
 {source:'independent_backup',artifact_ref:'vault_1234',manifest_sha256:'b'.repeat(64),captured_ms:now-5000,checkpoints:{...fence}},
]};
const ports=(changed={})=>({verifyPitr:async()=>true,verifyIndependentBackup:async()=>true,
 readAuthoritativeFences:async()=>fence,readLegalHold:async()=> 'clear',
 verifyOperatorStepUp:async()=>true,recordReviewEvidence:async()=>true,...changed});
const call=(m=manifest,p=ports(),clock=now)=>assessIsolatedRestore(m,p,clock);
test('Q116 no live recovery, no automatic restore command',async()=>{
 assert.equal(LIVE_RECOVERY_ENABLED,false);assert.equal(RESTORE_MUTATION_ALLOWED,false);
 const r=await call();assert.equal(r.disposition,'review_only');assert.equal(r.may_restore,false);
 assert.deepEqual(r.blocked_fences,[]);
});
test('Q116 every deleted user / revoked session / claimed gift fence must match',async()=>{
 for(const key of FENCE_NAMES){
  const stale={...fence,[key]:fence[key]-1};
  const r=await call(manifest,ports({readAuthoritativeFences:async()=>stale}));
  assert.equal(r.disposition,'blocked',key);assert.deepEqual(r.blocked_fences,[key]);
  assert.equal(r.reason,'PITR_STALE_OR_DIVERGENT');
 }
});
test('Q116 no H-Global, production, scope substitution or untrusted flags',async()=>{
 for(const patch of [
  {scope:{...scope,brand_id:'hglobal'}}, {scope:{...scope,environment:'production'}},
  {scope:{...scope,dataset:'billing'}}, {paid:true},
 ])assert.equal((await call({...manifest,...patch})).reason,'INVALID_UNTRUSTED_MANIFEST');
});
test('Q116 rejects duplicate/identical sources and future evidence',async()=>{
 for(const bad of [
  {...manifest,artifacts:[manifest.artifacts[0],manifest.artifacts[0]]},
  {...manifest,artifacts:[manifest.artifacts[0],{...manifest.artifacts[1],manifest_sha256:'a'.repeat(64)}]},
  {...manifest,requested_ms:now+1},
  {...manifest,artifacts:[{...manifest.artifacts[0],captured_ms:now+1},manifest.artifacts[1]]}
 ]) assert.equal((await call(bad)).disposition,'blocked');
});
test('Q116 unequal independent manifests -> replay review, never apply',async()=>{
 const alt={...manifest.artifacts[1],checkpoints:{...fence,battery_journal:99}};
 const r=await call({...manifest,artifacts:[manifest.artifacts[0],alt]});
 assert.equal(r.reason,'SOURCES_DISAGREE_REPLAY_REVIEW');
 assert.deepEqual(r.blocked_fences,['battery_journal']);
});
test('Q116 fake/failing signature verification, legal hold, missing sources fail closed',async()=>{
 for(const p of [ports({verifyPitr:async()=>false}),
  ports({verifyIndependentBackup:async()=>false}),
  ports({verifyPitr:async()=>{throw Error('backend down')}}),
  ports({readLegalHold:async()=> 'held'}),ports({readLegalHold:async()=> 'unknown'}),
  ports({readAuthoritativeFences:async()=>null}),{},
 ]) assert.equal((await call(manifest,p)).disposition,'blocked');
});
test('Q116 step-up and persisted review evidence mandatory before review',async()=>{
 for(const p of [ports({verifyOperatorStepUp:async()=>false}),
  ports({recordReviewEvidence:async()=>false}),
  ports({recordReviewEvidence:async()=>{throw Error('DB down')}})]){
  const r=await call(manifest,p);assert.equal(r.disposition,'blocked');
 }
});
test('Q116 rejects accessor / hidden / revoked proxy attacks without throwing',async()=>{
 const hidden={...manifest};Object.defineProperty(hidden,'token',{value:'raw',enumerable:false});
 const accessor={...manifest};Object.defineProperty(accessor,'scope',{enumerable:true,get(){return scope}});
 const revoked=Proxy.revocable(manifest,{});revoked.revoke();
 for(const bad of [hidden,accessor,revoked.proxy,{...manifest,artifacts:[...manifest.artifacts,manifest.artifacts[1]]}]){
  assert.equal((await call(bad)).reason,'INVALID_UNTRUSTED_MANIFEST');
 }
});
test('Q116 rejects malformed/unsafe watermark, snapshot reference, digest',async()=>{
 for(const bad of [
  {...manifest,artifacts:[{...manifest.artifacts[0],checkpoints:{...fence,audit_events:Infinity}},manifest.artifacts[1]]},
  {...manifest,artifacts:[{...manifest.artifacts[0],artifact_ref:'../../root'},manifest.artifacts[1]]},
  {...manifest,artifacts:[{...manifest.artifacts[0],manifest_sha256:'not_hex'},manifest.artifacts[1]]},
 ])assert.equal((await call(bad)).disposition,'blocked');
});
test('Q116 independent proofs and current sources checked in order, no false success',async()=>{
 const calls=[];
 const gate=ports({verifyPitr:async()=>{calls.push('pitr');return true},
 verifyIndependentBackup:async()=>{calls.push('backup');return true},
 readAuthoritativeFences:async()=>{calls.push('live');return fence},
 readLegalHold:async()=>{calls.push('legal');return 'clear'},
 verifyOperatorStepUp:async()=>{calls.push('stepup');return true},
 recordReviewEvidence:async()=>{calls.push('audit');return true}});
 assert.equal((await call(manifest,gate)).disposition,'review_only');
 assert.deepEqual(calls,['pitr','backup','live','legal','stepup','audit']);
});
