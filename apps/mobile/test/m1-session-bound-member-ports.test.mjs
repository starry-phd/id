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

test('M2 preflight never dispatches an A deletion if Auth switched to B after capture',async()=>{
 let reads=0;let currentBearer=signedA;const calls=[];
 const ports=make({
  enabled:true,
  getSessionBearer:async()=>{
   reads++;
   const captured=currentBearer;
   if(reads===1)currentBearer=signedB;
   return captured;
  },
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   const path=new globalThis.URL(url).pathname;
   if(path==='/v1/starry-id/members/me')
    return json(selfOf(init.headers.authorization==='Bearer '+signedA?
     memberIdA:memberIdB));
   throw Error('DELETION_WRITE_MUST_NOT_RUN');
  },
 });
 const oldAScreen=ports.deletionForUser(memberIdA);
 await rejectsM2(()=>oldAScreen.requestDeletion(),'UNAUTHORIZED');
 assert.equal(reads,2);
 assert.deepEqual(calls.map(c=>c.init.method),['GET']);
 assert.equal(calls[0].init.headers.authorization,'Bearer '+signedA);
 // Later B calls remain B-only, without any mutation to A or B.
 await rejectsM2(()=>oldAScreen.requestDeletion(),'UNAUTHORIZED');
 assert.equal(reads,3);
 assert.deepEqual(calls.map(c=>c.init.method),['GET','GET']);
 assert.equal(calls[1].init.headers.authorization,'Bearer '+signedB);
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


test('M1 profile logout clears Auth-owned volatile memory only after server 204 succeeds',async()=>{
 let cleared=0,reads=0;
 const ports=make({
  enabled:true,
  getSessionBearer:async()=>{reads++;return signedA;},
  clearSession:()=>{cleared++;},
  fetchImpl:async(url,init)=>{
   assert.equal(new globalThis.URL(url).pathname,'/v1/starry-id/sessions/logout');
   assert.equal(init.method,'POST');
   assert.equal(init.credentials,'omit');
   return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
  },
 });
 await ports.profile.logout();
 assert.equal(reads,2,'A is captured before logout and checked again only after 204');
 assert.equal(cleared,1);
});


test('late A logout 204 must NOT erase a newly signed-in B Session',async()=>{
 let current=signedA;
 let cleared=0,reads=0,finish;
 let requestStarted;
 const entered=new Promise(resolve=>{requestStarted=resolve;});
 const requests=[];
 const ports=make({
  enabled:true,
  getSessionBearer:async()=>{reads++;return current;},
  clearSession:()=>{cleared++;current=null;},
  fetchImpl:async(url,init)=>{
   requests.push({url,init});
   requestStarted();
   return new Promise(resolve=>{finish=resolve;});
  },
 });
 const previousLogout=ports.profile.logout();
 await entered;
 assert.equal(requests.length,1);
 assert.equal(new globalThis.URL(requests[0].url).pathname,
  '/v1/starry-id/sessions/logout');
 assert.equal(requests[0].init.method,'POST');
 assert.equal(requests[0].init.headers.authorization,'Bearer '+signedA);
 // User B completed a new login during A's server-side Session revoke.
 current=signedB;
 finish(new Response(null,{status:204,headers:{'cache-control':'no-store'}}));
 await assert.rejects(previousLogout,/STARRY_SELF_IDENTITY_CHANGED/,
  'A revoke completed but B screen must not be told it was logged out');
 assert.equal(reads,2);
 assert.equal(cleared,0,'A cannot clear B after a delayed successful logout');
 assert.equal(current,signedB);
 assert.equal(requests.length,1,'A logout may not retry under B');
});

test('owner switch between selecting logout credential and HTTP still revokes only A',async()=>{
 let current=signedA,reads=0,cleared=0;
 const requests=[];
 const ports=make({
  enabled:true,
  getSessionBearer:async()=>{
   reads++;
   const selected=current;
   if(reads===1)current=signedB;
   return selected;
  },
  clearSession:()=>{cleared++;current=null;},
  fetchImpl:async(url,init)=>{
   requests.push({url,init});
   return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
  },
 });
 await assert.rejects(ports.profile.logout(),/STARRY_SELF_IDENTITY_CHANGED/);
 assert.equal(reads,2);
 assert.equal(cleared,0);
 assert.equal(current,signedB);
 assert.equal(requests.length,1);
 assert.equal(requests[0].init.headers.authorization,'Bearer '+signedA,
  'the revocation target remains the original Auth owner, not the new B');
});

test('logout rejects missing or throwing Auth owner before any HTTP or clear',async()=>{
 for(const invalid of [null,'throw']){
  let writes=0,cleared=0;
  const ports=make({
   enabled:true,
   getSessionBearer:async()=>{
    if(invalid==='throw')throw Error('PRIVATE_AUTH');
    return null;
   },
   fetchImpl:async()=>{writes++;throw Error('PRIVATE_NETWORK');},
   clearSession:()=>{cleared++;},
  });
  await assert.rejects(ports.profile.logout(),/STARRY_SELF_SESSION_REQUIRED/);
  assert.equal(writes,0);
  assert.equal(cleared,0);
 }
});

test('M1 profile logout preserves volatile memory when server revocation did not succeed',async()=>{
 let cleared=0;
 const ports=make({
  enabled:true,getSessionBearer:async()=>signedA,
  clearSession:()=>{cleared++;},
  fetchImpl:async()=>new Response('unavailable',{status:503}),
 });
 await assert.rejects(ports.profile.logout(),/STARRY_SELF_UNAVAILABLE/);
 assert.equal(cleared,0);
});


test('A logout 204 after native unmount reports session loss and cannot clear an empty owner',async()=>{
 let current=signedA,cleared=0,finish;
 let started;
 const entered=new Promise(resolve=>{started=resolve;});
 const calls=[];
 const ports=make({
  enabled:true,
  getSessionBearer:async()=>current,
  clearSession:()=>{cleared++;current=null;},
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   started();
   return new Promise(resolve=>{finish=resolve;});
  },
 });
 const stale=ports.profile.logout();
 await entered;
 current=null; // The sole volatile Auth owner was disposed while A revoked.
 finish(new Response(null,{status:204,headers:{'cache-control':'no-store'}}));
 await assert.rejects(stale,/STARRY_SELF_SESSION_REQUIRED/);
 assert.equal(cleared,0);
 assert.equal(calls.length,1);
 assert.equal(calls[0].init.headers.authorization,'Bearer '+signedA);
});


test('M2 stale A preflight response cannot dispatch any first/second confirmation or status under B',async()=>{
 for(const action of ['request','confirm','status']){
  let current=signedA,finishGet,trigger;
  const reached=new Promise(resolve=>{trigger=resolve;});
  const calls=[];
  const port=make({
   enabled:true,getSessionBearer:async()=>current,
   fetchImpl:async(url,init)=>{
    calls.push({path:new globalThis.URL(url).pathname,init});
    if(init.method==='GET'&&new globalThis.URL(url).pathname==='/v1/starry-id/members/me'){
     trigger();
     return new Promise(resolve=>{finishGet=resolve;});
    }
    throw Error('M2_MUST_NOT_DISPATCH_ANY_REQUEST_AFTER_OWNER_CHANGED');
   },
  }).deletionForUser(memberIdA);
  const pending=action==='request'?port.requestDeletion():
   action==='confirm'?port.confirmDeletion(requestId):port.getStatus();
  await reached;
  current=signedB;
  // Same signed A preflight member data can still be valid, but the
  // CURRENT owner is B by the time it comes back.
  finishGet(json(selfOf(memberIdA)));
  await rejectsM2(()=>pending,'UNAUTHORIZED');
  assert.equal(calls.length,1,action+' must dispatch only original A GET');
  assert.equal(calls[0].init.headers.authorization,'Bearer '+signedA);
 }
});

test('M2 checks current Auth at transport dispatch, even if it changed just after preflight gate',async()=>{
 let current=signedA,reads=0,transmitted=0;
 const port=make({
  enabled:true,
  getSessionBearer:async()=>{
   reads++;
   const captured=current;
   if(reads===2)globalThis.queueMicrotask(()=>{current=signedB;});
   return captured;
  },
  fetchImpl:async(url)=>{
   if(new globalThis.URL(url).pathname==='/v1/starry-id/members/me')
    return json(selfOf(memberIdA));
   transmitted++;
   throw Error('PRIVATE_SECOND_CONFIRMATION_NOT_ALLOWED');
  },
 }).deletionForUser(memberIdA);
 await rejectsM2(()=>port.confirmDeletion(requestId),'UNAUTHORIZED');
 assert.ok(reads>=3,'Auth is checked again before real mutation dispatch');
 assert.equal(transmitted,0);
});

test('M2 valid A request preserves ONE original signed Session across GET and POST',async()=>{
 let reads=0;
 const sent=[];
 const port=make({
  enabled:true,getSessionBearer:async()=>{reads++;return signedA;},
  fetchImpl:async(url,init)=>{
   sent.push({path:new globalThis.URL(url).pathname,init});
   if(init.method==='GET')return json(selfOf(memberIdA));
   return json(receipt,202);
  },
 }).deletionForUser(memberIdA);
 assert.deepEqual(await port.requestDeletion(),receipt);
 assert.deepEqual(sent.map(x=>x.init.method),['GET','POST']);
 assert.equal(sent[0].init.headers.authorization,'Bearer '+signedA);
 assert.equal(sent[1].init.headers.authorization,'Bearer '+signedA);
 assert.equal(sent[1].path,'/v1/starry-id/members/me/deletion-requests');
 assert.ok(reads>=4,'capture, after-preflight, dispatch, completion checks');
 assert.ok(sent.every(x=>x.init.cache==='no-store'&&
  x.init.redirect==='error'&&x.init.credentials==='omit'));
});

test('M2 already-dispatched A request cannot undo A server effect, but B never receives its late receipt',async()=>{
 let current=signedA,finishPost,reach;
 const pendingPost=new Promise(resolve=>{reach=resolve;});
 let posts=0;
 const port=make({
  enabled:true,getSessionBearer:async()=>current,
  fetchImpl:async(url,init)=>{
   if(init.method==='GET')return json(selfOf(memberIdA));
   posts++;
   assert.equal(init.headers.authorization,'Bearer '+signedA);
   reach();
   return new Promise(resolve=>{finishPost=resolve;});
  },
 }).deletionForUser(memberIdA);
 const pending=port.requestDeletion();
 await pendingPost;
 // A POST has already reached the server; we must not pretend it was
 // cancelled. We can, however, prevent B from seeing A's receipt.
 current=signedB;
 finishPost(json(receipt,202));
 await rejectsM2(()=>pending,'UNAUTHORIZED');
 assert.equal(posts,1);
});

test('M2 Auth loss during preflight refuses to dispatch, even for the same member',async()=>{
 for(const failure of ['missing','error']){
  let reads=0,writes=0;
  const port=make({
   enabled:true,
   getSessionBearer:async()=>{
    reads++;
    if(reads===1)return signedA;
    if(failure==='error')throw Error('PRIVATE_AUTH');
    return null;
   },
   fetchImpl:async(url)=>{
    if(new globalThis.URL(url).pathname==='/v1/starry-id/members/me')
     return json(selfOf(memberIdA));
    writes++;
    throw Error('SHOULD_NOT_MUTATE');
   },
  }).deletionForUser(memberIdA);
  await rejectsM2(()=>port.requestDeletion(),'SESSION_REQUIRED');
  assert.equal(writes,0);
  assert.equal(reads,2);
 }
});
