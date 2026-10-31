import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {URL,fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {build} from 'esbuild';
import {createDeletionPreview} from '../src/account-deletion-preview.ts';
import {createDeletionFlow} from '../src/account-deletion-flow.ts';

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

test('actual compiled M2 screen shows no stale milestone while second POST response is ambiguous',async()=>{
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
 const progress=compiled.exports.settledDeletionProgress;
 assert.equal(typeof progress,'function');
 const awaiting={request_id:'m2del-'+'c'.repeat(48),
  status:'awaiting_second_confirmation',first_confirmed_at:1793000000,
  second_confirmed_at:null,physical_erasure_completed:false,
  execution_authorized:false};
 let saved=awaiting;
 let posts=0;
 const flow=createDeletionFlow({
  async getStatus(){return saved;},
  async requestDeletion(){throw Error('UNEXPECTED_FIRST');},
  async confirmDeletion(){
   posts++;
   saved={...awaiting,status:'pending_processing',second_confirmed_at:1793000001};
   throw Error('POST2_RESPONSE_LOST');
  },
 });
 await flow.refresh();
 assert.equal(progress(flow.snapshot()),'awaiting_second_confirmation');
 await flow.confirmSecond();
 assert.equal(flow.snapshot().phase,'error');
 assert.equal(flow.snapshot().receipt.status,'awaiting_second_confirmation');
 assert.equal(progress(flow.snapshot()),null,
  'a stale first receipt cannot assert that second confirmation did not commit');
 await flow.retry();
 assert.equal(progress(flow.snapshot()),'pending_processing');
 assert.equal(posts,1);

 let statusReads=0;
 const stalePending=createDeletionFlow({
  async getStatus(){
   if(statusReads++===0)return saved;
   throw Error('STATUS_NETWORK_LOST');
  },
  async requestDeletion(){throw Error('NO_POST');},
  async confirmDeletion(){throw Error('NO_POST');},
 });
 await stalePending.refresh();
 assert.equal(progress(stalePending.snapshot()),'pending_processing');
 await stalePending.refresh();
 assert.equal(stalePending.snapshot().phase,'error');
 assert.equal(stalePending.snapshot().receipt.status,'pending_processing');
 assert.equal(progress(stalePending.snapshot()),null,
  'an unverified status must not hide recovery controls as confirmed pending');
});
