import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {URL,fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
test('real React Native Web profile screen renders owner-safe disabled view, never calls Auth',async()=>{
 const filename=fileURLToPath(new URL('../src/member-profile-screen.tsx',import.meta.url));
 const bundle=await build({
  entryPoints:[filename],bundle:true,platform:'node',format:'cjs',
  target:'node22',write:false,jsx:'automatic',
  alias:{'react-native':'react-native-web'},
  external:['react','react/jsx-runtime','react-native-web'],
  logLevel:'silent',
 });
 const Module=require('node:module');
 const compiled=new Module(filename);
 compiled.filename=filename;
 compiled.paths=Module._nodeModulePaths(dirname(filename));
 compiled._compile(bundle.outputFiles[0].text,filename);
 const React=require('react');
 const {renderToStaticMarkup}=require('react-dom/server');
 let invoked=0;
 const never={
  async getSelf(){invoked++;throw Error('PRIVATE_USER_AND_TOKEN');},
  async patchSelfForUser(){invoked++;throw Error('PRIVATE_USER_AND_TOKEN');},
  async logout(){invoked++;throw Error('PRIVATE_USER_AND_TOKEN');},
 };
 const html=renderToStaticMarkup(React.createElement(
  compiled.exports.MemberProfileScreen,{port:never,enabled:false},
 ));
 assert.equal(compiled.exports.M1_MEMBER_PROFILE_SCREEN_LIVE_ENABLED,false);
 // A port object can stay the same while the native Auth owner switches
 // between independently issued signed Sessions. A's PII is never eligible
 // for render after the synchronous token-free revision bump.
 const valid=compiled.exports.isM1CurrentProfileAuthority;
 const portA={getSelf:never.getSelf};
 const portB={getSelf:never.getSelf};
 const original=Object.freeze({port:portA,revision:5});
 assert.equal(valid(original,portA,5,true),true);
 assert.equal(valid(original,portB,5,true),false,'another Auth port cannot show A');
 assert.equal(valid(original,portA,6,true),false,'same Auth owner, new Session hides A');
 assert.equal(valid(original,portA,5,false),false,'disabled mode always hides PII');
 assert.equal(valid(null,portA,5,true),false);
 assert.equal(valid(original,portA,NaN,true),false);
 assert.equal(valid(original,portA,-1,true),false);
 const isLost=compiled.exports.isM1SessionLost;
 assert.equal(isLost(Error('STARRY_SELF_UNAUTHORIZED')),true);
 assert.equal(isLost(Error('STARRY_SELF_SESSION_REQUIRED')),true);
 for(const value of [Error('STARRY_SELF_CONFLICT'),Error('PRIVATE_PROVIDER_TOKEN'),
  Error('STARRY_SELF_UNAVAILABLE'),null,'STARRY_SELF_UNAUTHORIZED',{}]){
  assert.equal(isLost(value),false,'only Auth-owned session loss clears identity');
 }
 // SSR never starts a real credential lookup; the profile remains guarded
 // even when a future authorized port explicitly opts into loading.
 const authorized=compiled.exports.isM1ProfilePortAuthorized;
 assert.equal(authorized(never,true,false,undefined),false,
  'a bare SDK without Auth revision stream must never read private data');
 const partial={...never,getSessionRevision:()=>1};
 assert.equal(authorized(partial,true,false,undefined),false,
  'missing subscription silently falling back to epoch 0 is forbidden');
 const partialOther={...never,subscribeSessionRevision:()=>()=>{}};
 assert.equal(authorized(partialOther,true,false,undefined),false);
 const native={...never,getSessionRevision:()=>7,
  subscribeSessionRevision:()=>()=>{}};
 assert.equal(authorized(native,true,false,undefined),true,
  'original Auth-owned revision pair enables safe screen');
 assert.equal(authorized(native,false,false,undefined),false);
 const local={...never,failNext:()=>{}};
 assert.equal(authorized(local,true,true,local),true,
  'only the exact local fixture may omit native Auth subscriptions');
 assert.equal(authorized(never,true,true,local),false,
  'a preview label cannot turn an unrelated SDK into a trusted preview');
 assert.equal(authorized(local,true,false,local),false,
  'local fixture must not silently become a live member provider');
 const missingOwner=renderToStaticMarkup(React.createElement(
  compiled.exports.MemberProfileScreen,{port:never,enabled:true},
 ));
 assert.match(missingOwner,/未取得原登入系統的身分變更通知/);
 assert.doesNotMatch(missingOwner,/正在安全處理|PRIVATE_USER|PRIVATE_TOKEN|Bearer /);
 const partialOwner=renderToStaticMarkup(React.createElement(
  compiled.exports.MemberProfileScreen,{port:partial,enabled:true},
 ));
 assert.match(partialOwner,/未取得原登入系統的身分變更通知/);
 const loading=renderToStaticMarkup(React.createElement(
  compiled.exports.MemberProfileScreen,{port:native,enabled:true},
 ));
 assert.match(loading,/正在安全處理/);
 const previewLoading=renderToStaticMarkup(React.createElement(
  compiled.exports.MemberProfileScreen,{
   port:local,enabled:true,preview:true,previewTools:local,
  },
 ));
 assert.match(previewLoading,/正在安全處理/);
 assert.equal(invoked,0,
  'neither untrusted live wiring nor SSR may invoke bearer or private GET');
 const logoutFailure=compiled.exports.failedM1LogoutScreenState;
 const ambiguous=logoutFailure(Error('STARRY_SELF_UNAVAILABLE'));
 assert.equal(ambiguous.phase,'error');
 assert.match(ambiguous.notice,/登出結果尚無法確認/);
 assert.match(ambiguous.notice,/個人資料已隱藏/);
 for(const code of ['STARRY_SELF_UNAUTHORIZED','STARRY_SELF_SESSION_REQUIRED',
  'STARRY_SELF_IDENTITY_CHANGED'])
  assert.equal(logoutFailure(Error(code)).phase,'reauth_required');
 const privateFailure=logoutFailure(Error('PRIVATE_BEARER_AND_SQL'));
 assert.equal(privateFailure.phase,'error');
 assert.doesNotMatch(privateFailure.notice,/PRIVATE_BEARER|PRIVATE_SQL|Bearer /);
 assert.equal(Object.isFrozen(privateFailure),true);
 const saveFailure=compiled.exports.failedM1SaveScreenState;
 for(const code of ['STARRY_SELF_UNAVAILABLE','STARRY_SELF_RESPONSE_INVALID',
  'STARRY_SELF_REVISION_REQUIRED','PRIVATE_SQL_BEARER']){
  const outcome=saveFailure(Error(code));
  assert.equal(outcome.phase,'error');
  assert.equal(outcome.keepDraft,false);
  assert.match(outcome.notice,/儲存結果尚無法確認/);
  assert.doesNotMatch(outcome.notice,/PRIVATE_SQL|BEARER/);
  assert.equal(Object.isFrozen(outcome),true);
 }
 const conflict=saveFailure(Error('STARRY_SELF_CONFLICT'));
 assert.equal(conflict.phase,'error');
 assert.equal(conflict.keepDraft,false);
 assert.match(conflict.notice,/重新讀取/);
 const invalid=saveFailure(Error('STARRY_SELF_FIELDS_DENIED'));
 assert.equal(invalid.phase,'ready');
 assert.equal(invalid.keepDraft,true);
 for(const code of ['STARRY_SELF_UNAUTHORIZED','STARRY_SELF_SESSION_REQUIRED',
  'STARRY_SELF_IDENTITY_CHANGED']){
  const outcome=saveFailure(Error(code));
  assert.equal(outcome.phase,'reauth_required');
  assert.equal(outcome.keepDraft,false);
 }
 assert.match(html,/我的會員資料/);
 assert.match(html,/正式登入與會員資料服務尚未開放/);
 assert.match(html,/不會取得任何身分憑證/);
 assert.equal(invoked,0);
 assert.doesNotMatch(html,/PRIVATE_USER|PRIVATE_TOKEN|Bearer |local-test-kid|u1|已儲存/);
});

test('mobile route is offline preview in __DEV__ but remains disabled in production; no dummy Auth',()=>{
 const route=readFileSync(new URL('../app/profile.tsx',import.meta.url),'utf8');
 const home=readFileSync(new URL('../app/index.tsx',import.meta.url),'utf8');
 assert.match(route,/const preview=__DEV__===true/);
 assert.match(route,/preview\?createMemberProfilePreview\(\):null/);
 assert.match(route,/port=\{fixture\?\?disabledPort\} enabled=\{fixture!==null\}/);
 assert.match(route,/STARRY_SELF_DISABLED/);
 assert.doesNotMatch(route,/enabled=\{true\}|Bearer v1|test-only-client|localhost|createM1StagingSelfClient/);
 assert.match(home,/href="\/profile"/);
 assert.match(home,/僅開發模式離線演示/);
});

test('M1 profile UI always erases stale PII on refresh and session loss, while public route remains OFF',()=>{
 const source=readFileSync(new URL('../src/member-profile-screen.tsx',import.meta.url),'utf8');
 assert.match(source,/const sessionRevision=useSyncExternalStore\(/,
  'the profile itself subscribes to the Auth-owned token-free version');
 assert.match(source,/port\.subscribeSessionRevision!:emptySubscribe/,
  'the event source must be the same port as GET/CAS/logout');
 assert.match(source,/port\.getSessionRevision!:emptyRevision/,
  'the current version comes from the same Auth owner');
 assert.match(source,/const authorized=isM1ProfilePortAuthorized\(port,enabled,preview,previewTools\)/,
  'screen refuses any unowned port rather than silently using epoch zero');
 assert.match(source,/const profile=isM1CurrentProfileAuthority\(\s*loadedAuthority,port,sessionRevision,authorized\)\?storedProfile:null/,
  'render-time owner/epoch check prevents one-frame display of A');
 assert.match(source,/setLoadedAuthority\(\{port,revision:sessionRevision\}\)/,
  'loaded data is tagged with exact Auth owner generation');
 assert.match(source,/\},\[authorized,port,sessionRevision,clearProfile\]\)/,
  'fresh verified GET must run after Session revision change');
 assert.match(source,/if\(!authorized\|\|busy\.current\)return/,
  'unowned port cannot dispatch private GET');
 assert.match(source,/if\(!authorized\|\|busy\.current\|\|!profile\|\|phase!=='ready'\)return/,
  'unowned port cannot dispatch CAS');
 assert.match(source,/clearProfile\(\);\s*setPhase\('loading'\)/);
 assert.match(source,/setPhase\(isM1SessionLost\(error\)\?'reauth_required':'error'\)/);
 assert.match(source,/const failure=failedM1SaveScreenState\(error\);[\s\S]*?if\(!failure\.keepDraft\)clearProfile\(\);\s*setPhase\(failure\.phase\);\s*setNotice\(failure\.notice\);/,
  'failed PATCH must hide stale privacy toggles unless fields are rejected');
 assert.match(source,/await port\.logout\(sessionRevision\)/,
  'logout must carry exactly the rendered Auth generation');
 assert.match(source,/const failure=failedM1LogoutScreenState\(error\);\s*clearProfile\(\);\s*setPhase\(failure\.phase\);\s*setNotice\(failure\.notice\);/,
  'ambiguous logout must hide PII before offering an authenticated refresh');
 assert.match(source,/phase==='error'\?button\('重新讀取'/,
  'ambiguous logout resolves via explicit GET, never automatic POST retry');
 assert.match(source,/phase==='reauth_required'\?'登入狀態失效，私人資料已從畫面清除/);
 assert.match(source,/phase==='ready'\?<View style=\{styles.card\}>/);
 assert.match(source,/clearProfile\(\);setNotice\(''\);setPhase\('disabled'\)/);
 const route=readFileSync(new URL('../app/profile.tsx',import.meta.url),'utf8');
 assert.match(route,/const preview=__DEV__===true/);
 assert.match(route,/preview\?createMemberProfilePreview\(\):null/);
 assert.match(route,/port=\{fixture\?\?disabledPort\} enabled=\{fixture!==null\}/);
});

test('profile SAVE uses owner-fenced SDK only; account switch must erase stale private form',()=>{
 const source=readFileSync(new URL('../src/member-profile-screen.tsx',import.meta.url),'utf8');
 const route=readFileSync(new URL('../app/profile.tsx',import.meta.url),'utf8');
 assert.match(source,/port\.patchSelfForUser\(profile\.s_user_id,profile\.profile_revision,payload,sessionRevision\)/);
 assert.doesNotMatch(source,/port\.patchSelf\(/);
 assert.match(source,/error\.message==='STARRY_SELF_IDENTITY_CHANGED'/);
 assert.match(source,/const failure=failedM1SaveScreenState\(error\);/,
  'save uses authoritative recovery classification, not stale-ready fallback');
 assert.match(source,/if\(!failure\.keepDraft\)clearProfile\(\);/);
 assert.match(route,/async patchSelfForUser\(/);
 assert.match(route,/const preview=__DEV__===true/);
 assert.match(route,/preview\?createMemberProfilePreview\(\):null/);
 assert.match(route,/port=\{fixture\?\?disabledPort\} enabled=\{fixture!==null\}/);
});
