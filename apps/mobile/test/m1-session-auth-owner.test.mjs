import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createM1MobileSessionAuthOwner,M1_MOBILE_SESSION_AUTH_OWNER_LIVE,
} from '../src/m1-session-auth-owner.ts';
const origin='https://staging.starry.invalid';
const appReturn='https://app.starry.invalid/oauth/complete';
const code='A'.repeat(43);
const bearer='v1.'+'x'.repeat(40)+'.'+'y'.repeat(43);
const now=1793000000;
const self={s_user_id:'su-mobile',display_name:'Mobile Test',
 directory_opt_in:false,display_name_public:false,profile_revision:1};
const make=(extra={})=>{
 const calls=[];
 const owner=createM1MobileSessionAuthOwner({
  enabled:true,appId:'starry-id',environment:'staging',
  baseUrl:origin,appReturnUri:appReturn,now:()=>now,
  fetchImpl:async(url,init)=>{
   const path=new globalThis.URL(url).pathname;calls.push({path,init});
   if(path==='/v1/starry-id/sessions/exchange')
    return new Response(JSON.stringify({access_token:bearer,
     token_type:'Bearer',expires_at:now+300}),{status:200,headers:{
      'content-type':'application/json','cache-control':'no-store',
     }});
   if(path==='/v1/starry-id/members/me'&&init.method==='GET')
    return new Response(JSON.stringify(self),{status:200,headers:{
     'content-type':'application/json','cache-control':'no-store',
    }});
   if(path==='/v1/starry-id/sessions/logout')
    return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
   throw Error('UNEXPECTED_MOBILE_REQUEST');
  },...extra,
 });
 return {owner,calls};
};
test('mobile Auth owner is source-only and keeps all ports disabled by default',async()=>{
 let calls=0;
 const owner=createM1MobileSessionAuthOwner({
  appId:'starry-id',environment:'staging',baseUrl:origin,appReturnUri:appReturn,
  fetchImpl:async()=>{calls++;throw Error('NETWORK');},
 });
 assert.equal(M1_MOBILE_SESSION_AUTH_OWNER_LIVE,false);
 assert.equal(owner.live_enabled,false);
 assert.equal(owner.source_only,true);
 await assert.rejects(owner.acceptReturnUrl(appReturn+'#handoff='+code),/M1_HANDOFF_DISABLED/);
 await assert.rejects(owner.profile.getSelf(),/STARRY_SELF_DISABLED/);
 assert.equal(await owner.getSessionBearer(),null);
 assert.equal(calls,0);
});
test('one Auth owner exchanges Universal Link once, supplies profile bearer and clears it after logout',async()=>{
 const {owner,calls}=make();
 const accepted=await owner.acceptReturnUrl(appReturn+'#handoff='+code);
 assert.deepEqual(accepted,{expires_at:now+300});
 assert.equal(await owner.getSessionBearer(),bearer);
 assert.deepEqual(await owner.profile.getSelf(),self);
 await owner.profile.logout();
 assert.equal(await owner.getSessionBearer(),null);
 assert.equal(owner.sessionExpiresAt(),null);
 assert.deepEqual(calls.map(x=>x.path),[
  '/v1/starry-id/sessions/exchange',
  '/v1/starry-id/members/me',
  '/v1/starry-id/sessions/logout',
 ]);
 assert.ok(calls.every(x=>x.init.credentials==='omit'&&x.init.redirect==='error'&&x.init.cache==='no-store'));
 assert.ok(calls.every(x=>x.init.headers.authorization===undefined||
  x.init.headers.authorization==='Bearer '+bearer));
 assert.deepEqual(JSON.parse(calls[0].init.body),{handoff_code:code});
 assert.equal(calls[1].init.headers.authorization,'Bearer '+bearer);
 assert.equal(calls[2].init.headers.authorization,'Bearer '+bearer);
});
test('mobile Auth owner rejects wrong app scope before creating member ports',()=>{
 assert.throws(()=>createM1MobileSessionAuthOwner({
  appId:'hglobal-id',environment:'staging',baseUrl:origin,appReturnUri:appReturn,
 }),/M1_MOBILE_AUTH_OWNER_SCOPE_DENIED/);
});

test('mobile browser login shares original volatile Auth owner and profile without leaking bearer to screen',async()=>{
 const {owner,calls}=make({openLoginBrowser:async(start,callback)=>{
  assert.equal(start,origin+'/v1/starry-id/oauth/google/start');
  assert.equal(callback,appReturn);
  return {type:'success',url:appReturn+'#handoff='+code};
 }});
 assert.deepEqual(await owner.startGoogleLogin(),{status:'authenticated',expires_at:now+300});
 assert.equal(await owner.getSessionBearer(),bearer);
 assert.deepEqual(await owner.profile.getSelf(),self);
 await owner.profile.logout();
 assert.equal(await owner.getSessionBearer(),null);
 assert.deepEqual(calls.map(x=>x.path),[
  '/v1/starry-id/sessions/exchange','/v1/starry-id/members/me',
  '/v1/starry-id/sessions/logout',
 ]);
});
test('server-confirmed logout invalidates a pending browser return for the SAME Auth owner',async()=>{
 const pending=[];
 const {owner}=make({openLoginBrowser:async()=>new Promise(resolve=>pending.push(resolve))});
 const browser=owner.startGoogleLogin();
 await owner.acceptReturnUrl(appReturn+'#handoff='+code);
 assert.equal(await owner.getSessionBearer(),bearer);
 await owner.profile.logout();
 assert.equal(await owner.getSessionBearer(),null);
 pending[0]({type:'success',url:appReturn+'#handoff='+code});
 await assert.rejects(browser,/M1_LOGIN_SUPERSEDED/);
 assert.equal(await owner.getSessionBearer(),null,'late old browser must not resurrect Session');
});

test('OS-delivered newer link fences an older pending browser but malformed links do not clear current member',async()=>{
 const pending=[];
 const {owner,calls}=make({openLoginBrowser:async()=>new Promise(resolve=>pending.push(resolve))});
 const stale=owner.startGoogleLogin();
 await owner.acceptReturnUrl(appReturn+'#handoff='+code);
 assert.equal(await owner.getSessionBearer(),bearer);
 assert.throws(()=>owner.acceptReturnUrl('https://evil.invalid/oauth/complete#handoff='+code),
  /M1_HANDOFF_RETURN_URL_DENIED/);
 assert.equal(await owner.getSessionBearer(),bearer,'malformed link cannot force logout');
 pending[0]({type:'success',url:appReturn+'#handoff='+code});
 await assert.rejects(stale,/M1_LOGIN_SUPERSEDED/);
 assert.equal(await owner.getSessionBearer(),bearer);
 assert.equal(calls.filter(x=>x.path==='/v1/starry-id/sessions/exchange').length,1,
  'stale browser code may not exchange or replace newer OS-delivered Session');
});
