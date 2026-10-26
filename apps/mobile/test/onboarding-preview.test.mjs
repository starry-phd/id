import test from 'node:test';
import assert from 'node:assert/strict';
import {previewAgeSelfDeclaration} from '../src/onboarding-preview.ts';
test('Q93/Q106: exactly 18 is eligible for SERVER REVIEW only; not login approval',()=>{
 const before=previewAgeSelfDeclaration('2008-10-27','2026-10-26','TW');
 assert.equal(before.status,'under_18');
 const onDate=previewAgeSelfDeclaration('2008-10-27','2026-10-27','TW');
 assert.deepEqual(onDate,{status:'server_and_region_review_required',may_register:false,
  age_verified:false,date_of_birth_stored:false,region_enabled:false,advertisements_enabled:false});
});
test('date validation, leap days, future dates, missing country all fail closed',()=>{
 for(const b of ['2008-02-30','2007-13-01','not-a-date','',null,'2027-01-01']){
  const r=previewAgeSelfDeclaration(b,'2026-10-27','TW');
  assert.equal(r.may_register,false);
  assert.equal(r.status,'invalid');
 }
 assert.equal(previewAgeSelfDeclaration('2008-02-29','2026-02-28','TW').status,'under_18');
 assert.equal(previewAgeSelfDeclaration('2008-02-29','2026-03-01','TW').status,
  'server_and_region_review_required');
 for(const region of ['TWN','us','',null,'GLOBAL']){
  assert.equal(previewAgeSelfDeclaration('1990-01-01','2026-10-27',region).status,'invalid');
 }
});
test('every region is pending legal/store Gate even when adult: no global self-approval',()=>{
 for(const region of ['TW','US','JP','DE','FR']){
  const a=previewAgeSelfDeclaration('1985-04-12','2026-10-27',region);
  assert.equal(a.may_register,false);
  assert.equal(a.region_enabled,false);
  assert.equal(a.age_verified,false);
  assert.equal('birthDate' in a,false);
 }
});
