import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {signServerSession} from '../src/session-crypto.ts';
import {createLocalOnlyVNextTypedSelfProfileHandler} from '../src/w3-local-vnext-typed-self-profile.ts';
import {
 createM2LocalDeletionRequestHandler,M2_DELETE_REQUEST_LIVE_ENABLED,
 M2_DELETE_REQUEST_PATH,M2_DELETE_CONFIRM_PATH,M2_DELETE_STATUS_PATH,
 FIRST_CONFIRMATION,SECOND_CONFIRMATION,
} from '../src/m2-local-deletion-request.ts';

const NOW=1793000000;
const origin='https://id.starry.example';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const load=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const schema=[
 '../schema/001_starry_identity.DRAFT.sql',
 '../schema/002_m1_local_oauth_attempts.DRAFT.sql',
 '../schema/003_m2_local_member_self_mutations.DRAFT.sql',
 '../schema/004_m2_local_deletion_request_receipt.DRAFT.sql',
];
async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const path of schema)db.exec(load(path));
 const addMember=(id,sub,sess)=>{
  db.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
   .run(id,'active',3,1,'Private '+id,0,0,NOW,NOW);
  db.prepare('INSERT INTO starry_identities VALUES(?,?,?)').run('google',sub,id);
  db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)')
   .run(sess,id,'starry-id','staging',3,'hash-'+sess.padEnd(60,'r'),NOW+300);
 };
 addMember('u1','subject-1','session-1');
 addMember('u2','subject-2','session-2');
 const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const token=async(id='u1',sub='subject-1',sess='session-1')=>signServerSession({
  ...scope,provider:'google',provider_subject:sub,s_user_id:id,
  session_id:sess,auth_version:3,issued_at:NOW,expires_at:NOW+300,key_id:'test-kid',
 },scope,NOW,{kid:'test-kid',key});
 const t1=await token(),t2=await token('u2','subject-2','session-2');
 const state={time:NOW,writeCount:0,beforeWrite:null,throwWrite:false,reads:0,keyReads:0,randomCount:0};
 const adapter={prepare(sql){
  let params=[];
  return {
   bind(...args){params=args;return this;},
   async first(){
    if(/^(INSERT INTO starry_m2_deletion_requests|UPDATE starry_m2_deletion_requests)/.test(sql)){
     state.writeCount++;
     if(state.throwWrite)throw Error('PRIVATE_SQL_FAILURE');
     if(state.beforeWrite){const fn=state.beforeWrite;state.beforeWrite=null;fn(sql);}
    }else state.reads++;
    return db.prepare(sql).get(...params)??null;
   },
   async run(){const result=db.prepare(sql).run(...params);return {success:true,meta:{changes:result.changes}};},
  };
 }};
 const deps={enabled:true,serverScope:scope,expectedOrigin:origin,authDb:adapter,
  getVerificationKey:async kid=>{state.keyReads++;return kid==='test-kid'?key:null;},
  now:()=>state.time,
  randomBytes:n=>new Uint8Array(n).fill((++state.randomCount)%256),
 };
 const handler=createM2LocalDeletionRequestHandler(deps);
 const request=(path,who=t1,method='GET',body,extra={})=>new Request(origin+path,{
  method,headers:{authorization:'Bearer '+who,
   ...(body!==undefined?{'content-type':'application/json'}:{}),...extra},
  ...(body!==undefined?{body:JSON.stringify(body)}:{}),
 });
 const first=(who=t1,body={confirmation:FIRST_CONFIRMATION},opts={})=>
  request(M2_DELETE_REQUEST_PATH,who,'POST',body,opts);
 const second=(id,who=t1,body={confirmation:SECOND_CONFIRMATION,request_id:id},opts={})=>
  request(M2_DELETE_CONFIRM_PATH,who,'POST',body,opts);
 const get=(who=t1)=>request(M2_DELETE_STATUS_PATH,who);
 const audit=()=>db.prepare('SELECT * FROM starry_m2_deletion_request_audit ORDER BY event_type').all();
 const requests=()=>db.prepare('SELECT * FROM starry_m2_deletion_requests').all();
 return {db,state,adapter,deps,handler,key,t1,t2,request,first,second,get,
  token,addMember,audit,requests,close:()=>db.close()};
}
const publicFields=['request_id','status','first_confirmed_at','second_confirmed_at',
 'physical_erasure_completed','execution_authorized'];

test('OFF by default + Starry-only DEV/STAGING, never public route/erasure execution',async()=>{
 const f=await fixture();try{
  const off=createM2LocalDeletionRequestHandler({...f.deps,enabled:false});
  const denied=await off.handle(f.first());
  assert.equal(denied.status,503);
  assert.equal(f.state.keyReads,0);
  assert.equal(f.state.reads,0);
  assert.equal(M2_DELETE_REQUEST_LIVE_ENABLED,false);
  assert.equal(off.live_enabled,false);
  assert.equal(off.public_worker_route_registered,false);
  assert.equal(off.physical_erasure_implemented,false);
  for(const serverScope of [
   {...scope,brand_id:'hglobal'}, {...scope,app_id:'echo'},
   {...scope,environment:'production'},
  ])assert.throws(()=>createM2LocalDeletionRequestHandler({...f.deps,serverScope}),
   /M2_DELETE_REQUEST_CONFIGURATION_DENIED/);
  assert.throws(()=>createM2LocalDeletionRequestHandler({...f.deps,expectedOrigin:'http://insecure.example'}),
   /M2_DELETE_REQUEST_ORIGIN_DENIED/);
 }finally{f.close();}
});

test('first explicit confirmation persists awaiting state, second distinct HTTP confirmation persists pending + atomic audit',async()=>{
 const f=await fixture();try{
  assert.equal((await f.handler.handle(f.get())).status,404);
  const first=await f.handler.handle(f.first());
  assert.equal(first.status,202);
  assert.equal(first.headers.get('cache-control'),'no-store');
  const before=await first.json();
  assert.deepEqual(Object.keys(before).sort(),publicFields.sort());
  assert.match(before.request_id,/^m2del-[a-f0-9]{48}$/);
  assert.equal(before.status,'awaiting_second_confirmation');
  assert.equal(before.first_confirmed_at,NOW);
  assert.equal(before.second_confirmed_at,null);
  assert.equal(before.physical_erasure_completed,false);
  assert.equal(before.execution_authorized,false);
  assert.equal(f.audit().length,1);
  assert.equal(f.audit()[0].event_type,'first_confirmation_received');
  const awaited=await f.handler.handle(f.get());
  assert.equal(awaited.status,200);
  assert.equal((await awaited.json()).status,'awaiting_second_confirmation');
  const after=await f.handler.handle(f.second(before.request_id));
  assert.equal(after.status,202);
  const pending=await after.json();
  assert.equal(pending.request_id,before.request_id);
  assert.equal(pending.status,'pending_processing');
  assert.equal(pending.second_confirmed_at,NOW);
  assert.equal(pending.physical_erasure_completed,false);
  assert.equal(pending.execution_authorized,false);
  assert.equal((await (await f.handler.handle(f.get())).json()).status,'pending_processing');
  assert.deepEqual(f.audit().map(a=>a.event_type).sort(),
   ['first_confirmation_received','second_confirmation_received']);
  assert.equal(f.requests().length,1);
  assert.equal(f.db.prepare('SELECT status FROM starry_members WHERE s_user_id=?').get('u1').status,'active');
  assert.equal(f.db.prepare('SELECT revoked_at FROM starry_sessions WHERE session_id=?').get('session-1').revoked_at,null);
  const all=JSON.stringify([...f.requests(),...f.audit()]);
  assert.equal(all.includes(f.t1),false);
  assert.equal(all.includes('subject-1'),false);
  assert.equal(all.includes('Private u1'),false);
  assert.equal(all.includes('hash-session'),false);
 }finally{f.close();}
});

test('two explicit confirmations mandatory; malformed phrases or cross-request ID never advance first step',async()=>{
 const f=await fixture();try{
  const phantom='m2del-'+'f'.repeat(48);
  assert.equal((await f.handler.handle(f.second(phantom))).status,404);
  for(const input of [
   {confirmation:'CONFIRM_MY_ACCOUNT_DELETION',request_id:phantom},
   {confirmation:'YES'}, {},{confirmation:FIRST_CONFIRMATION,role:'admin'},
   {confirmation:true}, {confirmation:SECOND_CONFIRMATION},
   {confirmation:SECOND_CONFIRMATION,request_id:'insecure'},
  ]){
   const req=f.request(M2_DELETE_REQUEST_PATH,f.t1,'POST',input);
   const result=await f.handler.handle(req);
   assert.equal(result.status,400);
  }
  assert.equal(f.requests().length,0);
  const record=await (await f.handler.handle(f.first())).json();
  const wrong=await f.handler.handle(f.second(phantom));
  assert.equal(wrong.status,404);
  assert.equal(f.requests()[0].status,'awaiting_second_confirmation');
  assert.equal(f.audit().length,1);
  const exact=await f.handler.handle(f.second(record.request_id));
  assert.equal(exact.status,202);
 }finally{f.close();}
});

test('idempotent retries and 20 parallel first/second calls have ONE row, exactly two audit events',async()=>{
 const f=await fixture();try{
  const first=await Promise.all(Array.from({length:20},()=>f.handler.handle(f.first())));
  assert.ok(first.every(r=>r.status===202));
  const IDs=await Promise.all(first.map(async r=>(await r.json()).request_id));
  assert.equal(new Set(IDs).size,1);
  assert.equal(f.requests().length,1);
  assert.equal(f.audit().length,1);
  const second=await Promise.all(Array.from({length:20},
   ()=>f.handler.handle(f.second(IDs[0]))));
  assert.ok(second.every(r=>r.status===202));
  assert.equal(f.requests().length,1);
  assert.equal(f.requests()[0].status,'pending_processing');
  assert.equal(f.audit().length,2);
  assert.equal(new Set(f.audit().map(x=>x.event_id)).size,2);
  const later=await f.handler.handle(f.first());
  assert.equal((await later.json()).status,'pending_processing');
  assert.equal(f.audit().length,2);
 }finally{f.close();}
});

test('cross-member cannot read or confirm another member request; each Session only sees own identity',async()=>{
 const f=await fixture();try{
  const one=await (await f.handler.handle(f.first())).json();
  assert.equal((await f.handler.handle(f.get(f.t2))).status,404);
  assert.equal((await f.handler.handle(f.second(one.request_id,f.t2))).status,404);
  const two=await (await f.handler.handle(f.first(f.t2))).json();
  assert.notEqual(one.request_id,two.request_id);
  assert.equal((await f.handler.handle(f.second(two.request_id))).status,404);
  assert.equal((await f.handler.handle(f.second(one.request_id))).status,202);
  assert.equal((await f.handler.handle(f.second(two.request_id,f.t2))).status,202);
  assert.equal(f.requests().length,2);
  assert.equal(f.audit().length,4);
  assert.equal((await (await f.handler.handle(f.get(f.t2))).json()).request_id,two.request_id);
 }finally{f.close();}
});

test('revoked, expired, suspended, unlinked and auth_version bumped Sessions deny all three operations',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='session-1'",
  "UPDATE starry_sessions SET expires_at=1793000000 WHERE session_id='session-1'",
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
  "DELETE FROM starry_identities WHERE subject='subject-1'",
  "UPDATE starry_sessions SET environment='development' WHERE session_id='session-1'",
 ]){
  const f=await fixture();try{
   f.db.exec(sql);
   assert.equal((await f.handler.handle(f.first())).status,401,sql);
   assert.equal((await f.handler.handle(f.get())).status,401,sql);
   assert.equal((await f.handler.handle(f.second('m2del-'+'a'.repeat(48)))).status,401,sql);
   assert.equal(f.requests().length,0);
   assert.equal(f.audit().length,0);
  }finally{f.close();}
 }
});

test('auth loses status, link, version or session while awaiting authoritative INSERT/UPDATE: no unauthorized committed receipt',async()=>{
 for(const phase of ['first','second']){
  for(const sql of [
   "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='session-1'",
   "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
   "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
   "DELETE FROM starry_identities WHERE subject='subject-1'",
  ]){
   const f=await fixture();try{
    let request;
    if(phase==='first')request=f.first();
    else{
     const one=await (await f.handler.handle(f.first())).json();
     request=f.second(one.request_id);
    }
    f.state.beforeWrite=()=>f.db.exec(sql);
    const result=await f.handler.handle(request);
    assert.notEqual(result.status,202,phase+':'+sql);
    assert.equal(f.requests().length,phase==='first'?0:1);
    assert.equal(f.audit().length,phase==='first'?0:1);
    if(phase==='second')assert.equal(f.requests()[0].status,'awaiting_second_confirmation');
   }finally{f.close();}
  }
 }
});

test('source audit insert or second confirmation audit failure rolls back source statement, no partial success',async()=>{
 for(const phase of ['first','second']){
  const f=await fixture();try{
   let req=f.first();
   if(phase==='second'){
    const first=await (await f.handler.handle(req)).json();
    req=f.second(first.request_id);
   }
   // Trigger error happens AFTER source INSERT/UPDATE; SQL statement MUST
   // atomically abort the source operation and NOT report HTTP accepted.
   f.db.exec("CREATE TRIGGER abort_delete_audit BEFORE INSERT ON starry_m2_deletion_request_audit BEGIN SELECT RAISE(ABORT,'PRIVATE_AUDIT_FAILURE'); END;");
   const result=await f.handler.handle(req);
   assert.equal(result.status,503);
   const response=await result.text();assert.equal(response.includes('PRIVATE_'),false);
   assert.equal(f.requests().length,phase==='first'?0:1);
   assert.equal(f.audit().length,phase==='first'?0:1);
   if(phase==='second')assert.equal(f.requests()[0].status,'awaiting_second_confirmation');
  }finally{f.close();}
 }
});

test('physical FK/delete still blocked: pending is NOT completed, member/profile and sessions unchanged',async()=>{
 const f=await fixture();try{
  const first=await (await f.handler.handle(f.first())).json();
  await f.handler.handle(f.second(first.request_id));
  assert.throws(()=>f.db.exec(
   "UPDATE starry_m2_deletion_requests SET status='completed' WHERE s_user_id='u1'"),
   /constraint/i);
  assert.throws(()=>f.db.exec("DELETE FROM starry_members WHERE s_user_id='u1'"),
   /FOREIGN KEY/i);
  assert.equal(f.requests()[0].status,'pending_processing');
  assert.equal(f.db.prepare("SELECT display_name FROM starry_members WHERE s_user_id='u1'").get().display_name,'Private u1');
  assert.equal(f.db.prepare("SELECT revoked_at FROM starry_sessions WHERE session_id='session-1'").get().revoked_at,null);
  assert.equal(f.audit().length,2);
 }finally{f.close();}
});

test('path, method, origin, query, proxy/cookie, wrong bearer/JSON/oversize deny before writing',async()=>{
 const f=await fixture();try{
  const denied=[
   new Request('https://bad.example'+M2_DELETE_REQUEST_PATH,{method:'POST'}),
   f.request(M2_DELETE_REQUEST_PATH+'?request_id=u2',f.t1,'POST',{confirmation:FIRST_CONFIRMATION}),
   f.request(M2_DELETE_REQUEST_PATH,f.t1,'GET'),
   f.request(M2_DELETE_CONFIRM_PATH,f.t1,'GET'),
   f.request(M2_DELETE_STATUS_PATH,f.t1,'POST',{confirmation:FIRST_CONFIRMATION}),
   f.request('/v1/starry-id/admin/deletion-requests',f.t1,'POST',{confirmation:FIRST_CONFIRMATION}),
   f.first(f.t1,{confirmation:FIRST_CONFIRMATION},{cookie:'sid=attacker'}),
   f.first(f.t1,{confirmation:FIRST_CONFIRMATION},{'x-forwarded-authorization':'Bearer forged'}),
   f.first(f.t1,{confirmation:FIRST_CONFIRMATION},{'x-forwarded-host':'bad.example'}),
   f.first(f.t1,{confirmation:FIRST_CONFIRMATION},{origin:'https://bad.example'}),
   f.first('not-a-session'),
   f.first(f.t1,{confirmation:FIRST_CONFIRMATION},{'content-type':'text/plain'}),
   f.first(f.t1,{confirmation:'x'.repeat(700)}),
   f.request(M2_DELETE_REQUEST_PATH,f.t1,'POST'),
  ];
  for(const req of denied){
   const result=await f.handler.handle(req);
   assert.notEqual(result.status,202);
   assert.equal(result.headers.get('cache-control'),'no-store');
  }
  assert.equal(f.requests().length,0);
  assert.equal(f.audit().length,0);
 }finally{f.close();}
});

test('clock leap, keyring outage, failed SQL never misreport confirmed or echo PII/keys',async()=>{
 for(const mode of ['clock','key','sql']){
  const f=await fixture();try{
   if(mode==='clock')f.state.time=NOW+400;
   if(mode==='sql')f.state.throwWrite=true;
   const dep=mode==='key'?
    {...f.deps,getVerificationKey:async()=>{throw Error('PRIVATE_KEYRING');}}:
    f.deps;
   const handler=createM2LocalDeletionRequestHandler(dep);
   const result=await handler.handle(f.first());
   assert.notEqual(result.status,202);
   const text=await result.text();
   for(const privateText of ['PRIVATE_','subject-1','Private u1',f.t1])
    assert.equal(text.includes(privateText),false);
   assert.equal(f.requests().length,0);
   assert.equal(f.audit().length,0);
  }finally{f.close();}
 }
});
