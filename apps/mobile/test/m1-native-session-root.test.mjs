import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1NativeSessionRoot,M1_NATIVE_SESSION_ROOT_LIVE}
 from '../src/m1-native-session-root.ts';

const api='https://staging.starry.invalid';
const app='https://app.starry.invalid/oauth/complete';
const url=app+'#handoff='+'A'.repeat(43);
const bearer='v1.'+'m'.repeat(40)+'.'+'n'.repeat(43);
const now=1793000000;
const profile={s_user_id:'su-native-test',display_name:'M1 Native Test',
 directory_opt_in:false,display_name_public:false,profile_revision:1};
const settled=()=>new Promise(resolve=>globalThis.setImmediate(resolve));

function harness(overrides={}){
 const calls=[];
 let listener=null;
 let appStateListener=null;
 const appState={
  addEventListener(kind,callback){
   assert.equal(kind,'change');
   appStateListener=callback;
   return {remove(){appStateListener=null;}};
  },
  ...overrides.appState,
 };
 const links={
  addEventListener(kind,callback){
   calls.push(['subscribe',kind]);
   listener=callback;
   return {remove(){calls.push(['unsubscribe']);listener=null;}};
  },
  async getInitialURL(){calls.push(['initial']);return null;},
  ...overrides.links,
 };
 const browser=overrides.browser??(async()=>({type:'cancel'}));
 const ownerFetch=async(raw,init)=>{
  const pathname=new globalThis.URL(raw).pathname;
  calls.push(['http',pathname,init.method]);
  if(pathname==='/v1/starry-id/sessions/exchange')
   return new Response(JSON.stringify({
    access_token:bearer,token_type:'Bearer',expires_at:now+300,
   }),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  if(pathname==='/v1/starry-id/members/me'&&init.method==='GET')
   return new Response(JSON.stringify(profile),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  if(pathname==='/v1/starry-id/sessions/logout')
   return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
  throw Error('UNEXPECTED_TEST_NETWORK');
 };
 const notices=[];
 const config={
  enabled:true,appId:'starry-id',environment:'staging',
  baseUrl:api,appReturnUri:app,now:()=>now,
  linking:links,appState,openLoginBrowser:browser,fetchImpl:ownerFetch,
  onStatus:status=>notices.push(status),
  ...overrides.config,
 };
 const root=createM1NativeSessionRoot(config);
 return {root,calls,notices,emit:uri=>listener?.({url:uri}),
  emitAppState:state=>appStateListener?.(state),
  appStateSubscribed:()=>appStateListener!==null,
  subscribed:()=>listener!==null};
}

test('single native root is source-only and default-disabled with no URL listener or network',async()=>{
 const h=harness({config:{enabled:undefined,openLoginBrowser:undefined}});
 assert.equal(M1_NATIVE_SESSION_ROOT_LIVE,false);
 assert.equal(h.root.source_only,true);
 assert.equal(h.root.live_enabled,false);
 assert.equal('owner' in h.root,false);
 assert.equal('getSessionBearer' in h.root,false);
 assert.throws(()=>h.root.start(),/M1_NATIVE_ROOT_DISABLED/);
 await assert.rejects(h.root.startGoogleLogin(),/M1_NATIVE_ROOT_INACTIVE/);
 await assert.rejects(h.root.profile.getSelf(),/STARRY_SELF_DISABLED/);
 assert.equal(h.subscribed(),false);
 assert.equal(h.appStateSubscribed(),false);
 assert.deepEqual(h.calls,[]);
 h.root.stop();
 h.root.stop();
 assert.equal(h.root.sessionExpiresAt(),null);
});

test('native root receives OS link once, shows self, logs out, and disposes ONE Auth owner',async()=>{
 const h=harness();
 h.root.start();
 assert.throws(()=>h.root.start(),/M1_NATIVE_ROOT_ALREADY_STARTED/);
 await settled();
 assert.deepEqual(h.calls.filter(c=>c[0]==='subscribe'),[['subscribe','url']]);
 h.emit(url);h.emit(url);
 await settled();
 assert.deepEqual(h.notices,[{type:'authenticated',expires_at:now+300}]);
 assert.equal(h.root.sessionExpiresAt(),now+300);
 assert.deepEqual(await h.root.profile.getSelf(),profile);
 assert.equal(typeof h.root.deletionForUser(profile.s_user_id).getStatus,'function');
 assert.deepEqual(h.calls.filter(c=>c[0]==='http').map(c=>c.slice(1)),[
  ['/v1/starry-id/sessions/exchange','POST'],
  ['/v1/starry-id/members/me','GET'],
 ]);
 await h.root.profile.logout();
 assert.equal(h.root.sessionExpiresAt(),null);
 h.root.stop();h.root.stop();
 assert.equal(h.subscribed(),false);
 assert.equal(h.appStateSubscribed(),false);
 assert.equal(h.calls.filter(c=>c[0]==='unsubscribe').length,1);
 assert.throws(()=>h.root.start(),/M1_NATIVE_ROOT_ALREADY_STARTED/);
 assert.throws(()=>h.root.deletionForUser(profile.s_user_id),/M1_NATIVE_ROOT_INACTIVE/);
 await assert.rejects(h.root.startGoogleLogin(),/M1_NATIVE_ROOT_INACTIVE/);
 await assert.rejects(h.root.profile.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 h.emit(url);await settled();
 assert.equal(h.calls.filter(c=>c[0]==='http'&&c[1]==='/v1/starry-id/sessions/exchange').length,1);
});

test('newer signed OS handoff fences pending browser, and unmount rejects late browser returns',async()=>{
 const pending=[];
 const h=harness({browser:async()=>new Promise(resolve=>pending.push(resolve))});
 h.root.start();await settled();
 const old=h.root.startGoogleLogin();
 assert.equal(pending.length,1);
 h.emit(url);await settled();
 assert.equal(h.root.sessionExpiresAt(),now+300);
 pending[0]({type:'success',url});
 await assert.rejects(old,/M1_LOGIN_SUPERSEDED/);
 assert.equal(h.root.sessionExpiresAt(),now+300);
 assert.equal(h.calls.filter(c=>c[0]==='http'&&c[1]==='/v1/starry-id/sessions/exchange').length,1);
 h.root.stop();
 assert.equal(h.root.sessionExpiresAt(),null);
 await assert.rejects(h.root.profile.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
});

test('native root rejects foreign app/env, incomplete platform and non-HTTPS callback',()=>{
 const changes=[
  {appId:'echo'},{environment:'production'},{openLoginBrowser:undefined},
  {linking:undefined},{appState:undefined},
  {appState:{addEventListener:null}},
  {appReturnUri:'starry://callback'},
  {baseUrl:'http://staging.starry.invalid'},
 ];
 for(const change of changes)
  assert.throws(()=>harness({config:change}),
   /M1_NATIVE_ROOT_CONFIG_DENIED|M1_NATIVE_LINK_CONFIG_DENIED|M1_HANDOFF_CONFIG_DENIED|M1_MEMBER_PORTS_ORIGIN_DENIED|M1_LOGIN_CONFIG_DENIED/);
});

test('native listener setup failure clears volatile owner and does not create a session',()=>{
 const h=harness({links:{addEventListener(){throw Error('PRIVATE_LINK');}}});
 assert.throws(()=>h.root.start(),/M1_NATIVE_ROOT_START_FAILED/);
 assert.equal(h.root.sessionExpiresAt(),null);
 assert.equal(h.subscribed(),false);
 assert.equal(h.appStateSubscribed(),false);
 h.root.stop();
});


test('unmount fences a delayed private self GET; it cannot reappear on a disposed native root',async()=>{
 let sendPrivate;
 let requestReached;
 const reached=new Promise(resolve=>{requestReached=resolve;});
 const h=harness({config:{fetchImpl:async(raw,init)=>{
  const pathname=new globalThis.URL(raw).pathname;
  if(pathname==='/v1/starry-id/sessions/exchange')
   return new Response(JSON.stringify({access_token:bearer,token_type:'Bearer',
    expires_at:now+300}),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
    }});
  if(pathname==='/v1/starry-id/members/me'&&init.method==='GET'){
   requestReached();
   return new Promise(resolve=>{sendPrivate=resolve;});
  }
  throw Error('UNEXPECTED_PRIVATE_NETWORK');
 }}});
 h.root.start();h.emit(url);await settled();
 const pending=h.root.profile.getSelf();
 await reached;
 h.root.stop();
 sendPrivate(new Response(JSON.stringify({
  ...profile,display_name:'PRIVATE_AFTER_UNMOUNT',
 }),{status:200,headers:{
  'content-type':'application/json','cache-control':'no-store',
 }}));
 await assert.rejects(pending,/STARRY_SELF_SESSION_REQUIRED/);
 assert.equal(h.root.sessionExpiresAt(),null);
 await assert.rejects(h.root.profile.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 assert.equal('patchSelf' in h.root.profile,false,
  'public root must not expose unfenced CAS without a user id');
});

test('account A delayed GET cannot publish A after an OS handoff to B',async()=>{
 const codeB='B'.repeat(43);
 const urlB=app+'#handoff='+codeB;
 const bearerB='v1.'+'q'.repeat(40)+'.'+'r'.repeat(43);
 let sendA;
 let started;
 const entered=new Promise(resolve=>{started=resolve;});
 const requests=[];
 const h=harness({config:{fetchImpl:async(raw,init)=>{
  const pathname=new globalThis.URL(raw).pathname;
  requests.push({pathname,init});
  if(pathname==='/v1/starry-id/sessions/exchange'){
   const handoff=JSON.parse(init.body).handoff_code;
   const token=handoff===codeB?bearerB:bearer;
   return new Response(JSON.stringify({access_token:token,
    token_type:'Bearer',expires_at:now+300}),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
   }});
  }
  if(pathname==='/v1/starry-id/members/me'&&init.method==='GET'){
   if(init.headers.authorization==='Bearer '+bearer){
    started();
    return new Promise(resolve=>{sendA=resolve;});
   }
   assert.equal(init.headers.authorization,'Bearer '+bearerB);
   return new Response(JSON.stringify({...profile,s_user_id:'su-B',
    display_name:'Current B'}),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
   }});
  }
  throw Error('UNEXPECTED_ACCOUNT_NETWORK');
 }}});
 h.root.start();
 h.emit(url);await settled();
 const pendingA=h.root.profile.getSelf();await entered;
 h.emit(urlB);await settled();
 sendA(new Response(JSON.stringify({...profile,display_name:'PRIVATE_OLD_A'}),{
  status:200,headers:{'content-type':'application/json','cache-control':'no-store'},
 }));
 await assert.rejects(pendingA,/STARRY_SELF_IDENTITY_CHANGED/);
 assert.deepEqual(await h.root.profile.getSelf(),{
  ...profile,s_user_id:'su-B',display_name:'Current B',
 });
 assert.equal(requests.filter(x=>x.pathname==='/v1/starry-id/sessions/exchange').length,2);
 h.root.stop();
});

test('late CAS response after unmount cannot return or display private profile data',async()=>{
 let finishPatch;
 let requestReached;
 const reached=new Promise(resolve=>{requestReached=resolve;});
 const requests=[];
 const h=harness({config:{fetchImpl:async(raw,init)=>{
  const pathname=new globalThis.URL(raw).pathname;
  requests.push({pathname,init});
  if(pathname==='/v1/starry-id/sessions/exchange')
   return new Response(JSON.stringify({access_token:bearer,
    token_type:'Bearer',expires_at:now+300}),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
   }});
  if(pathname==='/v1/starry-id/members/me'&&init.method==='GET')
   return new Response(JSON.stringify(profile),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  if(pathname==='/v1/starry-id/members/me'&&init.method==='PATCH'){
   requestReached();
   return new Promise(resolve=>{finishPatch=resolve;});
  }
  throw Error('UNEXPECTED_PROFILE_NETWORK');
 }}});
 h.root.start();h.emit(url);await settled();
 const inFlight=h.root.profile.patchSelfForUser(profile.s_user_id,1,{
  display_name:'PRIVATE_STALE_UPDATED',
 });
 await reached;
 h.root.stop();
 finishPatch(new Response(JSON.stringify({...profile,
  display_name:'PRIVATE_STALE_UPDATED',profile_revision:2,
 }),{status:200,headers:{
  'content-type':'application/json','cache-control':'no-store',
 }}));
 await assert.rejects(inFlight,/STARRY_SELF_SESSION_REQUIRED/);
 assert.deepEqual(requests.filter(x=>x.init.method==='PATCH')
  .map(x=>x.init.headers.authorization),['Bearer '+bearer],
  'in-flight CAS may act on A, never on a newer B token');
});

test('cached deletion request port fails closed after native unmount with zero mutation calls',async()=>{
 let writes=0;
 const h=harness({config:{fetchImpl:async(raw)=>{
  const pathname=new globalThis.URL(raw).pathname;
  if(pathname==='/v1/starry-id/sessions/exchange')
   return new Response(JSON.stringify({access_token:bearer,
    token_type:'Bearer',expires_at:now+300}),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
   }});
  writes++;
  throw Error('UNEXPECTED_DELETION_NETWORK');
 }}});
 h.root.start();h.emit(url);await settled();
 const oldReceipt=h.root.deletionForUser(profile.s_user_id);
 h.root.stop();
 await assert.rejects(oldReceipt.getStatus(),/SESSION_REQUIRED/);
 await assert.rejects(oldReceipt.requestDeletion(),/SESSION_REQUIRED/);
 await assert.rejects(oldReceipt.confirmDeletion('m2del-'+'f'.repeat(48)),
  /SESSION_REQUIRED/);
 assert.equal(writes,0);
});


test('native A logout late 204 cannot show logged-out success on B screen or clear B',async()=>{
 const codeB='B'.repeat(43);
 const urlB=app+'#handoff='+codeB;
 const bearerB='v1.'+'q'.repeat(40)+'.'+'r'.repeat(43);
 let finishRevoke;
 let reached;
 const pendingRevoke=new Promise(resolve=>{reached=resolve;});
 let revocations=0;
 const h=harness({config:{fetchImpl:async(raw,init)=>{
  const path=new globalThis.URL(raw).pathname;
  if(path==='/v1/starry-id/sessions/exchange'){
   const code=JSON.parse(init.body).handoff_code;
   return new Response(JSON.stringify({access_token:code===codeB?bearerB:bearer,
    token_type:'Bearer',expires_at:now+300}),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
   }});
  }
  if(path==='/v1/starry-id/sessions/logout'){
   assert.equal(init.headers.authorization,'Bearer '+bearer);
   revocations++;
   reached();
   return new Promise(resolve=>{finishRevoke=resolve;});
  }
  if(path==='/v1/starry-id/members/me'&&init.method==='GET'){
   assert.equal(init.headers.authorization,'Bearer '+bearerB);
   return new Response(JSON.stringify({...profile,
    s_user_id:'su-native-B',display_name:'B is still logged in',
   }),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  throw Error('UNEXPECTED_NATIVE_NETWORK');
 }}});
 h.root.start();
 h.emit(url);await settled();
 const oldLogout=h.root.profile.logout();
 await pendingRevoke;
 h.emit(urlB);await settled();
 finishRevoke(new Response(null,{status:204,headers:{'cache-control':'no-store'}}));
 await assert.rejects(oldLogout,/STARRY_SELF_IDENTITY_CHANGED/,
  'A logout completion cannot tell the current B screen it was logged out');
 assert.equal(revocations,1);
 assert.equal(h.root.sessionExpiresAt(),now+300,
  'the only Auth owner must keep the newer B session');
 assert.deepEqual(await h.root.profile.getSelf(),{
  ...profile,s_user_id:'su-native-B',display_name:'B is still logged in',
 });
 h.root.stop();
});


test('cached A deletion port cannot submit as B even when both Sessions share SAME member id',async()=>{
 const codeB='B'.repeat(43);
 const urlB=app+'#handoff='+codeB;
 const bearerB='v1.'+'q'.repeat(40)+'.'+'r'.repeat(43);
 const receipt={request_id:'m2del-'+'e'.repeat(48),
  status:'awaiting_second_confirmation',first_confirmed_at:now,
  second_confirmed_at:null,physical_erasure_completed:false,
  execution_authorized:false};
 let memberReads=0,deletionPosts=0;
 const h=harness({config:{fetchImpl:async(raw,init)=>{
  const path=new globalThis.URL(raw).pathname;
  if(path==='/v1/starry-id/sessions/exchange'){
   const code=JSON.parse(init.body).handoff_code;
   return new Response(JSON.stringify({access_token:code===codeB?bearerB:bearer,
    token_type:'Bearer',expires_at:now+300}),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
   }});
  }
  if(path==='/v1/starry-id/members/me'&&init.method==='GET'){
   memberReads++;
   assert.equal(init.headers.authorization,'Bearer '+bearerB);
   return new Response(JSON.stringify(profile),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  if(path==='/v1/starry-id/members/me/deletion-requests'&&init.method==='POST'){
   deletionPosts++;
   assert.equal(init.headers.authorization,'Bearer '+bearerB);
   return new Response(JSON.stringify(receipt),{status:202,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  throw Error('WRONG_SESSION_OR_UNEXPECTED_M2_NETWORK');
 }}});
 h.root.start();h.emit(url);await settled();
 const staleA=h.root.deletionForUser(profile.s_user_id);
 assert.equal('getSessionBearer' in staleA,false);
 h.emit(urlB);await settled();
 // A and B are distinct signed Sessions for the *same* profile.
 await assert.rejects(staleA.getStatus(),/UNAUTHORIZED/);
 await assert.rejects(staleA.requestDeletion(),/UNAUTHORIZED/);
 await assert.rejects(staleA.confirmDeletion('m2del-'+'e'.repeat(48)),/UNAUTHORIZED/);
 assert.equal(memberReads,0,'old A port cannot even preflight with B bearer');
 assert.equal(deletionPosts,0,'old A screen must not trigger any B deletion');
 const freshB=h.root.deletionForUser(profile.s_user_id);
 assert.deepEqual(await freshB.requestDeletion(),receipt);
 assert.equal(memberReads,1);
 assert.equal(deletionPosts,1);
 h.root.stop();
});

test('deletion port taken before login never becomes authorized after a later login',async()=>{
 let memberRequests=0;
 const h=harness({config:{fetchImpl:async(raw)=>{
  const path=new globalThis.URL(raw).pathname;
  if(path==='/v1/starry-id/sessions/exchange')
   return new Response(JSON.stringify({access_token:bearer,
    token_type:'Bearer',expires_at:now+300}),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
   }});
  memberRequests++;
  throw Error('UNAUTHENTICATED_SCREEN_SHOULD_NEVER_CALL_M2');
 }}});
 h.root.start();
 const beforeLogin=h.root.deletionForUser(profile.s_user_id);
 h.emit(url);await settled();
 await assert.rejects(beforeLogin.requestDeletion(),/SESSION_REQUIRED/);
 assert.equal(memberRequests,0);
 h.root.stop();
});

test('native root sends token-free Auth revisions BEFORE B OS link and on settled login',async()=>{
 const codeB='B'.repeat(43);
 const urlB=app+'#handoff='+codeB;
 const bearerB='v1.'+'q'.repeat(40)+'.'+'r'.repeat(43);
 const h=harness({config:{fetchImpl:async(raw,init)=>{
  const path=new globalThis.URL(raw).pathname;
  if(path==='/v1/starry-id/sessions/exchange'){
   const code=JSON.parse(init.body).handoff_code;
   return new Response(JSON.stringify({
    access_token:code===codeB?bearerB:bearer,
    token_type:'Bearer',expires_at:now+300,
   }),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  if(path==='/v1/starry-id/members/me')
   return new Response(JSON.stringify(profile),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  throw Error('UNEXPECTED_NETWORK');
 }}});
 const revisions=[];
 const unsubscribe=h.root.subscribeSessionRevision(
  ()=>revisions.push(h.root.sessionRevision()));
 assert.equal(h.root.sessionRevision(),0);
 h.root.start();await settled();
 h.emit(url);
 assert.deepEqual(revisions,[1],'A must hide synchronously before POST');
 await settled();
 assert.deepEqual(revisions,[1,2],'settled A needs a fresh GET');
 assert.deepEqual(await h.root.profile.getSelf(),profile);
 h.emit('https://foreign.invalid/oauth/complete#handoff='+'Z'.repeat(43));
 assert.deepEqual(revisions,[1,2],'foreign URLs must not advance Auth revision');
 h.emit(urlB);
 assert.deepEqual(revisions,[1,2,3],
  'previously rendered A is invalidated BEFORE B network response');
 await settled();
 assert.deepEqual(revisions,[1,2,3,4]);
 assert.equal(h.notices.length,2);
 assert.deepEqual(Object.keys(h.notices[1]).sort(),['expires_at','type']);
 assert.equal('bearer' in h.root,false);
 assert.equal('getSessionBearer' in h.root,false);
 unsubscribe();
 h.root.stop();
 assert.deepEqual(revisions,[1,2,3,4]);
 assert.equal(h.root.sessionRevision(),5,'stopping root also retires profile');
});
test('browser start immediately retires prior profile, cancellation never restores it',async()=>{
 const pending=[];
 const h=harness({browser:()=>new Promise(resolve=>pending.push(resolve))});
 h.root.start();await settled();
 h.emit(url);await settled();
 const before=h.root.sessionRevision();
 const events=[];
 const unsubscribe=h.root.subscribeSessionRevision(
  ()=>events.push(h.root.sessionRevision()));
 const login=h.root.startGoogleLogin();
 assert.equal(h.root.sessionRevision(),before+1,
  'old signed Session may not remain on screen while browser is pending');
 assert.deepEqual(events,[before+1]);
 assert.equal(pending.length,1);
 pending[0]({type:'cancel'});
 assert.deepEqual(await login,{status:'cancelled'});
 assert.equal(h.root.sessionRevision(),before+1);
 await assert.rejects(h.root.profile.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 unsubscribe();h.root.stop();
});
test('browser-auth success advances revision again, and observers never become Auth authorities',async()=>{
 const h=harness({browser:async()=>({type:'success',url})});
 const observations=[];
 const off=h.root.subscribeSessionRevision(()=>{
  observations.push(h.root.sessionRevision());
  throw Error('UNTRUSTED_UI_CALLBACK');
 });
 h.root.start();await settled();
 const result=await h.root.startGoogleLogin();
 assert.deepEqual(result,{status:'authenticated',expires_at:now+300});
 assert.deepEqual(observations,[1,2]);
 assert.deepEqual(await h.root.profile.getSelf(),profile);
 off();h.root.stop();
});

test('the exact Auth-owned member port is the UI revision source; no separate bearer',async()=>{
 const h=harness();
 const revisionChanges=[];
 assert.equal(typeof h.root.profile.getSessionRevision,'function');
 assert.equal(typeof h.root.profile.subscribeSessionRevision,'function');
 assert.equal(h.root.profile.getSessionRevision(),0);
 const unsubscribe=h.root.profile.subscribeSessionRevision(
  ()=>revisionChanges.push(h.root.profile.getSessionRevision()));
 h.root.start();await settled();
 h.emit(url);
 assert.deepEqual(revisionChanges,[1],
  'a mounted profile screen can immediately hide A on valid OS link');
 await settled();
 assert.deepEqual(revisionChanges,[1,2]);
 assert.equal(h.root.profile.getSessionRevision(),h.root.sessionRevision());
 assert.deepEqual(await h.root.profile.getSelf(),profile);
 assert.equal('getSessionBearer' in h.root.profile,false);
 assert.equal('bearer' in h.root.profile,false);
 assert.equal('access_token' in h.root.profile,false);
 unsubscribe();h.root.stop();
 assert.equal(h.root.profile.getSessionRevision(),3);
 assert.deepEqual(revisionChanges,[1,2]);
});

test('native expiry timer invalidates mounted profile without a GET, switch or button',async()=>{
 let clock=now;
 let profileGets=0;
 const h=harness({config:{now:()=>clock,fetchImpl:async(raw)=>{
  const path=new globalThis.URL(raw).pathname;
  if(path==='/v1/starry-id/sessions/exchange')
   return new Response(JSON.stringify({
    access_token:bearer,token_type:'Bearer',expires_at:now+1,
   }),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  if(path==='/v1/starry-id/members/me'){
   profileGets++;
   return new Response(JSON.stringify(profile),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  throw Error('UNEXPECTED_EXPIRY_NETWORK');
 }}});
 const revisions=[];
 const unsubscribe=h.root.profile.subscribeSessionRevision(
  ()=>revisions.push(h.root.profile.getSessionRevision()));
 h.root.start();h.emit(url);await settled();
 assert.deepEqual(revisions,[1,2]);
 assert.deepEqual(await h.root.profile.getSelf(),profile);
 assert.equal(profileGets,1);
 // The server expiry has elapsed, but the user never pressed a button or
 // asked the SDK for a new bearer. The root's scheduled fence must wake UI.
 clock=now+2;
 await new Promise(resolve=>globalThis.setTimeout(resolve,1250));
 assert.deepEqual(revisions,[1,2,3],
  'a natural Session expiry must retire the already-rendered PII');
 assert.equal(h.root.sessionExpiresAt(),null);
 await assert.rejects(h.root.profile.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 assert.equal(profileGets,1,'expiry must not start a hidden member GET');
 unsubscribe();h.root.stop();
});
test('superseded A expiry never clears a newer B Session or emits a false B logout',async()=>{
 let clock=now;
 const codeB='B'.repeat(43);
 const urlB=app+'#handoff='+codeB;
 const bearerB='v1.'+'q'.repeat(40)+'.'+'r'.repeat(43);
 const profileB={...profile,s_user_id:'su-expiry-B',display_name:'Current B'};
 const h=harness({config:{now:()=>clock,fetchImpl:async(raw,init)=>{
  const path=new globalThis.URL(raw).pathname;
  if(path==='/v1/starry-id/sessions/exchange'){
   const code=JSON.parse(init.body).handoff_code;
   const isB=code===codeB;
   return new Response(JSON.stringify({
    access_token:isB?bearerB:bearer,
    token_type:'Bearer',expires_at:now+(isB?60:1),
   }),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  if(path==='/v1/starry-id/members/me'){
   assert.equal(init.headers.authorization,'Bearer '+bearerB);
   return new Response(JSON.stringify(profileB),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  throw Error('UNEXPECTED_SWITCH_EXPIRY_NETWORK');
 }}});
 const revisions=[];
 const off=h.root.profile.subscribeSessionRevision(
  ()=>revisions.push(h.root.profile.getSessionRevision()));
 h.root.start();h.emit(url);await settled();
 h.emit(urlB);await settled();
 assert.deepEqual(revisions,[1,2,3,4]);
 clock=now+2;
 await new Promise(resolve=>globalThis.setTimeout(resolve,1250));
 assert.deepEqual(revisions,[1,2,3,4],
  'A deadline must not act as B deadline');
 assert.equal(h.root.sessionExpiresAt(),now+60);
 assert.deepEqual(await h.root.profile.getSelf(),profileB);
 off();h.root.stop();
});

test('foreground after suspended timers invalidates naturally expired PII before another GET',async()=>{
 let clock=now;
 let profileGets=0;
 const h=harness({config:{now:()=>clock,fetchImpl:async(raw,init)=>{
  const path=new globalThis.URL(raw).pathname;
  if(path==='/v1/starry-id/sessions/exchange')
   return new Response(JSON.stringify({
    access_token:bearer,token_type:'Bearer',expires_at:now+300,
   }),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  if(path==='/v1/starry-id/members/me'&&init.method==='GET'){
   profileGets++;
   return new Response(JSON.stringify(profile),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  throw Error('UNEXPECTED_FOREGROUND_NETWORK');
 }}});
 const revisions=[];
 const off=h.root.profile.subscribeSessionRevision(
  ()=>revisions.push(h.root.profile.getSessionRevision()));
 h.root.start();
 assert.equal(h.appStateSubscribed(),true);
 h.emit(url);await settled();
 assert.deepEqual(revisions,[1,2]);
 assert.deepEqual(await h.root.profile.getSelf(),profile);
 assert.equal(profileGets,1);
 // Simulate a suspended JS runtime: only the trusted AppState resume event,
 // not the 300-second timer, is delivered after wall-clock expiry.
 clock=now+301;
 h.emitAppState('background');
 h.emitAppState('inactive');
 h.emitAppState('unknown');
 assert.deepEqual(revisions,[1,2],
  'background and transient events cannot be treated as active');
 h.emitAppState('active');
 assert.deepEqual(revisions,[1,2,3],
  'a resumed app must hide the expired loaded member synchronously');
 assert.equal(profileGets,1,'resume must never issue a hidden member GET');
 assert.equal(h.root.sessionExpiresAt(),null);
 await assert.rejects(h.root.profile.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 h.emitAppState('active');
 assert.deepEqual(revisions,[1,2,3],
  'duplicate active events must not repeatedly claim a logout');
 off();h.root.stop();
 assert.equal(h.appStateSubscribed(),false);
 h.emitAppState('active');
 assert.deepEqual(revisions,[1,2,3]);
});
test('foreground clock change cannot expire a newer B or replay the prior A timer',async()=>{
 let clock=now;
 const codeB='B'.repeat(43);
 const urlB=app+'#handoff='+codeB;
 const bearerB='v1.'+'q'.repeat(40)+'.'+'r'.repeat(43);
 let profileGets=0;
 const h=harness({config:{now:()=>clock,fetchImpl:async(raw,init)=>{
  const path=new globalThis.URL(raw).pathname;
  if(path==='/v1/starry-id/sessions/exchange'){
   const isB=JSON.parse(init.body).handoff_code===codeB;
   return new Response(JSON.stringify({
    access_token:isB?bearerB:bearer,
    token_type:'Bearer',expires_at:now+(isB?360:1),
   }),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  if(path==='/v1/starry-id/members/me'){
   profileGets++;
   assert.equal(init.headers.authorization,'Bearer '+bearerB);
   return new Response(JSON.stringify({...profile,s_user_id:'su-current-B'}),
    {status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
    }});
  }
  throw Error('UNEXPECTED_FOREGROUND_SWITCH_NETWORK');
 }}});
 const revisions=[];
 const off=h.root.profile.subscribeSessionRevision(
  ()=>revisions.push(h.root.profile.getSessionRevision()));
 h.root.start();
 h.emit(url);await settled();
 h.emit(urlB);await settled();
 assert.deepEqual(revisions,[1,2,3,4]);
 clock=now+2;
 h.emitAppState('active');
 h.emitAppState('active');
 assert.deepEqual(revisions,[1,2,3,4],
  'the old A deadline must never clear a valid B Session');
 assert.equal(h.root.sessionExpiresAt(),now+360);
 assert.deepEqual(await h.root.profile.getSelf(),
  {...profile,s_user_id:'su-current-B'});
 assert.equal(profileGets,1);
 off();h.root.stop();
 assert.equal(h.appStateSubscribed(),false);
});
test('missing or broken AppState port refuses native startup and leaves no Auth listener',()=>{
 const thrown=harness({appState:{
  addEventListener(){throw Error('PRIVATE_NATIVE_APPSTATE');},
 }});
 assert.throws(()=>thrown.root.start(),error=>{
  assert.equal(error.message,'M1_NATIVE_ROOT_START_FAILED');return true;
 });
 assert.equal(thrown.subscribed(),false);
 assert.equal(thrown.appStateSubscribed(),false);
 assert.equal(thrown.root.sessionExpiresAt(),null);
 thrown.root.stop();
 const invalid=harness({appState:{addEventListener(){return {};}}});
 assert.throws(()=>invalid.root.start(),/M1_NATIVE_ROOT_START_FAILED/);
 assert.equal(invalid.subscribed(),false);
 invalid.root.stop();
});
