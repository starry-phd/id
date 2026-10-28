import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {signServerSession} from '../src/session-crypto.ts';
import {createOfflineR004EventBoundSessionFence,R004_SESSION_FENCE_VERSION,
 R004_SESSION_FENCE_LIVE} from '../src/wave1-round004-event-session-fence.ts';

const NOW=1793000000,origin='https://id.starry.example';
const scope=(app_id='starry.one',environment='staging')=>({brand_id:'starry',app_id,environment});
async function fixture(){
 const raw=new DatabaseSync(':memory:');
 raw.exec('PRAGMA foreign_keys=ON');
 raw.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 raw.exec("CREATE TABLE synthetic_session_epoch(session_id TEXT PRIMARY KEY,version INTEGER NOT NULL)");
 for(const [u,sub] of [['u1','sub-one'],['u2','sub-two']]){
  raw.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(u,'active',3,1,null,0,0,NOW,NOW);
  raw.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .run('apple',sub,u);
  raw.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run('session-'+u,u,'starry.one','staging',3,
    'a'.repeat(63)+(u==='u1'?'1':'2'),NOW+300,null,null,null);
  raw.prepare('INSERT INTO synthetic_session_epoch(session_id,version) VALUES(?,?)')
   .run('session-'+u,5);
 }
 const state={dbReads:0,sourceReads:0,actorReads:0,epochReads:0,
  sourceOut:false,keyOut:false,rotate:false,revocationAtSecond:false,
  changeActor:false,sourceEventSwitch:false,epochStale:false};
 const authDb={prepare(sql){
  assert.match(sql,/^SELECT /);state.dbReads++;
  return {bind(...args){return {first:async()=>{
   if(state.revocationAtSecond&&state.sourceReads>=2)
    raw.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-u1'");
   return raw.prepare(sql).get(...args)??null;
  }};}};
 }};
 const sessionKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
  false,['sign','verify']);
 const digestA=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const digestB=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const eventKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const event=(overrides={})=>({
  brand_id:'starry',app_id:'starry.one',environment:'staging',
  event_id:'event-000001',actor_ref:'actor-000001',
  event_type:'notification.delivery.queued',auth_version:3,
  session_version:5,issuer_kid:'synthetic-issuer',
  issuer_epoch:1,issued_at:NOW-10,...overrides});
 const makeEvent=async(body=event())=>({
  body, signature:Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',eventKey,
   new TextEncoder().encode(JSON.stringify(body)))))
  .map(b=>b.toString(16).padStart(2,'0')).join('')
 });
 const token=async(u='u1')=>signServerSession({
  brand_id:'starry',app_id:'starry.one',environment:'staging',
  provider:'apple',provider_subject:u==='u1'?'sub-one':'sub-two',
  s_user_id:u,session_id:'session-'+u,
  auth_version:3,expires_at:NOW+300,issued_at:NOW,key_id:'session-kid'
 },scope(),NOW,{kid:'session-kid',key:sessionKey});
 const request=async(u='u1')=>new Request(origin+'/private',{method:'POST',
  headers:{authorization:'Bearer '+await token(u)}});
 const config=(s=scope())=>({
  enabled:true,serverScope:s,expectedOrigin:origin,authDb,
  getVerificationKey:async kid=>state.keyOut?null:kid==='session-kid'?sessionKey:null,
  readActiveDigestKey:async()=>({kid:state.rotate?'digest-2':'digest-1',
   epoch:state.rotate?2:1,key:state.rotate?digestB:digestA}),
  verifyCanonicalSource:async delivery=>{
   state.sourceReads++;
   if(state.sourceOut)return null;
   const v=delivery;
   if(!v||typeof v!=='object'||!v.body||typeof v.signature!=='string')return null;
   const bytes=Uint8Array.from(v.signature.match(/.{2}/g)??[],x=>parseInt(x,16));
   if(bytes.length!==32)return null;
   const ok=await crypto.subtle.verify('HMAC',eventKey,bytes,
    new TextEncoder().encode(JSON.stringify(v.body)));
   if(!ok)return null;
   return state.sourceEventSwitch&&state.sourceReads>1?
    {...v.body,event_id:'event-changed'}:v.body;
  },
  resolveEventActor:async e=>{
   state.actorReads++;
   return {brand_id:'starry',app_id:e.app_id,environment:e.environment,
    event_id:e.event_id,actor_ref:state.changeActor&&state.actorReads>1?
     'actor-changed':e.actor_ref,
    s_user_id:'u1',session_id:'session-u1',provider:'apple',
    provider_subject:'sub-one',auth_version:e.auth_version,
    session_version:e.session_version};
  },
  readSessionEpoch:async binding=>{
   state.epochReads++;
   const row=raw.prepare('SELECT version FROM synthetic_session_epoch WHERE session_id=?')
    .get(binding.session_id);
   return row?{session_id:binding.session_id,app_id:'starry.one',
    environment:'staging',version:state.epochStale?4:row.version}:null;
  }
 });
 const port=(s=scope())=>createOfflineR004EventBoundSessionFence(config(s));
 return {raw,state,config,port,makeEvent,event,request,close(){raw.close();}};
}
function safe(v,status){
 assert.equal(v.contract,R004_SESSION_FENCE_VERSION);
 assert.equal(v.status,status);
 for(const key of ['verified_live','may_send','may_enqueue','may_ack_queue',
  'may_grant','may_charge','may_publish'])assert.equal(v[key],false);
 const s=JSON.stringify(v);
 for(const leak of ['u1','sub-one','session-u1','actor-000001','event-000001',
  'issuer_kid','digest','token','member_digest'])assert.equal(s.includes(leak),false,leak);
}
test('R004 OFF by default; forged source flags and unsigned body never touch Auth SQL',async()=>{
 const f=await fixture();try{
  assert.equal(R004_SESSION_FENCE_LIVE,false);
  const b=createOfflineR004EventBoundSessionFence({...f.config(),enabled:false});
  safe(await b.readEventBoundCurrentSession(await f.makeEvent(),await f.request(),NOW),'blocked');
  assert.equal(f.state.dbReads,0);
  safe(await f.port().readEventBoundCurrentSession(
   {...f.event(),signature_verified:true},await f.request(),NOW),'blocked');
  assert.equal(f.state.dbReads,0);
 }finally{f.close();}
});
test('synthetic HMAC source followed by real R003/R23 signed Session + two SQL current fences',async()=>{
 const f=await fixture();try{
  const b=f.port(),v=await b.readEventBoundCurrentSession(await f.makeEvent(),await f.request(),NOW);
  safe(v,'review_only');
  assert.ok(f.state.dbReads>=12);
  assert.equal(f.state.sourceReads,2);
  const p=b.readServerFence(v);
  assert.equal(p.state,'active');
  assert.equal(p.event_id,'event-000001');
  assert.equal(p.session_version,5);
  assert.equal(p.verified_live,false);
  assert.equal(p.may_ack_queue,false);
  assert.equal(b.readServerFence(v),null);
  assert.equal(b.readServerFence({...v}),null);
 }finally{f.close();}
});
test('same event replay denied in-process, even with a different signed source',async()=>{
 const f=await fixture();try{
  const b=f.port(),e=await f.makeEvent();
  safe(await b.readEventBoundCurrentSession(e,await f.request(),NOW),'review_only');
  safe(await b.readEventBoundCurrentSession(e,await f.request(),NOW),'blocked');
 }finally{f.close();}
});
test('cross App, brand and environment fail after synthetic signature verification, before Auth read',async()=>{
 for(const body of [
  {app_id:'starry.other'},{brand_id:'hglobal'},{environment:'production'},
  {event_id:'bad'},{issued_at:NOW+1},{issued_at:NOW-400}
 ]){
  const f=await fixture();try{
   const e=await f.makeEvent(f.event(body));
   safe(await f.port().readEventBoundCurrentSession(e,await f.request(),NOW),'blocked');
   assert.equal(f.state.dbReads,0);
  }finally{f.close();}
 }
});
test('forged signature, changed issuer, and actor binding mismatch fail closed',async()=>{
 const f=await fixture();try{
  const b=f.port(),e=await f.makeEvent();
  safe(await b.readEventBoundCurrentSession({...e,signature:'0'.repeat(64)},
   await f.request(),NOW),'blocked');
  assert.equal(f.state.dbReads,0);
  f.state.changeActor=true;
  safe(await b.readEventBoundCurrentSession(e,await f.request(),NOW),'blocked');
  f.state.changeActor=false;f.state.sourceReads=0;f.state.sourceEventSwitch=true;
  safe(await b.readEventBoundCurrentSession(e,await f.request(),NOW),'blocked');
 }finally{f.close();}
});
test('late revoke/changed session during two reads blocks notification candidate',async()=>{
 const f=await fixture();try{
  f.state.revocationAtSecond=true;
  safe(await f.port().readEventBoundCurrentSession(await f.makeEvent(),
   await f.request(),NOW),'blocked');
 }finally{f.close();}
});
test('wrong account signed token, suspended/deleted member, revoked session all denied',async()=>{
 for(const sql of [
  null,
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
  "UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-u1'",
  "DELETE FROM starry_identities WHERE s_user_id='u1'"
 ]){
  const f=await fixture();try{
   if(sql)f.raw.exec(sql);
   safe(await f.port().readEventBoundCurrentSession(await f.makeEvent(),
    await f.request(sql? 'u1':'u2'),NOW),'blocked');
  }finally{f.close();}
 }
});
test('missing monotonic version, epoch rollback and retired Session KID deny',async()=>{
 const f=await fixture();try{
  f.state.epochStale=true;
  safe(await f.port().readEventBoundCurrentSession(await f.makeEvent(),
   await f.request(),NOW),'blocked');
  f.state.epochStale=false;f.state.keyOut=true;
  safe(await f.port().readEventBoundCurrentSession(await f.makeEvent(),
   await f.request(),NOW),'blocked');
 }finally{f.close();}
});
test('signed revoked/deleted event audits are review-only, never notification rights',async()=>{
 for(const kind of ['identity.session.revoked','identity.member.deleted']){
  const f=await fixture();try{
   f.raw.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-u1'");
   if(kind==='identity.member.deleted')f.raw.exec("UPDATE starry_members SET status='deleted',auth_version=4 WHERE s_user_id='u1'");
   const b=f.port();
   const v=await b.readEventBoundCurrentSession(
    await f.makeEvent(f.event({event_type:kind})),null,NOW);
   safe(v,'review_only');
   const p=b.readServerFence(v);
   assert.equal(p.state,kind==='identity.session.revoked'?'revoked':'deleted');
   assert.equal(p.may_send,false);
  }finally{f.close();}
 }
});
test('missing actor metadata or changed authoritative session epoch remains blocked',async()=>{
 const f=await fixture();try{
  f.raw.exec("UPDATE synthetic_session_epoch SET version=6 WHERE session_id='session-u1'");
  safe(await f.port().readEventBoundCurrentSession(await f.makeEvent(),
   await f.request(),NOW),'blocked');
  f.raw.exec("DELETE FROM synthetic_session_epoch WHERE session_id='session-u1'");
  safe(await f.port().readEventBoundCurrentSession(await f.makeEvent(),
   await f.request(),NOW),'blocked');
 }finally{f.close();}
});
