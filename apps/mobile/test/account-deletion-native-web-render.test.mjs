import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {URL,fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {build} from 'esbuild';
import {createDeletionPreview} from '../src/account-deletion-preview.ts';

const require=createRequire(import.meta.url);
test('Actual React Native Web screen server-renders a usable first confirmation and subscription warning',async()=>{
 // A true component render (not a hand-drawn mock): bundle only local TSX,
 // externally resolve the project's pinned React / React Native Web.
 const filename=fileURLToPath(new URL('../src/account-deletion-screen.tsx',import.meta.url));
 const bundle=await build({entryPoints:[filename],bundle:true,
  platform:'node',format:'cjs',target:'node22',write:false,jsx:'automatic',
  alias:{'react-native':'react-native-web'},
  external:['react','react/jsx-runtime','react-native-web'],logLevel:'silent',
 });
 const Module=require('node:module');
 const compiled=new Module(filename);
 compiled.filename=filename;
 compiled.paths=Module._nodeModulePaths(dirname(filename));
 compiled._compile(bundle.outputFiles[0].text,filename);
 const React=require('react');
 const {renderToStaticMarkup}=require('react-dom/server');
 const preview=createDeletionPreview();
 const html=renderToStaticMarkup(React.createElement(
  compiled.exports.AccountDeletionScreen,{
   port:preview,preview:true,previewTools:preview,
  }));
 assert.match(html,/申請刪除帳號/);
 assert.match(html,/本機操作演示/);
 assert.match(html,/第一次確認：我要提出刪帳申請/);
 assert.match(html,/查詢申請進度/);
 assert.match(html,/不會自動取消商店訂閱/);
 assert.doesNotMatch(html,/physical_erasure_completed|execution_authorized|G00|Q104|Q119/);
});
