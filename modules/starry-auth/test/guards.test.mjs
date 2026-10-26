import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeSession,authorizeAdmin,authorizePublicProfile,hasExpectedOidcBinding,disabledCrossBrandSync} from '../src/guards.ts';
const now=1780000000;
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const p={brand_id:'starry',app_id:'starry-id',environment:'staging',s_user_id:'u1',session_id:'sid',auth_version:2,expires_at:now+900};
const s={s_user_id:'u1',session_id:'sid',app_id:'starry-id',environment:'staging',auth_version:2,expires_at:now+900,revoked_at:null,step_up_until:now+60};
const m={s_user_id:'u1',status:'active',auth_version:2};
const g={s_user_id:'u1',brand_id:'starry',app_id:'starry-id',environment:'staging',resource:'member',action:'write',expires_at:now+900,revoked_at:null};
const op={resource:'member',action:'write'};
const check=(a=p,b=s,c=m)=>authorizeSession(scope,a,b,c,now);
const admin=(a=g,b=op,c=s)=>authorizeAdmin(scope,p,c,m,a,b,now);
test('valid scoped member and elevated grant',()=>{assert.equal(check().allowed,true);assert.equal(admin().allowed,true)});
test('missing principal, brand, app, env default deny',()=>{
 assert.equal(check(null).reason,'AUTH_REQUIRED');
 for(const [k,v] of [['brand_id','hglobal'],['app_id','other'],['environment','production']])
  assert.equal(check({...p,[k]:v}).reason,'SCOPE_DENIED');
});
test('suspended and deleted members denied',()=>{
 for(const status of ['suspended','deleted'])assert.equal(check(p,s,{...m,status}).reason,'MEMBER_INACTIVE');
});
test('revoked, expired, version mismatch denied',()=>{
 for(const changes of [{revoked_at:now},{expires_at:now},{session_id:'other'},{auth_version:3}])
   assert.equal(check(p,{...s,...changes}).reason,'SESSION_REVOKED');
 assert.equal(check({...p,auth_version:3}).reason,'SESSION_REVOKED');
});
test('grant rejects cross brand/app/env, resource, subject, action and revocation',()=>{
 for(const [k,v] of [['brand_id','hglobal'],['app_id','other'],['environment','production'],['resource','billing'],['s_user_id','u2'],['action','read'],['revoked_at',now]])
  assert.equal(admin({...g,[k]:v}).reason,'ADMIN_DENIED');
});
test('non-read admin actions require fresh persisted step-up',()=>{
 assert.equal(admin(g,op,{...s,step_up_until:null}).reason,'STEP_UP_REQUIRED');
 assert.equal(admin(g,op,{...s,step_up_until:now}).reason,'STEP_UP_REQUIRED');
 assert.equal(admin({...g,action:'read'},{resource:'member',action:'read'},{...s,step_up_until:null}).allowed,true);
});
test('public member profile defaults private',()=>{
 const view={status:'active',directory_opt_in:true,display_name_public:true};
 assert.equal(authorizePublicProfile(view).allowed,true);
 assert.equal(authorizePublicProfile({...view,directory_opt_in:false}).reason,'PROFILE_PRIVATE');
 assert.equal(authorizePublicProfile({...view,status:'suspended'}).reason,'PROFILE_PRIVATE');
});
test('OIDC post-JWKS binding enforces issuer, audience, nonce and expiry',()=>{
 const c={issuer:'google',audience:['client'],subject:'stable-sub',nonce:'N',issued_at:now-10,expires_at:now+200};
 const e={issuer:'google',client_id:'client',nonce:'N',now};
 assert.equal(hasExpectedOidcBinding(c,e),true);
 for(const z of [{issuer:'other'},{audience:['wrong']},{nonce:'replay'},{expires_at:now},{subject:''}])
 assert.equal(hasExpectedOidcBinding({...c,...z},e),false);
});
test('cross-brand sync fails closed',()=>assert.throws(()=>disabledCrossBrandSync(),/FEATURE_DISABLED/));
