import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarryD1Port} from '../src/d1-ports.ts';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const memberRow={s_user_id:'s1',status:'active',auth_version:3,profile_revision:2,
 display_name:'Alias',directory_opt_in:0,display_name_public:0};
const sessRow={session_id:'session-1',s_user_id:'s1',auth_version:3,app_id:'starry-id',
 environment:'staging',expires_at:2000000000,revoked_at:null,
 step_up_method:null,step_up_verified_at:null,step_up_expires_at:null};
function mockDb(answer=null,changes=1){
 let calls=[];
 const db={prepare(sql){const p={bind(...args){calls.push({sql,args});return p;},
  first:async()=>answer,run:async()=>({success:true,meta:{changes}})};return p;}};
 return {db,calls};
}
test('D1 member port converts INTEGER privacy to booleans and rejects corrupted columns',async()=>{
 const m=mockDb(memberRow);const port=createStarryD1Port(m.db,scope);
 assert.deepEqual(await port.readMember('s1'),{...memberRow,directory_opt_in:false,display_name_public:false});
 assert.equal(m.calls[0].args[0],'s1');
 assert.equal(await createStarryD1Port(mockDb({...memberRow,directory_opt_in:2}).db,scope).readMember('s1'),null);
 assert.equal(await createStarryD1Port(mockDb({...memberRow,status:'unknown'}).db,scope).readMember('s1'),null);
});
test('D1 session server App/env enforced; no SQL field from request',async()=>{
 const m=mockDb(sessRow),port=createStarryD1Port(m.db,scope);
 assert.equal((await port.readSession('session-1')).session_id,'session-1');
 assert.deepEqual(m.calls[0].args,['session-1','starry-id','staging']);
 assert.equal(await createStarryD1Port(mockDb({...sessRow,environment:'production'}).db,scope).readSession('session-1'),null);
});
test('D1 stable provider subject lookup is uniquely scoped by s_user_id',async()=>{
 const m=mockDb({matched:1}),p=createStarryD1Port(m.db,scope);
 assert.equal(await p.identityMatches('apple','apple-sub','s1'),true);
 assert.deepEqual(m.calls[0].args,['apple','apple-sub','s1']);
 assert.equal(await p.identityMatches('evil','sub','s1'),false);
});
test('D1 profile CAS and single Session revoke require exactly one modified row',async()=>{
 const args={s_user_id:'s1',auth_version:3,expected_revision:2,
 display_name:'Alias',directory_opt_in:false,display_name_public:false,now:1793000000};
 const m=mockDb(null,1),p=createStarryD1Port(m.db,scope);
 assert.equal(await p.updateProfileCAS(args),true);
 assert.ok(m.calls[0].sql.includes("status='active' AND auth_version=? AND profile_revision=?"));
 assert.equal(await p.revokeSessionCAS('s1','session-1',3,1793000000),true);
 assert.deepEqual(m.calls[1].args,[1793000000,'s1','session-1','starry-id','staging',3]);
 assert.equal(await createStarryD1Port(mockDb(null,0).db,scope).updateProfileCAS(args),false);
 assert.equal(await createStarryD1Port(mockDb(null,0).db,scope).revokeSessionCAS('s1','session-1',3,1793000000),false);
 assert.equal(await p.updateProfileCAS({...args,display_name:'Untrusted\nInject'}),false);
});
test('Starry D1 account binding strict to App/Store sandbox row',async()=>{
 const key={s_user_id:'s1',app_id:'starry-id',environment:'staging',store:'apple',
  store_app_id:'phd.starry.id',store_environment:'sandbox'};
 const row={...key,account_binding:'123e4567-e89b-42d3-a456-426614174000',
  revoked_at:null,expires_at:null};
 const m=mockDb(row),p=createStarryD1Port(m.db,scope);
 assert.deepEqual(await p.readStoreBinding(key),{...row,brand_id:'starry'});
 assert.equal(await p.readStoreBinding({...key,app_id:'foreign'}),null);
 assert.equal(await createStarryD1Port(mockDb({...row,store:'google'}).db,scope).readStoreBinding(key),null);
});
