import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {signServerSession} from '../src/session-crypto.ts';
import {
 createM2LocalSelfMutationHandler,M2_SELF_MUTATION_LIVE_ENABLED,
 M2_SELF_LOGOUT_PATH,M2_SELF_PROFILE_PATH,
} from '../src/m2-local-self-mutation.ts';
import {createLocalOnlyVNextTypedSelfProfileHandler} from '../src/w3-local-vnext-typed-self-profile.ts';

const NOW=1793000000;
const origin='https://id.starry.example';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const load=p=>readFileSync(new URL(p,import.meta.url),'utf8');
async function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(load('../schema/001_starry_identity.DRAFT.sql'));
 db.exec(load('../schema/003_m2_local_member_self_mutations.DRAFT.sql'));
 db.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
  .run('u1','active',3,1,'Initial Name',0,0,NOW,NOW);
 db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
  .run('google','trusted-subject','u1');
 db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at)')
  .run('session-1','u1','starry-id','staging',3,'hash-'+ 'r'.repeat(60),NOW+300);
 const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const claims={...scope,provider:'google',provider_subject:'trusted-subject',
  s_user_id:'u1',session_id:'session-1',auth_version:3,issued_at:NOW,
  expires_at:NOW+300,key_id:'local-key'};
 const token=await signServerSession(claims,scope,NOW,{kid:'local-key',key});
 const state={time:NOW,reads:0,writes:0,beforeWrite:null,throwSQL:false,keyReads:0};
 const adapter={prepare(sql){
  const params=[];
  return {
   bind(...values){params.splice(0,params.length,...values);return this;},
   async first(){state.reads++;return db.prepare(sql).get(...params)??null;},
   async run(){
    state.writes++;
    if(state.throwSQL)throw Error('PRIVATE_SQL_COLUMN_AND_SECRET');
    if(state.beforeWrite){
     const hook=state.beforeWrite;state.beforeWrite=null;hook(sql);
    }
    const result=db.prepare(sql).run(...params);
    return {success:true,meta:{changes:result.changes}};
   },
  };
 }};
 const deps={enabled:true,serverScope:scope,expectedOrigin:origin,
  authDb:adapter,now:()=>state.time,
  getVerificationKey:async kid=>{
   state.keyReads++;
   return kid==='local-key'?key:null;
  }};
 const handle=createM2LocalSelfMutationHandler(deps);
 const profile=(changes={display_name:'Updated Name'},revision=1,extra={})=>
  new Request(origin+M2_SELF_PROFILE_PATH,{method:'PATCH',headers:{
   authorization:'Bearer '+token,'content-type':'application/json',
   'if-match':'"rev-'+revision+'"',...extra,
  },body:JSON.stringify(changes)});
 const logout=(extra={},body)=>new Request(origin+M2_SELF_LOGOUT_PATH,{
  method:'POST',headers:{authorization:'Bearer '+token,...extra},
  ...(body!==undefined?{body}:{}),
 });
 const audit=()=>db.prepare('SELECT * FROM starry_m2_member_mutation_audit ORDER BY event_id').all();
 return {db,adapter,deps,state,token,handle,profile,logout,audit,close:()=>db.close()};
}

test('M2 OFF by default; Starry-only dev/staging; no public routes',async()=>{
 const f=await fixture();try{
  assert.equal(M2_SELF_MUTATION_LIVE_ENABLED,false);
  const off=createM2LocalSelfMutationHandler({...f.deps,enabled:false});
  assert.equal((await off.handle(f.profile())).status,503);
  assert.equal(f.state.reads,0);assert.equal(f.state.keyReads,0);
  assert.equal(off.public_worker_route_registered,false);
  for(const serverScope of [
   {...scope,brand_id:'hglobal'}, {...scope,app_id:'echo'},
   {...scope,environment:'production'},
  ])assert.throws(()=>createM2LocalSelfMutationHandler({...f.deps,serverScope}),
   /M2_SELF_MUTATION_CONFIGURATION_DENIED/);
 }finally{f.close();}
});
test('authenticated profile PATCH CAS increments only one revision with atomic source audit',async()=>{
 const f=await fixture();try{
  const res=await f.handle.handle(f.profile({
   display_name:'Updated Name',directory_opt_in:true,display_name_public:true,
  }));
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.deepEqual(await res.json(),{
   s_user_id:'u1',display_name:'Updated Name',directory_opt_in:true,
   display_name_public:true,profile_revision:2,
  });
  const actual=f.db.prepare('SELECT * FROM starry_members WHERE s_user_id=?').get('u1');
  assert.equal(actual.profile_revision,2);
  assert.equal(actual.display_name,'Updated Name');assert.equal(actual.directory_opt_in,1);
  const logs=f.audit();assert.equal(logs.length,1);
  assert.equal(logs[0].event_type,'profile_updated');
  assert.equal(logs[0].profile_revision,2);
  assert.equal(logs[0].environment,null);
  assert.equal(Object.hasOwn(logs[0],'display_name'),false);
  assert.equal(JSON.stringify(logs).includes('Updated Name'),false);
  const stale=await f.handle.handle(f.profile({display_name:'Stale'},1));
  assert.equal(stale.status,409);
  assert.equal(f.audit().length,1);
  assert.equal(f.db.prepare('SELECT display_name FROM starry_members').get().display_name,'Updated Name');
 }finally{f.close();}
});
test('PATCH accepted exact reviewed allowed fields and no client principal override',async()=>{
 const f=await fixture();try{
  const res=await f.handle.handle(f.profile({display_name:null,directory_opt_in:false}));
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{
   s_user_id:'u1',display_name:null,directory_opt_in:false,
   display_name_public:false,profile_revision:2,
  });
  const unknown=await f.handle.handle(f.profile({s_user_id:'u2'},2));
  assert.equal(unknown.status,400);
  assert.equal(f.audit().length,1);
 }finally{f.close();}
});
test('trusted logout atomically revokes one Session plus no-PII event; same bearer denied thereafter',async()=>{
 const f=await fixture();try{
  const res=await f.handle.handle(f.logout());
  assert.equal(res.status,204);
  assert.equal(await res.text(),'');
  const session=f.db.prepare('SELECT revoked_at FROM starry_sessions').get();
  assert.equal(session.revoked_at,NOW);
  assert.equal(f.audit().length,1);
  assert.equal(f.audit()[0].event_type,'session_revoked');
  assert.equal(f.audit()[0].environment,'staging');
  assert.equal((await f.handle.handle(f.logout())).status,401);
  assert.equal((await f.handle.handle(f.profile())).status,401);
  assert.equal(f.audit().length,1);
  const w3=createLocalOnlyVNextTypedSelfProfileHandler({
   enabled:true,serverScope:scope,expectedOrigin:origin,
   authDb:f.adapter,getVerificationKey:f.deps.getVerificationKey,
   now:()=>f.state.time,
  });
  const get=await w3.handle(new Request(origin+M2_SELF_PROFILE_PATH,{
   headers:{authorization:'Bearer '+f.token},
  }));
  assert.equal(get.status,401);
 }finally{f.close();}
});
test('method/path/query/origin/cookie/proxy/bearer denial precedes any DB read',async()=>{
 const f=await fixture();try{
  const cases=[
   new Request(origin+M2_SELF_PROFILE_PATH,{method:'POST'}),
   new Request(origin+M2_SELF_LOGOUT_PATH,{method:'GET'}),
   new Request(origin+M2_SELF_PROFILE_PATH+'?q=1',{method:'PATCH'}),
   new Request('https://evil.example'+M2_SELF_PROFILE_PATH,{method:'PATCH'}),
   new Request(origin+'/v1/starry-id/admin/members',{method:'PATCH'}),
   f.profile({},1,{cookie:'sid=forged'}),
   f.profile({},1,{'proxy-authorization':'Basic secret'}),
   f.profile({},1,{'x-forwarded-authorization':'Bearer attacker'}),
   f.profile({},1,{authorization:'Bearer forged'}),
   f.profile({},1,{origin:'https://evil.example'}),
  ];
  for(const req of cases){
   const res=await f.handle.handle(req);
   assert.notEqual(res.status,200);
  }
  assert.equal(f.state.reads,0);assert.equal(f.state.writes,0);
 }finally{f.close();}
});
test('PATCH invalid revision, media, unknown fields, bad profile and oversize cannot mutate',async()=>{
 const f=await fixture();try{
  const cases=[
   f.profile({display_name:'Bad\nName'}),
   f.profile({display_name:'x'.repeat(81)}),
   f.profile({directory_opt_in:'true'}),
   f.profile({display_name:'Valid',role:'admin'}),
   f.profile({}),
   f.profile({display_name:'Wrong'},0),
   f.profile({display_name:'Wrong'},1,{'if-match':'*'}),
   f.profile({display_name:'Wrong'},1,{'content-type':'text/plain'}),
   f.profile({display_name:'x'.repeat(3000)}),
  ];
  for(const req of cases){
   const res=await f.handle.handle(req);
   assert.notEqual(res.status,200);
  }
  assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members').get().profile_revision,1);
  assert.equal(f.audit().length,0);
 }finally{f.close();}
});
test('real profile CAS is single-winner for simultaneous writes, audit exactly one',async()=>{
 const f=await fixture();try{
  const [a,b]=await Promise.all([
   f.handle.handle(f.profile({display_name:'First'})),
   f.handle.handle(f.profile({display_name:'Second'})),
  ]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members').get().profile_revision,2);
  assert.equal(f.audit().length,1);
 }finally{f.close();}
});
test('identity removal, active status, version and logout races fail SQL write fence',async()=>{
 const cases=[
  "DELETE FROM starry_identities WHERE provider='google'",
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=auth_version+1 WHERE s_user_id='u1'",
  "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='session-1'",
 ];
 for(const change of cases){
  const f=await fixture();try{
   f.state.beforeWrite=()=>f.db.exec(change);
   const response=await f.handle.handle(f.profile({display_name:'Unsafe'}));
   assert.notEqual(response.status,200);
   assert.equal(f.db.prepare('SELECT display_name FROM starry_members').get().display_name,'Initial Name');
   assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members').get().profile_revision,1);
   assert.equal(f.audit().filter(e=>e.event_type==='profile_updated').length,0);
  }finally{f.close();}
 }
});
test('logout revocation checks current status/identity and expiry at write time',async()=>{
 for(const action of [
  "DELETE FROM starry_identities WHERE provider='google'",
  "UPDATE starry_members SET auth_version=4",
  "UPDATE starry_members SET status='deleted'",
 ]){
  const f=await fixture();try{
   f.state.beforeWrite=()=>f.db.exec(action);
   const res=await f.handle.handle(f.logout());
   assert.notEqual(res.status,204);
   assert.equal(f.db.prepare('SELECT revoked_at FROM starry_sessions').get().revoked_at,null);
   assert.equal(f.audit().length,0);
  }finally{f.close();}
 }
});
test('audit collision/SQL failure ABORTs profile or logout source change atomically',async()=>{
 for(const mode of ['profile','logout']){
  const f=await fixture();try{
   const eventId=mode==='profile'?'m2-profile-u1-2':'m2-revoke-session-1';
   f.db.prepare('INSERT INTO starry_m2_member_mutation_audit(event_id,event_type,s_user_id,session_id,app_id,environment,profile_revision,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(eventId,mode==='profile'?'profile_updated':'session_revoked','u1',mode==='profile'?null:'session-1',
      'starry-id',mode==='profile'?null:'staging',mode==='profile'?2:null,NOW);
   const res=await f.handle.handle(mode==='profile'?f.profile():f.logout());
   assert.equal(res.status,503);
   assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members').get().profile_revision,1);
   assert.equal(f.db.prepare('SELECT revoked_at FROM starry_sessions').get().revoked_at,null);
   assert.equal(f.audit().length,1);
  }finally{f.close();}
 }
});
test('managed HMAC key failure, DB throw and post-await clock jump never return sensitive details',async()=>{
 for(const mode of ['key','db','time']){
  const f=await fixture();try{
   if(mode==='key')f.deps.getVerificationKey=async()=>{throw Error('PRIVATE_KMS_KEY');};
   if(mode==='db')f.state.throwSQL=true;
   if(mode==='time')f.state.beforeWrite=()=>{f.state.time=NOW+301;};
   const instance=mode==='key'?createM2LocalSelfMutationHandler(f.deps):f.handle;
   const res=await instance.handle(f.profile());
   assert.notEqual(res.status,200);
   const body=await res.text();
   assert.equal(body.includes('PRIVATE_'),false);
   assert.equal(f.db.prepare('SELECT profile_revision FROM starry_members').get().profile_revision,1);
  }finally{f.close();}
 }
});
