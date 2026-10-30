import test from 'node:test';
import assert from 'node:assert/strict';
import {URL} from 'node:url';
import {createDeletionFlow} from '../src/account-deletion-flow.ts';
import {createDeletionPreview} from '../src/account-deletion-preview.ts';
import {M2DeletionClientError} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';

test('M2 mobile controller requires two separate actions and never reports physical deletion',async()=>{
 const port=createDeletionPreview();
 const flow=createDeletionFlow(port);
 const transitions=[];const off=flow.subscribe(x=>transitions.push(x.phase));
 await flow.refresh();
 assert.equal(flow.snapshot().phase,'idle');
 assert.equal(flow.snapshot().receipt,null);
 await flow.confirmSecond(); // cannot skip first step
 assert.equal(flow.snapshot().phase,'idle');
 await flow.requestFirst();
 assert.equal(flow.snapshot().phase,'awaiting_second_confirmation');
 assert.equal(flow.snapshot().receipt.physical_erasure_completed,false);
 assert.equal(flow.snapshot().receipt.execution_authorized,false);
 const id=flow.snapshot().receipt.request_id;
 await flow.confirmSecond();
 assert.equal(flow.snapshot().phase,'pending_processing');
 assert.equal(flow.snapshot().receipt.request_id,id);
 assert.equal(flow.snapshot().receipt.physical_erasure_completed,false);
 await flow.refresh();
 assert.equal(flow.snapshot().phase,'pending_processing');
 off();
 assert.deepEqual(transitions.filter(x=>x==='loading').length,4);
});
test('M2 mobile controller 503 preserves receipt and retry of second confirmation is idempotent',async()=>{
 const port=createDeletionPreview(),flow=createDeletionFlow(port);
 await flow.requestFirst();
 const id=flow.snapshot().receipt.request_id;
 port.failNext('UNAVAILABLE');
 await flow.confirmSecond();
 assert.equal(flow.snapshot().phase,'error');
 assert.equal(flow.snapshot().intent,'second');
 assert.equal(flow.snapshot().receipt.request_id,id);
 await flow.retry();
 assert.equal(flow.snapshot().phase,'pending_processing');
 assert.equal(flow.snapshot().receipt.request_id,id);
});
test('M2 mobile controller first request network ambiguity retries same backend idempotent request',async()=>{
 let record=null,requests=0;
 const port={
  async getStatus(){return record;},
  async requestDeletion(){
   requests++;
   record??={
    request_id:'m2del-'+'a'.repeat(48),status:'awaiting_second_confirmation',
    first_confirmed_at:1793000000,second_confirmed_at:null,
    physical_erasure_completed:false,execution_authorized:false,
   };
   if(requests===1)throw new M2DeletionClientError('UNAVAILABLE');
   return record;
  },
  async confirmDeletion(){throw Error('not used');},
 };
 const flow=createDeletionFlow(port);
 await flow.requestFirst();
 assert.equal(flow.snapshot().phase,'error');
 await flow.retry();
 assert.equal(flow.snapshot().phase,'awaiting_second_confirmation');
 assert.equal(requests,2);
 assert.equal(record.request_id,flow.snapshot().receipt.request_id);
});
test('M2 mobile controller expired identity results in explicit unauthorized without raw token',async()=>{
 const port=createDeletionPreview(),flow=createDeletionFlow(port);
 port.failNext('UNAUTHORIZED');
 await flow.refresh();
 assert.equal(flow.snapshot().phase,'unauthorized');
 assert.equal(flow.snapshot().error,'UNAUTHORIZED');
 assert.equal(flow.snapshot().receipt,null);
 await flow.refresh();
 assert.equal(flow.snapshot().phase,'idle');
});
test('M2 mobile controller blocks repeat taps while first request is awaiting a response',async()=>{
 let resolve;
 const promise=new Promise(r=>{resolve=r;});
 let hits=0;
 const receipt={
  request_id:'m2del-'+'b'.repeat(48),status:'awaiting_second_confirmation',
  first_confirmed_at:1793000000,second_confirmed_at:null,
  physical_erasure_completed:false,execution_authorized:false,
 };
 const flow=createDeletionFlow({
  async getStatus(){return null;},
  async requestDeletion(){hits++;await promise;return receipt;},
  async confirmDeletion(){throw Error('unexpected');},
 });
 const a=flow.requestFirst();
 const b=flow.requestFirst();
 assert.equal(flow.snapshot().phase,'loading');
 assert.equal(hits,1);
 resolve();
 await Promise.all([a,b]);
 assert.equal(hits,1);
 assert.equal(flow.snapshot().phase,'awaiting_second_confirmation');
});
test('M2 route has only DEV-only in-memory preview and no fixture bearer, storage or direct live API',async()=>{
 const {readFileSync}=await import('node:fs');
 const route=readFileSync(new URL('../app/account-deletion.tsx',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/account-deletion-screen.tsx',import.meta.url),'utf8');
 assert.match(route,/__DEV__===true/);
 assert.match(route,/createDeletionPreview/);
 assert.match(route,/disabledPort/);
 assert.doesNotMatch(route,/fixture|localStorage|AsyncStorage|EXPO_PUBLIC_|createM2DeletionRequestClient/i);
 assert.match(ui,/第一次確認：我要提出刪帳申請/);
 assert.match(ui,/第二次確認：確認送出刪帳申請/);
 assert.match(ui,/尚在處理中/);
 assert.match(ui,/不會自動取消商店訂閱/);
 assert.doesNotMatch(ui,/physical.erasure.completed|execution.authorized|G00|Q104|Q119/i);
});
