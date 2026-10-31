import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createMemberProfilePreview} from '../src/member-profile-preview.ts';

const first={s_user_id:'starry-preview-member',display_name:'示範會員',
 directory_opt_in:false,display_name_public:false,profile_revision:1};

test('offline developer fixture provides only the five canonical self fields',async()=>{
 const demo=createMemberProfilePreview();
 const me=await demo.getSelf();
 assert.deepEqual(me,first);
 assert.deepEqual(Object.keys(me).sort(),Object.keys(first).sort());
 assert.equal(Object.isFrozen(me),true);
 assert.equal('access_token' in demo,false);
 assert.equal('getSessionBearer' in demo,false);
 assert.equal('auth' in demo,false);
});

test('developer fixture handles three-field profile editing with increasing CAS revision',async()=>{
 const demo=createMemberProfilePreview();
 const updated=await demo.patchSelfForUser('starry-preview-member',1,{
  display_name:'離線示範',directory_opt_in:true,display_name_public:true,
 });
 assert.deepEqual(updated,{...first,display_name:'離線示範',
  directory_opt_in:true,display_name_public:true,profile_revision:2});
 assert.deepEqual(await demo.getSelf(),updated);
 const next=await demo.patchSelfForUser('starry-preview-member',2,{display_name:null});
 assert.deepEqual(next,{...updated,display_name:null,profile_revision:3});
});

test('wrong member identity and stale CAS cannot modify current preview profile',async()=>{
 const demo=createMemberProfilePreview();
 await assert.rejects(demo.patchSelfForUser('other-member',1,{display_name:'侵入'}),
  /STARRY_SELF_IDENTITY_CHANGED/);
 await assert.rejects(demo.patchSelfForUser('starry-preview-member',2,{display_name:'舊版'}),
  /STARRY_SELF_CONFLICT/);
 await assert.rejects(demo.patchSelfForUser('starry-preview-member',0,{display_name:'錯誤'}),
  /STARRY_SELF_REVISION_REQUIRED/);
 assert.deepEqual(await demo.getSelf(),first);
});

test('malformed patch, extra fields and impersonation cannot reach even the preview state',async()=>{
 const demo=createMemberProfilePreview();
 for(const patch of [
  {},{email:'someone@example.invalid'}, {display_name:'   '},
  {display_name:'hello\nworld'}, {display_name:'x'.repeat(81)},
  {directory_opt_in:'true'}, {display_name_public:0},
  Object.create(null), [],
 ]){
  await assert.rejects(
   demo.patchSelfForUser('starry-preview-member',1,patch),
   /STARRY_SELF_FIELDS_DENIED/,
  );
 }
 assert.deepEqual(await demo.getSelf(),first);
});

test('simulated CAS conflict advances remote version, rejecting previous screen revision',async()=>{
 const demo=createMemberProfilePreview();
 demo.failNext('CONFLICT');
 await assert.rejects(
  demo.patchSelfForUser('starry-preview-member',1,{display_name:'裝置 A'}),
  /STARRY_SELF_CONFLICT/,
 );
 const remote=await demo.getSelf();
 assert.equal(remote.profile_revision,2);
 assert.equal(remote.display_name,'示範會員');
 await assert.rejects(
  demo.patchSelfForUser('starry-preview-member',1,{display_name:'裝置 B'}),
  /STARRY_SELF_CONFLICT/,
 );
 assert.equal((await demo.patchSelfForUser('starry-preview-member',2,{
  display_name:'修正版本',
 })).profile_revision,3);
});

test('simulated service outage is transient; successful refresh returns same local state',async()=>{
 const demo=createMemberProfilePreview();
 demo.failNext('UNAVAILABLE');
 await assert.rejects(demo.getSelf(),/STARRY_SELF_UNAVAILABLE/);
 assert.deepEqual(await demo.getSelf(),first);
});

test('simulated authentication loss clears access; logout permanently rejects old session',async()=>{
 const lost=createMemberProfilePreview();
 lost.failNext('UNAUTHORIZED');
 await assert.rejects(lost.getSelf(),/STARRY_SELF_UNAUTHORIZED/);
 await assert.rejects(lost.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 await assert.rejects(lost.patchSelfForUser('starry-preview-member',1,
  {display_name:'不得寫入'}),/STARRY_SELF_SESSION_REQUIRED/);
 const normal=createMemberProfilePreview();
 await normal.logout();
 await assert.rejects(normal.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 await assert.rejects(normal.logout(),/STARRY_SELF_SESSION_REQUIRED/);
 assert.deepEqual(await createMemberProfilePreview().getSelf(),first,
  'new screen instance has new disposable preview, NOT restored login');
});

test('Expo route gates fixture behind __DEV__, preserving production disabled port',()=>{
 const url=new URL('../app/profile.tsx',import.meta.url);
 const source=readFileSync(fileURLToPath(url),'utf8');
 assert.match(source,/const preview=__DEV__===true/);
 assert.match(source,/preview\?createMemberProfilePreview\(\):null/);
 assert.match(source,/port=\{fixture\?\?disabledPort\}/);
 assert.match(source,/enabled=\{fixture!==null\}/);
 assert.match(source,/STARRY_SELF_DISABLED/);
 const fixtureSource=readFileSync(fileURLToPath(
  new URL('../src/member-profile-preview.ts',import.meta.url)),'utf8');
 assert.doesNotMatch(fixtureSource,/\bfetch\s*\(/);
 assert.doesNotMatch(fixtureSource,/AsyncStorage|SecureStore|localStorage/);
});
