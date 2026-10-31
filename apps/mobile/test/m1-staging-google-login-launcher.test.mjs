import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1MobileBrowserLoginLauncher,M1_MOBILE_BROWSER_LOGIN_LIVE,
 M1_MOBILE_BROWSER_LOGIN_START_PATH} from '../src/m1-staging-google-login-launcher.ts';
const origin='https://staging.starry.invalid';
const returnUri='https://app.starry.invalid/oauth/complete';
const valid=returnUri+'#handoff='+'H'.repeat(43);
function make(changes={}){
 const calls=[];
 const launcher=createM1MobileBrowserLoginLauncher({
  enabled:true,appId:'starry-id',environment:'staging',baseUrl:origin,
  appReturnUri:returnUri,
  openLoginBrowser:async(start,callback)=>{
   calls.push(['browser',start,callback]);
   return {type:'success',url:valid};
  },
  acceptReturnUrl:async url=>{
   calls.push(['accept',url]);return {expires_at:1793000300};
  },
  clearSession:()=>{calls.push(['clear']);},
  ...changes,
 });
 return {launcher,calls};
}
test('browser start is source-only and disabled without an explicit native browser adapter',async()=>{
 const {launcher,calls}=make({enabled:undefined});
 assert.equal(M1_MOBILE_BROWSER_LOGIN_LIVE,false);
 assert.equal(launcher.live_enabled,false);
 assert.equal(launcher.source_only,true);
 await assert.rejects(launcher.startGoogleLogin(),/M1_LOGIN_DISABLED/);
 assert.deepEqual(calls,[]);
 const noBrowser=make({openLoginBrowser:undefined});
 await assert.rejects(noBrowser.launcher.startGoogleLogin(),/M1_LOGIN_DISABLED/);
 assert.deepEqual(noBrowser.calls,[]);
});
test('approved browser start uses only pinned HTTPS source and returns expiry, never bearer',async()=>{
 const {launcher,calls}=make();
 const result=await launcher.startGoogleLogin();
 assert.deepEqual(result,{status:'authenticated',expires_at:1793000300});
 assert.equal(launcher.start_uri,origin+M1_MOBILE_BROWSER_LOGIN_START_PATH);
 assert.deepEqual(calls,[
  ['clear'],
  ['browser',origin+M1_MOBILE_BROWSER_LOGIN_START_PATH,returnUri],
  ['accept',valid],
 ]);
 assert.equal('access_token' in result,false);
});
test('cancel and dismiss never exchange a credential or restore previous owner',async()=>{
 for(const type of ['cancel','dismiss']){
  const {launcher,calls}=make({openLoginBrowser:async()=>({type})});
  assert.deepEqual(await launcher.startGoogleLogin(),{status:'cancelled'});
  assert.deepEqual(calls,[['clear']]);
 }
});
test('reject malicious browser redirects and provider bearer URLs before any exchange',async()=>{
 for(const raw of [
  'https://evil.invalid/oauth/complete#handoff='+'H'.repeat(43),
  returnUri+'?handoff='+'H'.repeat(43),
  returnUri+'#access_token=PRIVATE_BEARER',
  returnUri+'#handoff='+'H'.repeat(43)+'&handoff='+'X'.repeat(43),
  returnUri+'#handoff=short',returnUri,
 ]){
  let accepts=0;
  const {launcher}=make({
   openLoginBrowser:async()=>({type:'success',url:raw}),
   acceptReturnUrl:async()=>{accepts++;return {expires_at:1793000300};},
  });
  await assert.rejects(launcher.startGoogleLogin(),/M1_LOGIN_RETURN_DENIED/);
  assert.equal(accepts,0);
 }
});
test('malformed/browser exceptions and exchange errors are sanitized',async()=>{
 const badBrowser=make({openLoginBrowser:async()=>{throw Error('PRIVATE_GOOGLE_TOKEN');}});
 await assert.rejects(badBrowser.launcher.startGoogleLogin(),error=>{
  assert.equal(error.message,'M1_LOGIN_BROWSER_UNAVAILABLE');return true;
 });
 const badResponse=make({openLoginBrowser:async()=>({type:'error',url:'PRIVATE'})});
 await assert.rejects(badResponse.launcher.startGoogleLogin(),/M1_LOGIN_RETURN_DENIED/);
 const badExchange=make({acceptReturnUrl:async()=>{throw Error('PRIVATE_SQL_BEARER');}});
 await assert.rejects(badExchange.launcher.startGoogleLogin(),error=>{
  assert.equal(error.message,'M1_LOGIN_EXCHANGE_FAILED');return true;
 });
});
test('staging scope, HTTPS pinned origins and required owner closures are verified',()=>{
 for(const changes of [
  {appId:'echo'},{environment:'production'},
  {baseUrl:'http://staging.starry.invalid'},
  {baseUrl:origin+'/other'},
  {baseUrl:origin+'?cookie=secret'},
  {appReturnUri:'starryid://oauth/complete'},
  {appReturnUri:returnUri+'#handoff=PRIVATE'},
  {appReturnUri:'https://user:pass@app.starry.invalid/oauth/complete'},
  {openLoginBrowser:'untrusted'},{acceptReturnUrl:null},{clearSession:null},
  {enabled:'yes'},
 ])assert.throws(()=>make(changes),/M1_LOGIN_CONFIG_DENIED/);
});
test('concurrent starts are refused; explicit cancellation fences a late browser return',async()=>{
 const pending=[];
 const {launcher,calls}=make({openLoginBrowser:async()=>new Promise(resolve=>pending.push(resolve))});
 const a=launcher.startGoogleLogin();
 await assert.rejects(launcher.startGoogleLogin(),/M1_LOGIN_ALREADY_PENDING/);
 launcher.cancelPendingLogin();
 pending[0]({type:'success',url:valid});
 await assert.rejects(a,/M1_LOGIN_SUPERSEDED/);
 assert.equal(calls.filter(c=>c[0]==='accept').length,0);
 const b=launcher.startGoogleLogin();
 pending[1]({type:'success',url:valid});
 assert.deepEqual(await b,{status:'authenticated',expires_at:1793000300});
 assert.equal(calls.filter(c=>c[0]==='accept').length,1);
});
test('cancel during pending exchange cannot report a successful old login',async()=>{
 let finish;
 const {launcher}=make({acceptReturnUrl:()=>new Promise(resolve=>{finish=resolve;})});
 const a=launcher.startGoogleLogin();
 // Let the browser promise complete and enter the exchange await.
 await Promise.resolve();
 await Promise.resolve();
 assert.equal(typeof finish,'function');
 launcher.cancelPendingLogin();
 finish({expires_at:1793000300});
 await assert.rejects(a,/M1_LOGIN_SUPERSEDED/);
});
test('one browser A late after canceled switch to B never becomes authenticated',async()=>{
 const pending=[];
 const accepted=[];
 const {launcher}=make({
  openLoginBrowser:async()=>new Promise(resolve=>pending.push(resolve)),
  acceptReturnUrl:async url=>{accepted.push(url);return {expires_at:1793000300};},
 });
 const a=launcher.startGoogleLogin();
 launcher.cancelPendingLogin();
 const b=launcher.startGoogleLogin();
 pending[1]({type:'success',url:valid});
 assert.deepEqual(await b,{status:'authenticated',expires_at:1793000300});
 pending[0]({type:'success',url:valid});
 await assert.rejects(a,/M1_LOGIN_SUPERSEDED/);
 assert.deepEqual(accepted,[valid]);
});
