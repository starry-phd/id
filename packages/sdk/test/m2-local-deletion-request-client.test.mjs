import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createM2DeletionRequestClient,M2DeletionClientError,
 M2_REQUEST_PATH,M2_CONFIRM_PATH,M2_STATUS_PATH,
 M2_FIRST_CONFIRMATION,M2_SECOND_CONFIRMATION,M2_DELETION_CLIENT_LIVE,
} from '../src/m2-local-deletion-request-client.ts';

const origin='https://mobile-staging.invalid';
const bearer='v1.'+'a'.repeat(40)+'.'+'b'.repeat(43); // ONLY a test fake; never imported by App.
const id='m2del-'+'c'.repeat(48);
const awaiting={request_id:id,status:'awaiting_second_confirmation',
 first_confirmed_at:1793000000,second_confirmed_at:null,
 physical_erasure_completed:false,execution_authorized:false};
const pending={...awaiting,status:'pending_processing',second_confirmed_at:1793000002};
const response=(obj,status=200,headers={})=>new Response(JSON.stringify(obj),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',...headers},
});
function sample(opts={}){
 const calls=[];let credentials=0;
 const client=createM2DeletionRequestClient({
  enabled:true,appId:'starry-id',environment:'staging',baseUrl:origin,
  async getSessionBearer(){credentials++;return bearer;},
  async fetchImpl(url,init){
   calls.push({url,init});
   if(opts.transport)return opts.transport(url,init);
   if(url.endsWith(M2_STATUS_PATH))return response(pending);
   if(url.endsWith(M2_CONFIRM_PATH))return response(pending,202);
   return response(awaiting,202);
  },...opts.config,
 });
 return {client,calls,get credentials(){return credentials;}};
}
async function rejectCode(fn,code){
 await assert.rejects(fn,e=>e instanceof M2DeletionClientError&&e.code===code);
}
test('M2 SDK is default OFF; never obtains a bearer or sends traffic when disabled',async()=>{
 let reads=0,calls=0;
 const client=createM2DeletionRequestClient({
  appId:'starry-id',environment:'staging',baseUrl:origin,
  getSessionBearer:async()=>{reads++;return bearer;},
  fetchImpl:async()=>{calls++;return response(awaiting,202);},
 });
 assert.equal(M2_DELETION_CLIENT_LIVE,false);
 await rejectCode(()=>client.requestDeletion(),'DISABLED');
 await rejectCode(()=>client.getStatus(),'DISABLED');
 assert.equal(reads,0);assert.equal(calls,0);
 for(const baseUrl of ['http://remote.invalid','https://evil:pw@remote.invalid',
  'https://remote.invalid/sub','https://remote.invalid/?x=1']){
  assert.throws(()=>createM2DeletionRequestClient({
   baseUrl,appId:'starry-id',environment:'staging',getSessionBearer:async()=>bearer,
  }),e=>e.code==='DISABLED');
 }
});
test('M2 typed SDK sends exact three endpoints and two distinct confirmation payloads with fresh volatile bearer',async()=>{
 const x=sample();
 assert.deepEqual(await x.client.getStatus(),pending);
 assert.deepEqual(await x.client.requestDeletion(),awaiting);
 assert.deepEqual(await x.client.confirmDeletion(id),pending);
 assert.equal(x.credentials,3);
 assert.deepEqual(x.calls.map(c=>new URL(c.url).pathname),
  [M2_STATUS_PATH,M2_REQUEST_PATH,M2_CONFIRM_PATH]);
 assert.deepEqual(x.calls.map(c=>c.init.method),['GET','POST','POST']);
 assert.equal(x.calls[0].init.body,undefined);
 assert.deepEqual(JSON.parse(x.calls[1].init.body),{confirmation:M2_FIRST_CONFIRMATION});
 assert.deepEqual(JSON.parse(x.calls[2].init.body),
  {confirmation:M2_SECOND_CONFIRMATION,request_id:id});
 for(const c of x.calls){
  assert.equal(c.init.credentials,'omit');
  assert.equal(c.init.redirect,'error');
  assert.equal(c.init.cache,'no-store');
  assert.equal(c.init.headers.authorization,'Bearer '+bearer);
 }
});
test('M2 SDK status 404 means no request; second-step 404 and malformed ID never create a new request',async()=>{
 const x=sample({transport:async()=>response({error:{code:'NO_REQUEST'}},404)});
 assert.equal(await x.client.getStatus(),null);
 await rejectCode(()=>x.client.confirmDeletion(id),'NO_REQUEST');
 assert.equal(x.calls.length,2);
 await rejectCode(()=>x.client.confirmDeletion('invalid'),'NO_REQUEST');
 assert.equal(x.calls.length,2);
});
test('M2 SDK sanitizes 401/503 and provider/network/credential errors; preserves retryable type',async()=>{
 for(const status of [401,403,503]){
  const x=sample({transport:async()=>response({sql:'PRIVATE_KEY'},status)});
  await rejectCode(()=>x.client.requestDeletion(),status===503?'UNAVAILABLE':'UNAUTHORIZED');
 }
 const broken=sample({transport:async()=>{throw Error('PRIVATE_SQL_KEY');}});
 await rejectCode(()=>broken.client.getStatus(),'UNAVAILABLE');
 const noSession=sample({config:{getSessionBearer:async()=>{throw Error('PRIVATE_TOKEN');}}});
 await rejectCode(()=>noSession.client.requestDeletion(),'SESSION_REQUIRED');
});
test('M2 SDK never trusts physical erasure true, extra fields, invalid status/id/timestamps or wrong HTTP status',async()=>{
 for(const bad of [
  {...pending,physical_erasure_completed:true},
  {...pending,execution_authorized:true},
  {...pending,email:'private@example.invalid'},
  {...pending,request_id:'private-id'},
  {...pending,status:'completed'},
  {...pending,first_confirmed_at:NaN},
  {...pending,second_confirmed_at:null},
  {...awaiting,second_confirmed_at:1793000000},
 ]){
  const x=sample({transport:async()=>response(bad,202)});
  await rejectCode(()=>x.client.requestDeletion(),'INVALID_RESPONSE');
 }
 const wrong=sample({transport:async()=>response(awaiting,200)});
 await rejectCode(()=>wrong.client.requestDeletion(),'UNAVAILABLE');
});
test('M2 SDK fails closed on cacheable, HTML and oversized bodies, spoofed final URI and redirect',async()=>{
 const malformed=[
  response(pending,200,{'cache-control':'public, max-age=60'}),
  response(pending,200,{'content-type':'text/html'}),
  response(pending,200,{'content-length':'5000'}),
 ];
 for(const reply of malformed){
  const x=sample({transport:async()=>reply});
  await rejectCode(()=>x.client.getStatus(),'INVALID_RESPONSE');
 }
 const spoofs=sample({transport:async()=>{
  const r=response(pending);
  Object.defineProperty(r,'url',{value:'https://foreign.invalid/private'});
  return r;
 }});
 await rejectCode(()=>spoofs.client.getStatus(),'INVALID_RESPONSE');
 let cancelled=false;
 const bytes=new ReadableStream({
  start(c){c.enqueue(new Uint8Array(4097));},
  cancel(){cancelled=true;},
 });
 const tooLarge=sample({transport:async()=>new Response(bytes,{status:200,headers:{
  'content-type':'application/json','cache-control':'no-store',
 }})});
 await rejectCode(()=>tooLarge.client.getStatus(),'INVALID_RESPONSE');
 assert.equal(cancelled,true);
});
test('M2 SDK refuses a second-step mismatched response ID instead of hiding identity switching',async()=>{
 const x=sample({transport:async()=>response({...pending,request_id:'m2del-'+'d'.repeat(48)},202)});
 await rejectCode(()=>x.client.confirmDeletion(id),'INVALID_RESPONSE');
});
