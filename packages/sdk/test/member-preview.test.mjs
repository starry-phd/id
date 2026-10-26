import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberPreviewSdk} from '../src/member-preview.ts';
test('preview member SDK refuses traversal, credentials, URL fragments, path and HTTP remote',()=>{
 for(const url of ['https://api.example.invalid/child','https://api.example.invalid/?token=bad',
   'https://api.example.invalid/#token','http://api.example.invalid',
   'https://me:secret@api.example.invalid']){
  assert.throws(()=>createMemberPreviewSdk(url,async()=>null),/INVALID_API_ORIGIN|INSECURE_API_ORIGIN/);
 }
});
test('cannot turn an HTTP JSON signedIn:true flag into an authenticated SDK request',async()=>{
 let calls=0;
 const sdk=createMemberPreviewSdk('https://api.example.invalid',async()=>null,async()=>{
  calls++;return Response.json({signedIn:true,verified:true});
 });
 await assert.rejects(sdk.readSelf(),/VERIFIED_SESSION_REQUIRED/);
 assert.equal(calls,0);
});
