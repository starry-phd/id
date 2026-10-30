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
  async patchSelf(){invoked++;throw Error('PRIVATE_USER_AND_TOKEN');},
  async logout(){invoked++;throw Error('PRIVATE_USER_AND_TOKEN');},
 };
 const html=renderToStaticMarkup(React.createElement(
  compiled.exports.MemberProfileScreen,{port:never,enabled:false},
 ));
 assert.equal(compiled.exports.M1_MEMBER_PROFILE_SCREEN_LIVE_ENABLED,false);
 assert.match(html,/我的會員資料/);
 assert.match(html,/正式登入與會員資料服務尚未開放/);
 assert.match(html,/不會取得任何身分憑證/);
 assert.equal(invoked,0);
 assert.doesNotMatch(html,/PRIVATE_USER|PRIVATE_TOKEN|Bearer |local-test-kid|u1|已儲存/);
});

test('mobile route is explicitly disabled, no dummy Auth or real callback; homepage links the implemented screen',()=>{
 const route=readFileSync(new URL('../app/profile.tsx',import.meta.url),'utf8');
 const home=readFileSync(new URL('../app/index.tsx',import.meta.url),'utf8');
 assert.match(route,/enabled=\{false\}/);
 assert.match(route,/STARRY_SELF_DISABLED/);
 assert.doesNotMatch(route,/enabled=\{true\}|Bearer v1|test-only-client|localhost|createM1StagingSelfClient/);
 assert.match(home,/href="\/profile"/);
 assert.match(home,/服務尚未啟用/);
});
