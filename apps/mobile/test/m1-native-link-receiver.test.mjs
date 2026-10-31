import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1NativeLinkReceiver,M1_NATIVE_LINK_RECEIVER_LIVE}
 from '../src/m1-native-link-receiver.ts';
import {createM1MobileSessionAuthOwner}
 from '../src/m1-session-auth-owner.ts';

const root='https://app.starry.invalid/oauth/complete';
const api='https://staging.starry.invalid';
const url1=root+'#handoff='+'A'.repeat(43);
const url2=root+'#handoff='+'B'.repeat(43);
const later=()=>new Promise(resolve=>globalThis.setImmediate(resolve));
function fake(extra={}){
 const calls=[],statuses=[];
 let listener=null,cleared=0,removed=0;
 const linking={
  addEventListener(kind,fn){
   calls.push(['register',kind]);
   listener=fn;
   return {remove(){removed++;listener=null;}};
  },
  async getInitialURL(){calls.push(['initial']);return null;},
  ...extra.linking,
 };
 const owner={
  async acceptReturnUrl(uri){
   calls.push(['exchange',uri]);
   return {expires_at:1793000300};
  },
  clearSession(){cleared++;calls.push(['clear']);},
  ...extra.owner,
 };
 const receiver=createM1NativeLinkReceiver({
  enabled:true,appId:'starry-id',environment:'staging',
  appReturnUri:root,owner,linking,
  onStatus:state=>{statuses.push(state);},
  ...extra.config,
 });
 return {receiver,calls,statuses,linking,owner,
  emit:uri=>listener?.({url:uri}),
  subscribed:()=>listener!==null,
  clearCount:()=>cleared,removeCount:()=>removed};
}
test('receiver is source-only, disabled default performs NO listener or cold-start lookup',()=>{
 const f=fake({config:{enabled:undefined}});
 assert.equal(M1_NATIVE_LINK_RECEIVER_LIVE,false);
 assert.equal(f.receiver.live_enabled,false);
 assert.equal(f.receiver.source_only,true);
 assert.throws(()=>f.receiver.start(),/M1_NATIVE_LINK_DISABLED/);
 assert.deepEqual(f.calls,[]);
 assert.equal(f.subscribed(),false);
});
test('register BEFORE reading initial URL; exact native foreground handoff forwarded once',async()=>{
 const f=fake();
 f.receiver.start();
 await later();
 assert.deepEqual(f.calls.slice(0,2),[['register','url'],['initial']]);
 f.emit(url1);f.emit(url1);
 await later();
 assert.deepEqual(f.calls.filter(x=>x[0]==='exchange'),[['exchange',url1]]);
 assert.deepEqual(f.statuses,[{type:'authenticated',expires_at:1793000300}]);
 f.receiver.stop();
 assert.equal(f.clearCount(),1);
 assert.equal(f.removeCount(),1);
 assert.equal(f.subscribed(),false);
});
test('reject forged and cross-brand URL events without consuming codes or notifying UI',async()=>{
 const f=fake();f.receiver.start();await later();
 for(const uri of [
  'http://app.starry.invalid/oauth/complete#handoff='+'A'.repeat(43),
  'https://evil.invalid/oauth/complete#handoff='+'A'.repeat(43),
  'https://app.starry.invalid.evil.invalid/oauth/complete#handoff='+'A'.repeat(43),
  root+'?secret=PRIVATE#handoff='+'A'.repeat(43),
  root+'#access_token=PRIVATE',root+'#handoff=short',
  root+'#handoff='+'A'.repeat(43)+'&other=value',
  root+'#error=oauth_failed',root,
 ]){
  f.emit(uri);
 }
 f.emit(null);f.emit({url:url1});
 await later();
 assert.equal(f.calls.filter(x=>x[0]==='exchange').length,0);
 assert.deepEqual(f.statuses,[]);
 f.receiver.stop();
});
test('cold-start getInitialURL and foreground events use ONE owner with no duplicate exchange',async()=>{
 const f=fake({linking:{async getInitialURL(){
  f.calls.push(['initial']);return url1;
 }}});
 f.receiver.start();await later();
 assert.deepEqual(f.calls.filter(x=>x[0]==='exchange'),[['exchange',url1]]);
 f.emit(url1);await later();
 assert.equal(f.calls.filter(x=>x[0]==='exchange').length,1);
 f.receiver.stop();
});
test('cold-start initial URL resolving LATE never overrides newer valid foreground return',async()=>{
 let resolveInitial;
 const wait=new Promise(resolve=>{resolveInitial=resolve;});
 const f=fake({linking:{getInitialURL(){f.calls.push(['initial']);return wait;}}});
 f.receiver.start();await later();
 f.emit(url2);
 resolveInitial(url1);
 await later();
 assert.deepEqual(f.calls.filter(x=>x[0]==='exchange'),[['exchange',url2]]);
 assert.deepEqual(f.statuses,[{type:'authenticated',expires_at:1793000300}]);
 f.receiver.stop();
});
test('late old successful HTTP result after newer returned link cannot notify old user',async()=>{
 const pend=[];
 const f=fake({owner:{acceptReturnUrl(uri){
  f.calls.push(['exchange',uri]);
  return new Promise(resolve=>pend.push(resolve));
 }}});
 f.receiver.start();await later();
 f.emit(url1);f.emit(url2);
 pend[1]({expires_at:1793000300});
 await later();
 pend[0]({expires_at:1793000200});
 await later();
 assert.deepEqual(f.statuses,[{type:'authenticated',expires_at:1793000300}]);
 f.receiver.stop();
});
test('disposal clears actual Auth owner and fences delayed callback, cleans listener once',async()=>{
 const pending=[];
 const f=fake({owner:{acceptReturnUrl(uri){
  f.calls.push(['exchange',uri]);
  return new Promise(resolve=>pending.push(resolve));
 }}});
 f.receiver.start();await later();
 f.emit(url1);
 f.receiver.stop();
 f.receiver.stop();
 pending[0]({expires_at:1793000300});
 await later();
 assert.deepEqual(f.statuses,[]);
 assert.equal(f.clearCount(),1);
 assert.equal(f.removeCount(),1);
 f.emit(url2);
 assert.equal(f.calls.filter(x=>x[0]==='exchange').length,1);
});
test('restart after stop uses a fresh listener and does not replay previous cached code',async()=>{
 const f=fake();f.receiver.start();await later();
 f.emit(url1);await later();f.receiver.stop();
 f.receiver.start();await later();
 f.emit(url1);await later();f.receiver.stop();
 assert.equal(f.calls.filter(x=>x[0]==='exchange').length,2);
 assert.equal(f.clearCount(),2);
 assert.equal(f.removeCount(),2);
});
test('registration exceptions fail closed; no Auth credentials are issued',async()=>{
 const f=fake({linking:{addEventListener(){throw Error('PRIVATE_NATIVE_URL');}}});
 assert.throws(()=>f.receiver.start(),error=>{
  assert.equal(error.message,'M1_NATIVE_LINK_REGISTER_DENIED');return true;
 });
 assert.equal(f.clearCount(),0);
 const malformed=fake({linking:{addEventListener(){return {}}}});
 assert.throws(()=>malformed.receiver.start(),/M1_NATIVE_LINK_REGISTER_DENIED/);
 assert.equal(malformed.subscribed(),false);
});
test('broken cold-start reader and onStatus exceptions do not leak URL or crash session',async()=>{
 const f=fake({linking:{async getInitialURL(){throw Error('PRIVATE_LINK');}},
  config:{onStatus(){throw Error('PRIVATE_UI_ERROR');}}});
 f.receiver.start();await later();f.emit(url1);await later();
 assert.equal(f.calls.filter(x=>x[0]==='exchange').length,1);
 f.receiver.stop();
});
test('hard reject wrong brand, env, non-HTTPS callback and incomplete native links',()=>{
 const wrong=[
  {appId:'echo'},
  {environment:'production'},
  {appReturnUri:'starry://callback'},
  {appReturnUri:'http://app.starry.invalid/oauth/complete'},
  {appReturnUri:root+'?token=x'},
  {appReturnUri:root+'#handoff=PRIVATE'},
  {appReturnUri:'https://user:pass@app.starry.invalid/oauth/complete'},
  {owner:{acceptReturnUrl(){},clearSession:null}},
  {linking:{addEventListener:()=>({remove(){}}),getInitialURL:null}},
  {enabled:'yes'},
 ];
 for(const one of wrong)
  assert.throws(()=>fake({config:one}),/M1_NATIVE_LINK_CONFIG_DENIED/);
});
test('original volatile Auth owner is the ONLY bearer owner; native receiver never sees or returns bearer',async()=>{
 const bearer='v1.'+'x'.repeat(40)+'.'+'y'.repeat(43);
 let requests=0;
 const owner=createM1MobileSessionAuthOwner({
  enabled:true,appId:'starry-id',environment:'staging',
  baseUrl:api,appReturnUri:root,now:()=>1793000000,
  fetchImpl:async()=>{
   requests++;
   return new Response(JSON.stringify({access_token:bearer,
    token_type:'Bearer',expires_at:1793000300}),{
    status:200,headers:{'content-type':'application/json',
     'cache-control':'no-store'},
   });
  },
 });
 const statuses=[];
 let handler;
 const receiver=createM1NativeLinkReceiver({
  enabled:true,appId:'starry-id',environment:'staging',
  appReturnUri:root,owner,
  linking:{
   addEventListener(_type,fn){handler=fn;return {remove(){handler=null;}};},
   async getInitialURL(){return null;},
  },
  onStatus:status=>statuses.push(status),
 });
 receiver.start();await later();
 handler({url:url1});await later();
 assert.deepEqual(statuses,[{type:'authenticated',expires_at:1793000300}]);
 assert.equal(await owner.getSessionBearer(),bearer);
 assert.equal(requests,1);
 receiver.stop();
 assert.equal(await owner.getSessionBearer(),null);
 assert.equal('bearer' in statuses[0],false);
});
