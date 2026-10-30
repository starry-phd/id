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
 // AI-0: retry of an uncertain POST first recovers state with GET. Since
 // the real server still reports awaiting, never auto-press second confirm.
 assert.equal(flow.snapshot().phase,'awaiting_second_confirmation');
 assert.equal(flow.snapshot().receipt.request_id,id);
 await flow.confirmSecond(); // deliberate new human action
 assert.equal(flow.snapshot().phase,'pending_processing');
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
 assert.equal(flow.snapshot().phase,'unauthorized'); // latched, no old Session retry
 const trustedNewPort=createDeletionFlow(createDeletionPreview());
 await trustedNewPort.refresh();
 assert.equal(trustedNewPort.snapshot().phase,'idle');
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
 assert.doesNotMatch(route,/localStorage|AsyncStorage|EXPO_PUBLIC_|createM2DeletionRequestClient|getSessionBearer|fetch\(/i);
 assert.match(ui,/第一次確認：我要提出刪帳申請/);
 assert.match(ui,/第二次確認：確認送出刪帳申請/);
 assert.match(ui,/尚在處理中/);
 assert.match(ui,/不會自動取消商店訂閱/);
 assert.doesNotMatch(ui,/physical.erasure.completed|execution.authorized|G00|Q104|Q119/i);
});


test('AI-0 regression: 401 after an existing receipt purges old identity and blocks both confirm and retry',async()=>{
 const port=createDeletionPreview(),flow=createDeletionFlow(port);
 await flow.requestFirst();
 assert.ok(flow.snapshot().receipt?.request_id);
 port.failNext('UNAUTHORIZED');
 await flow.refresh();
 assert.deepEqual({phase:flow.snapshot().phase,receipt:flow.snapshot().receipt,
  intent:flow.snapshot().intent}, {phase:'unauthorized',receipt:null,intent:null});
 await flow.retry();
 await flow.confirmSecond();
 await flow.requestFirst();
 await flow.refresh();
 assert.equal(flow.snapshot().phase,'unauthorized');
 assert.equal(flow.snapshot().receipt,null);
 // Only a NEW trusted member/port flow can show a receipt again.
 const other=createDeletionFlow(createDeletionPreview());
 assert.equal(other.snapshot().receipt,null);
 await other.refresh();
 assert.equal(other.snapshot().phase,'idle');
});

test('AI-0 regression: lost FIRST POST response calls GET before retry and never creates duplicate receipt',async()=>{
 const receipt={
  request_id:'m2del-'+'e'.repeat(48),status:'awaiting_second_confirmation',
  first_confirmed_at:1793000000,second_confirmed_at:null,
  physical_erasure_completed:false,execution_authorized:false,
 };
 const sequence=[];let state=null;
 const port={
  async getStatus(){sequence.push('GET');return state;},
  async requestDeletion(){
   sequence.push('POST1');
   state=receipt;
   if(sequence.filter(x=>x==='POST1').length===1)
    throw new M2DeletionClientError('UNAVAILABLE');
   return state;
  },
  async confirmDeletion(){sequence.push('POST2');throw Error('unexpected');},
 };
 const flow=createDeletionFlow(port);
 await flow.requestFirst();
 assert.deepEqual(sequence,['POST1']);
 await flow.retry();
 assert.deepEqual(sequence,['POST1','GET']); // no second POST
 assert.equal(flow.snapshot().phase,'awaiting_second_confirmation');
 assert.equal(flow.snapshot().receipt.request_id,receipt.request_id);
});

test('AI-0 regression: lost SECOND POST response calls GET and never silently executes second step again',async()=>{
 const awaiting={
  request_id:'m2del-'+'f'.repeat(48),status:'awaiting_second_confirmation',
  first_confirmed_at:1793000000,second_confirmed_at:null,
  physical_erasure_completed:false,execution_authorized:false,
 };
 let state=awaiting;
 const sequence=[];
 const port={
  async getStatus(){sequence.push('GET');return state;},
  async requestDeletion(){sequence.push('POST1');return awaiting;},
  async confirmDeletion(){
   sequence.push('POST2');
   state={...awaiting,status:'pending_processing',second_confirmed_at:1793000002};
   throw new M2DeletionClientError('UNAVAILABLE'); // response lost after committed write
  },
 };
 const flow=createDeletionFlow(port);
 await flow.refresh();
 await flow.confirmSecond();
 assert.deepEqual(sequence,['GET','POST2']);
 assert.equal(flow.snapshot().phase,'error');
 await flow.retry();
 assert.deepEqual(sequence,['GET','POST2','GET']);
 assert.equal(flow.snapshot().phase,'pending_processing');
 assert.equal(flow.snapshot().receipt.physical_erasure_completed,false);
});

test('AI-0 regression: retry of lost FIRST with no server receipt GETs then POST1 idempotently',async()=>{
 const sequence=[];let failures=0;
 const receipt={
  request_id:'m2del-'+'1'.repeat(48),status:'awaiting_second_confirmation',
  first_confirmed_at:1793000000,second_confirmed_at:null,
  physical_erasure_completed:false,execution_authorized:false,
 };
 const flow=createDeletionFlow({
  async getStatus(){sequence.push('GET');return null;},
  async requestDeletion(){
   sequence.push('POST1');
   if(failures++===0)throw new M2DeletionClientError('UNAVAILABLE');
   return receipt;
  },
  async confirmDeletion(){throw Error('must not call');},
 });
 await flow.requestFirst();
 await flow.retry();
 assert.deepEqual(sequence,['POST1','GET','POST1']);
 assert.equal(flow.snapshot().phase,'awaiting_second_confirmation');
});

test('AI-0 regression: port/Session epoch invalidation prevents old async Session reply from repainting next member',async()=>{
 let releaseOld;
 const stale=new Promise(resolve=>{releaseOld=resolve;});
 const oldPort={
  getStatus:()=>stale,
  async requestDeletion(){throw Error('must not call');},
  async confirmDeletion(){throw Error('must not call');},
 };
 const old=createDeletionFlow(oldPort);
 const updates=[];
 old.subscribe(v=>updates.push(v.phase));
 const before=old.refresh();
 assert.equal(old.snapshot().phase,'loading');
 old.invalidate(); // React unmount / a new Auth session or port
 const now=createDeletionFlow(createDeletionPreview());
 await now.refresh();
 releaseOld({request_id:'m2del-'+'0'.repeat(48),
  status:'pending_processing',first_confirmed_at:1793000000,
  second_confirmed_at:1793000001,physical_erasure_completed:false,
  execution_authorized:false});
 await before;
 assert.equal(now.snapshot().receipt,null);
 assert.equal(now.snapshot().phase,'idle');
 assert.equal(old.snapshot().receipt,null);
 assert.deepEqual(updates,['loading']);
 await old.requestFirst();
 assert.equal(old.snapshot().phase,'idle');
});
