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
 const isLost=compiled.exports.isM1SessionLost;
 assert.equal(isLost(Error('STARRY_SELF_UNAUTHORIZED')),true);
 assert.equal(isLost(Error('STARRY_SELF_SESSION_REQUIRED')),true);
 for(const value of [Error('STARRY_SELF_CONFLICT'),Error('PRIVATE_PROVIDER_TOKEN'),
  Error('STARRY_SELF_UNAVAILABLE'),null,'STARRY_SELF_UNAUTHORIZED',{}]){
  assert.equal(isLost(value),false,'only Auth-owned session loss clears identity');
 }
 // SSR never starts a real credential lookup; the profile remains guarded
 // even when a future authorized port explicitly opts into loading.
 const loading=renderToStaticMarkup(React.createElement(
  compiled.exports.MemberProfileScreen,{port:never,enabled:true},
 ));
 assert.match(loading,/正在安全處理/);
 assert.doesNotMatch(loading,/PRIVATE_USER|PRIVATE_TOKEN|Bearer |u1/);
 assert.equal(invoked,0);
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
 assert.match(source,/clearProfile\(\);\s*setPhase\('loading'\)/);
 assert.match(source,/setPhase\(isM1SessionLost\(error\)\?'reauth_required':'error'\)/);
 assert.equal((source.match(/if\(isM1SessionLost\(error\)\)\{clearProfile\(\);setPhase\('reauth_required'\);\}/g)||[]).length,2,
  'PATCH and logout unauthorized must both clear stale member data');
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
 assert.match(source,/port\.patchSelfForUser\(profile\.s_user_id,profile\.profile_revision,payload\)/);
 assert.doesNotMatch(source,/port\.patchSelf\(/);
 assert.match(source,/error\.message==='STARRY_SELF_IDENTITY_CHANGED'/);
 assert.match(source,/if\(isM1SessionLost\(error\)\)\{clearProfile\(\);setPhase\('reauth_required'\);\}/);
 assert.match(route,/async patchSelfForUser\(/);
 assert.match(route,/const preview=__DEV__===true/);
 assert.match(route,/preview\?createMemberProfilePreview\(\):null/);
 assert.match(route,/port=\{fixture\?\?disabledPort\} enabled=\{fixture!==null\}/);
});
