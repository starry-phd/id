import test from 'node:test';
import assert from 'node:assert/strict';
import { STARRY_ID_TEMPLATE, assertStarryTemplate } from '../src/brand-registry.ts';
test('Starry ID template declares all four target platforms, no login or cross-brand sync',()=>{
 assert.deepEqual(STARRY_ID_TEMPLATE.platforms,['ios','android','web','pwa']);
 assert.equal(STARRY_ID_TEMPLATE.memberService,'starry-id');
 assert.equal(STARRY_ID_TEMPLATE.memberAuthEnabled,false);
 assert.equal(STARRY_ID_TEMPLATE.crossBrandSyncEnabled,false);
 assert.equal(assertStarryTemplate(STARRY_ID_TEMPLATE),STARRY_ID_TEMPLATE);
});
test('template cannot be client-switched to H-Global, fake login, or unapproved flagship app',()=>{
 for(const bad of [{...STARRY_ID_TEMPLATE,brandId:'hglobal'}, {...STARRY_ID_TEMPLATE,memberService:'hglobal-id'},{...STARRY_ID_TEMPLATE,memberAuthEnabled:true},{...STARRY_ID_TEMPLATE,crossBrandSyncEnabled:true},{...STARRY_ID_TEMPLATE,appId:'unapproved-app'}]){
  assert.throws(()=>assertStarryTemplate(bad),/STARRY_SCOPE_MISMATCH/);
 }
});
test('malformed or incomplete templates fail closed',()=>{
 for(const bad of [null,{},[],{...STARRY_ID_TEMPLATE,routes:['/']},{...STARRY_ID_TEMPLATE,platforms:['web']}]){
  assert.throws(()=>assertStarryTemplate(bad),/INVALID_STARRY_TEMPLATE|STARRY_SCOPE_MISMATCH/);
 }
});
