import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {signServerSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createOfflineRound4MemberWorker} from '../test-support/round4-member-worker.ts';
import {createMemberPreviewSdk} from '../../../packages/sdk/src/member-preview.ts';
import {handleRequest} from '../src/index.ts';

const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const member={s_user_id:'s_user1',status:'active',auth_version:4,profile_revision:2,
 display_name:'Private Member',directory_opt_in:0,display_name_public:0};
const session={session_id:'ss_one',s_user_id:'s_user1',auth_version:4,
 app_id:'starry-id',environment:'staging',expires_at:now+400,revoked_at:null,
 step_up_method:null,step_up_verified_at:null,step_up_expires_at:null};
const claims={...scope,provider:'apple',provider_subject:'stable_sub1',
 s_user_id:'s_user1',session_id:'ss_one',auth_version:4,
 expires_at:now+400,issued_at:now,key_id:'test_kid1'};
async function fixture(){
 const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
   false,['sign','verify']);
 const state={member:{...member},session:{...session},linked:true,now,readCount:0};
 const db={prepare(sql){
   return {bind(...args){
     return {async first(){
       state.readCount++;
       if(sql.startsWith('SELECT s_user_id,status,auth_version')){
         assert.deepEqual(args,['s_user1']);return state.member;
       }
       if(sql.startsWith('SELECT session_id,s_user_id')){
         assert.deepEqual(args,['ss_one','starry-id','staging']);return state.session;
       }
       if(sql.startsWith('SELECT 1 AS matched FROM starry_identities')){
         assert.deepEqual(args,['apple','stable_sub1','s_user1']);
         return state.linked?{matched:1}:null;
       }
       throw Error('NON_READ_SQL_DENIED');
     },async run(){throw Error('NO_D1_WRITES');}};
   }};
 }};
 const h=createOfflineRound4MemberWorker({scope,db,nowSeconds:()=>state.now,
  resolveServerSessionKey:async kid=>kid==='test_kid1'?key:null});
 const token=await signServerSession(claims,scope,now,{kid:'test_kid1',key});
 const request=(bearer=token,path='/v1/member/self')=>new Request('https://example.test'+path,
  {headers:{authorization:'Bearer '+bearer}});
 return {key,state,h,token,request,db};
}
test('AI-1 real HMAC signature -> prepared D1-shaped read -> sealed principal -> AI-4 Worker -> SDK',async()=>{
 const f=await fixture();
 const sdk=createMemberPreviewSdk('https://example.test',async()=>f.token,
  async(url,init)=>f.h(new Request(url,init)));
 const data=await sdk.readSelf();
 assert.deepEqual(data,{s_user_id:'s_user1',display_name:'Private Member',directory_opt_in:false,
  display_name_public:false,profile_revision:2});
 assert.ok(f.state.readCount>=4);
 assert.equal(handleRequest(f.request(),{STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'}).status,404);
});
test('signed token still denied after current D1 session revoked/version/expiry or member suspension',async()=>{
 for(const delta of [
  {session:{...session,revoked_at:now}},
  {session:{...session,auth_version:5}},
  {session:{...session,expires_at:now}},
  {member:{...member,auth_version:5}},
  {member:{...member,status:'suspended'}},
  {member:{...member,status:'deleted'}},
 ]){
   const f=await fixture();Object.assign(f.state,delta);
   assert.equal((await f.h(f.request())).status,401);
 }
 const f=await fixture();f.state.now=now+401;
 assert.equal((await f.h(f.request())).status,401);
});
test('wrong key, wrong JWT claims, mismatch subject, client verified flag and production scope fail closed',async()=>{
 const f=await fixture();
 const other=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
  false,['sign','verify']);
 const foreign=await signServerSession(claims,scope,now,{kid:'test_kid1',key:other});
 assert.equal((await f.h(f.request(foreign))).status,401);
 assert.equal((await f.h(f.request(f.token+'invalid'))).status,401);
 await assert.rejects(signServerSession({...claims,brand_id:'hglobal'},
  {...scope,brand_id:'hglobal'},now,{kid:'test_kid1',key:f.key}),/SESSION_SIGN_DENIED/);
 for(const patch of [{app_id:'other'},{environment:'production'}]){
  const token=await signServerSession({...claims,...patch},{...scope,...patch},now,
   {kid:'test_kid1',key:f.key});
  assert.equal((await f.h(f.request(token))).status,401);
 }
 f.state.linked=false;
 assert.equal((await f.h(f.request())).status,401);
 assert.equal((await f.h(new Request('https://example.test/v1/member/self',
  {method:'POST',body:JSON.stringify({adminVerified:true,s_user_id:'s_user1'})}))).status,405);
 assert.throws(()=>createOfflineRound4MemberWorker({
  scope:{...scope,environment:'production'},db:f.db,nowSeconds:()=>now,
  resolveServerSessionKey:async()=>f.key}),/OFFLINE_BRAND_SCOPE_DENIED/);
});
