import test from 'node:test';
import assert from 'node:assert/strict';
import {signServerSession,createVerifiedSignedSession} from '../src/session-crypto.ts';
import {createServerIdentityResolver,readSelf} from '../src/index.ts';
const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const c={brand_id:'starry',app_id:'starry-id',environment:'staging',provider:'apple',
 provider_subject:'signed-apple-sub',s_user_id:'s_001',session_id:'session-1',auth_version:3,
 expires_at:now+300,issued_at:now,key_id:'kid-1'};
async function fixture(){
 const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const issue=(claims=c)=>signServerSession(claims,scope,now,{kid:'kid-1',key});
 const verify=createVerifiedSignedSession({scope,getKey:async kid=>kid==='kid-1'?key:null});
 return {key,issue,verify};
}
test('WebCrypto HMAC session evidence verifies actual signature and pins scope',async()=>{
 const f=await fixture();const token=await f.issue();
 assert.deepEqual(await f.verify(token,now),{
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  provider:'apple',provider_subject:'signed-apple-sub',s_user_id:'s_001',
  session_id:'session-1',auth_version:3,expires_at:now+300,
 });
});
test('session rejects tamper, wrong key, wrong scope and client forged JSON',async()=>{
 const f=await fixture(),tok=await f.issue();
 const evil=await fixture();
 assert.equal(await evil.verify(tok,now),null);
 assert.equal(await f.verify(tok.slice(0,-3)+'aaa',now),null);
 assert.equal(await f.verify({...c,adminVerified:true},now),null);
 const other=createVerifiedSignedSession({scope:{...scope,app_id:'other'},getKey:async()=>f.key});
 assert.equal(await other(tok,now),null);
 const prod=createVerifiedSignedSession({scope:{...scope,environment:'production'},getKey:async()=>f.key});
 assert.equal(await prod(tok,now),null);
});
test('short-lived session rejects expired, future, wrong auth_version format',async()=>{
 const f=await fixture(),token=await f.issue();
 assert.equal(await f.verify(token,now+301),null);
 assert.equal(await f.verify(token,now-902),null);
 await assert.rejects(f.issue({...c,expires_at:now+10000}),/SESSION_SIGN_DENIED/);
 await assert.rejects(f.issue({...c,auth_version:0}),/SESSION_SIGN_DENIED/);
});
test('real signature is insufficient: D1 resolver revokes/suspends/bumps version',async()=>{
 const f=await fixture(),token=await f.issue();
 let revoked=null,status='active',version=3;
 const member=()=>({s_user_id:'s_001',status,auth_version:version,profile_revision:1,
   display_name:null,directory_opt_in:false,display_name_public:false});
 const session=()=>({session_id:'session-1',s_user_id:'s_001',auth_version:version,
   app_id:'starry-id',environment:'staging',expires_at:now+300,revoked_at:revoked,
   step_up_method:null,step_up_verified_at:null,step_up_expires_at:null});
 const resolver=createServerIdentityResolver({trusted_scope:scope,
  verify_oidc_or_session:raw=>f.verify(raw,now),read_member:async()=>member(),read_session:async()=>session(),
  identity_matches:async()=>true});
 let p=await resolver(token,now);
 assert.equal(readSelf(p,scope,member(),now).s_user_id,'s_001');
 revoked=now;assert.equal(await resolver(token,now),null);
 revoked=null;status='suspended';assert.equal(await resolver(token,now),null);
 status='active';version=4;assert.equal(await resolver(token,now),null);
});
