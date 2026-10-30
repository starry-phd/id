import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createM1SessionBoundMemberPorts,M1_MEMBER_PORTS_LIVE_ENABLED,
} from '../src/m1-session-bound-member-ports.ts';
import {M2DeletionClientError} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';

const baseUrl='https://staging.starry.invalid';
const make=(extra={})=>createM1SessionBoundMemberPorts({
 appId:'starry-id',environment:'staging',baseUrl,
 getSessionBearer:async()=> 'a'.repeat(48),
 ...extra,
});

test('M1 source-only mobile ports are OFF without credential reads or HTTP',async()=>{
 let reads=0,network=0;
 const ports=make({
  getSessionBearer:async()=>{reads++;throw Error('PRIVATE_AUTH_OWNER');},
  fetchImpl:async()=>{network++;throw Error('PRIVATE_HTTP');},
 });
 assert.equal(ports.live_enabled,false);
 assert.equal(M1_MEMBER_PORTS_LIVE_ENABLED,false);
 assert.equal(ports.source_only,true);
 assert.equal(ports.profile.live_enabled,false);
 await assert.rejects(ports.profile.getSelf(),/STARRY_SELF_DISABLED/);
 await assert.rejects(ports.profile.patchSelf(1,{display_name:'Safe'}),/STARRY_SELF_DISABLED/);
 await assert.rejects(ports.profile.logout(),/STARRY_SELF_DISABLED/);
 await assert.rejects(ports.deletionForUser('u1').getStatus(),
  e=>e instanceof M2DeletionClientError&&e.code==='DISABLED');
 await assert.rejects(ports.deletionForUser('u1').requestDeletion(),
  e=>e instanceof M2DeletionClientError&&e.code==='DISABLED');
 assert.equal(reads,0);
 assert.equal(network,0);
});

test('M1 mobile port owner denies non-Starry or mutable origins before using credentials',()=>{
 for(const cfg of [
  {appId:'hglobal-id'}, {environment:'production'},
  {environment:'development'}, {baseUrl:'http://staging.starry.invalid'},
  {baseUrl:'https://guest:pw@staging.starry.invalid'},
  {baseUrl:baseUrl+'/v1'}, {baseUrl:baseUrl+'?session=secret'},
  {baseUrl:baseUrl+'#fragment'}, {getSessionBearer:null},
 ])assert.throws(()=>make(cfg),/M1_MEMBER_PORTS_(?:SCOPE|ORIGIN)_DENIED/);
});

test('M1 port owner pins the provided Auth callback once rather than trusting later DI mutation',async()=>{
 let original=0,forged=0;
 const config={
  enabled:true,appId:'starry-id',environment:'staging',baseUrl,
  getSessionBearer:async()=>{original++;return null;},
  fetchImpl:async()=>{forged++;throw Error('SHOULD_NOT_FETCH');},
 };
 const ports=createM1SessionBoundMemberPorts(config);
 config.getSessionBearer=async()=>{forged++;return 'a'.repeat(48);};
 await assert.rejects(ports.profile.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 await assert.rejects(ports.deletionForUser('u1').getStatus(),
  e=>e instanceof M2DeletionClientError&&e.code==='SESSION_REQUIRED');
 assert.equal(original,2);
 assert.equal(forged,0);
});

const signedA='v1.'+'a'.repeat(40)+'.'+'b'.repeat(43);
const signedB='v1.'+'c'.repeat(40)+'.'+'d'.repeat(43);
const memberIdA='starry-user-a';
const memberIdB='starry-user-b';
const requestId='m2del-'+'e'.repeat(48);
const selfOf=id=>({
 s_user_id:id,display_name:null,directory_opt_in:false,
 display_name_public:false,profile_revision:1,
});
const receipt={
 request_id:requestId,status:'awaiting_second_confirmation',
 first_confirmed_at:1793000000,second_confirmed_at:null,
 physical_erasure_completed:false,execution_authorized:false,
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json','cache-control':'private, no-store'},
});
const rejectsM2=(run,code)=>assert.rejects(run,
 e=>e instanceof M2DeletionClientError&&e.code===code);

test('M2 first confirmation refuses a stale A screen after Auth switched to B',async()=>{
 let reads=0;const calls=[];
 const ports=make({
  enabled:true,
  getSessionBearer:async()=>{reads++;return signedB;},
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   if(new globalThis.URL(url).pathname==='/v1/starry-id/members/me')
    return json(selfOf(memberIdB));
   throw Error('MUST_NOT_WRITE_DELETION_FOR_B');
  },
 });
 const aScreen=ports.deletionForUser(memberIdA);
 await rejectsM2(()=>aScreen.requestDeletion(),'UNAUTHORIZED');
 await rejectsM2(()=>aScreen.getStatus(),'UNAUTHORIZED');
 await rejectsM2(()=>aScreen.confirmDeletion(requestId),'UNAUTHORIZED');
 assert.equal(reads,3);
 assert.equal(calls.length,3);
 assert.ok(calls.every(c=>c.init.method==='GET'&&
  new globalThis.URL(c.url).pathname==='/v1/starry-id/members/me'));
 assert.ok(calls.every(c=>c.init.headers.authorization==='Bearer '+signedB));
});

test('M2 member owner preflight and mutation reuse exactly ONE volatile bearer',async()=>{
 let reads=0;let currentBearer=signedA;const calls=[];
 const ports=make({
  enabled:true,
  getSessionBearer:async()=>{
   reads++;
   const captured=currentBearer;
   currentBearer=signedB; // another account becomes active after this read
   return captured;
  },
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   const path=new globalThis.URL(url).pathname;
   if(path==='/v1/starry-id/members/me')
    return json(selfOf(init.headers.authorization==='Bearer '+signedA?
     memberIdA:memberIdB));
   if(path.endsWith('/deletion-requests'))return json(receipt,202);
   throw Error('UNEXPECTED_PATH');
  },
 });
 const safe=ports.deletionForUser(memberIdA);
 assert.deepEqual(await safe.requestDeletion(),receipt);
 assert.equal(reads,1);
 assert.deepEqual(calls.map(c=>c.init.method),['GET','POST']);
 assert.ok(calls.every(c=>c.init.headers.authorization==='Bearer '+signedA));
 assert.ok(calls.every(c=>c.init.credentials==='omit'&&
  c.init.redirect==='error'&&c.init.cache==='no-store'));
 // A is still on screen but B is now signed in: no repeat POST.
 await rejectsM2(()=>safe.requestDeletion(),'UNAUTHORIZED');
 assert.equal(reads,2);
 assert.deepEqual(calls.map(c=>c.init.method),['GET','POST','GET']);
});

test('M2 owner-fenced status/second confirmation fail closed on wrong member and bad preflight',async()=>{
 let writes=0;const calls=[];
 const ports=make({
  enabled:true,getSessionBearer:async()=>signedA,
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   if(new globalThis.URL(url).pathname==='/v1/starry-id/members/me')
    return json(selfOf(memberIdA));
   writes++;
   if(new globalThis.URL(url).pathname.endsWith('/status'))
    return json({error:{code:'NO_REQUEST'}},404);
   return json({...receipt,status:'pending_processing',
    second_confirmed_at:1793000001},202);
  },
 });
 const safe=ports.deletionForUser(memberIdA);
 assert.equal(await safe.getStatus(),null);
 const result=await safe.confirmDeletion(requestId);
 assert.equal(result.status,'pending_processing');
 assert.equal(writes,2);
 assert.deepEqual(calls.map(c=>c.init.method),['GET','GET','GET','POST']);
 assert.ok(calls.every(c=>c.init.headers.authorization==='Bearer '+signedA));
 const poison=make({
  enabled:true,getSessionBearer:async()=>signedA,
  fetchImpl:async()=>json({...selfOf(memberIdA),email:'private@example.invalid'}),
 }).deletionForUser(memberIdA);
 await rejectsM2(()=>poison.requestDeletion(),'INVALID_RESPONSE');
});

test('M2 owner fence default OFF and malformed owner never read Auth or network',async()=>{
 let reads=0,calls=0;
 const ports=make({
  getSessionBearer:async()=>{reads++;return signedA;},
  fetchImpl:async()=>{calls++;return json(selfOf(memberIdA));},
 });
 await rejectsM2(()=>ports.deletionForUser(memberIdA).requestDeletion(),'DISABLED');
 assert.throws(()=>ports.deletionForUser('a/b'),
  e=>e instanceof M2DeletionClientError&&e.code==='UNAUTHORIZED');
 assert.equal(reads,0);assert.equal(calls,0);
});
