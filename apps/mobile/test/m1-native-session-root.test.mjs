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
  const pathname=new URL(raw).pathname;
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
  linking:links,openLoginBrowser:browser,fetchImpl:ownerFetch,
  onStatus:status=>notices.push(status),
  ...overrides.config,
 };
 const root=createM1NativeSessionRoot(config);
 return {root,calls,notices,emit:uri=>listener?.({url:uri}),
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
  {linking:undefined},{appReturnUri:'starry://callback'},
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
 h.root.stop();
});
