import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualReplayReviewOnly} from '../src/replay-review.ts';
const key='b_'+'a'.repeat(64);
const scope={brand_id:'starry',app_id:'starry.test',environment:'staging'};
test('persisted evidence yields review_only but NEVER permission to replay',async()=>{
 const inspector=createManualReplayReviewOnly(scope,{
  readPersistedQuarantineOrDlq:async()=>({event_ref:key,reason_code:'SOURCE_UNAVAILABLE'}),
 });
 const x=await inspector.inspect(key);
 assert.equal(x.status,'review_only');assert.equal(x.enqueue_permitted,false);
 assert.equal(x.required_approvals.includes('AI1_FRESH_CURRENT_ADMIN_GRANT_AND_STEP_UP'),true);
 assert.equal(typeof inspector.replay,'undefined');
 assert.equal(typeof inspector.enqueue,'undefined');
});
test('missing or unreachable persistent DLQ/quarantine evidence blocks review',async()=>{
 for(const value of [null,{}, {event_ref:key}, {event_ref:key,reason_code:'client@email'},
  {event_ref:'b_'+'b'.repeat(64),reason_code:'SOURCE_UNAVAILABLE'}]){
  const i=createManualReplayReviewOnly(scope,{
   readPersistedQuarantineOrDlq:async()=>value,
  });
  assert.equal((await i.inspect(key)).status,'blocked');
 }
 const down=createManualReplayReviewOnly(scope,{readPersistedQuarantineOrDlq:async()=>{throw Error('D1_DOWN')}});
 assert.equal((await down.inspect(key)).status,'blocked');
});
test('deny hidden getter/unknown payload and forged replay evidence',async()=>{
 const hidden={event_ref:key,reason_code:'SOURCE_UNAVAILABLE'};
 Object.defineProperty(hidden,'token',{value:'secret',enumerable:false});
 const getter={event_ref:key};
 Object.defineProperty(getter,'reason_code',{enumerable:true,get(){return 'SOURCE_UNAVAILABLE'}});
 for(const x of [hidden,getter,{...hidden,email:'private'}]){
  assert.equal((await createManualReplayReviewOnly(scope,{readPersistedQuarantineOrDlq:async()=>x}).inspect(key)).status,'blocked');
 }
});
test('never accept client ref or production scope',async()=>{
 const i=createManualReplayReviewOnly(scope,{readPersistedQuarantineOrDlq:async()=>null});
 assert.equal((await i.inspect('paid=true')).status,'blocked');
 assert.throws(()=>createManualReplayReviewOnly({...scope,environment:'production'},{
  readPersistedQuarantineOrDlq:async()=>null}),/DRAFT_ONLY/);
});
