import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {signServerSession} from '../src/session-crypto.ts';
import {createOfflineR005SealedEventSessionAuthority,
 R005_ENVELOPE_AUTH_VERSION,R005_ENVELOPE_AUTH_LIVE,
 r005EnvelopeSigningBytes} from '../src/wave1-round005-sealed-event-session-authority.ts';
import {R004_SESSION_FENCE_VERSION} from '../src/wave1-round004-event-session-fence.ts';

const NOW=1793000000,ORIGIN='https://id.starry.example';
const scope=(app_id='starry.one',environment='staging')=>({
 brand_id:'starry',app_id,environment
});
async function fixture(){
 const raw=new DatabaseSync(':memory:');
 raw.exec('PRAGMA foreign_keys=ON');
 raw.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 raw.exec('CREATE TABLE synthetic_epoch(session_id TEXT PRIMARY KEY,version INTEGER NOT NULL)');
 for(const [u,sub] of [['u1','sub-one'],['u2','sub-two']]){
  raw.prepare('INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(u,'active',3,1,null,0,0,NOW,NOW);
  raw.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
   .run('apple',sub,u);
  raw.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run('session-'+u,u,'starry.one','staging',3,
    'a'.repeat(63)+(u==='u1'?'1':'2'),NOW+300,null,null,null);
  raw.prepare('INSERT INTO synthetic_epoch(session_id,version) VALUES(?,?)')
   .run('session-'+u,5);
 }
 const state={dbReads:0,issuerReads:0,keySwitchRead:0,keyUnavailable:false,
  digestUnavailable:false,sessionKeyUnavailable:false,
  lateRevoke:false,actorSwitch:false,actorReads:0,epochOverride:null,
  actorGone:false};
 const db={prepare(sql){
  assert.match(sql,/^SELECT /);
  state.dbReads++;
  return {bind(...args){return {first:async()=>{
   if(state.lateRevoke&&state.issuerReads>=3)
    raw.exec("UPDATE starry_sessions SET revoked_at="+NOW+
     " WHERE session_id='session-u1'");
   return raw.prepare(sql).get(...args)??null;
  }};}};
 }};
 const sessionKey=await crypto.subtle.generateKey({
  name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const digestKey=await crypto.subtle.generateKey({
  name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const issuerKey=await crypto.subtle.generateKey({
  name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const rotatedIssuerKey=await crypto.subtle.generateKey({
  name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const envelope=(extra={})=>({
  version:R005_ENVELOPE_AUTH_VERSION,purpose:'p05_auth_review_only',
  brand_id:'starry',app_id:'starry.one',environment:'staging',
  event_id:'event-000001',actor_ref:'actor-000001',
  event_type:'notification.delivery.queued',auth_version:3,session_version:5,
  issuer_kid:'synthetic-key-1',issuer_epoch:1,
  issued_at:NOW-2,expires_at:NOW+20,nonce:'nonce-000001',...extra
 });
 const sign=async (body=envelope(),key=issuerKey)=>{
  const bytes=r005EnvelopeSigningBytes(body);
  assert.ok(bytes);
  return {envelope:body,mac:Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',
    key,bytes))).map(b=>b.toString(16).padStart(2,'0')).join('')};
 };
 const token=async(u='u1')=>signServerSession({
  brand_id:'starry',app_id:'starry.one',environment:'staging',
  provider:'apple',provider_subject:u==='u1'?'sub-one':'sub-two',
  s_user_id:u,session_id:'session-'+u,auth_version:3,
  expires_at:NOW+300,issued_at:NOW,key_id:'session-kid'
 },scope(),NOW,{kid:'session-kid',key:sessionKey});
 const request=async(u='u1')=>new Request(ORIGIN+'/private',{
  method:'POST',headers:{authorization:'Bearer '+await token(u)}
 });
 const deps=(overrides={})=>({
  enabled:true,serverScope:scope(),expectedOrigin:ORIGIN,authDb:db,
  getVerificationKey:async kid=>state.sessionKeyUnavailable?null:
   kid==='session-kid'?sessionKey:null,
  readActiveDigestKey:async()=>state.digestUnavailable?null:
   {kid:'digest-r005',epoch:3,key:digestKey},
  readCurrentIssuerKey:async()=>{
   state.issuerReads++;
   if(state.keyUnavailable)return null;
   const rotated=state.keySwitchRead>0&&state.issuerReads>=state.keySwitchRead;
   return {kid:rotated?'synthetic-key-2':'synthetic-key-1',
    epoch:rotated?2:1,key:rotated?rotatedIssuerKey:issuerKey};
  },
  resolveEventActor:async e=>{
   state.actorReads++;
   if(state.actorGone)return null;
   return {brand_id:'starry',app_id:e.app_id,environment:e.environment,
    event_id:e.event_id,actor_ref:state.actorSwitch&&state.actorReads>=2?
     'actor-changed':e.actor_ref,
    s_user_id:'u1',session_id:'session-u1',provider:'apple',
    provider_subject:'sub-one',auth_version:e.auth_version,
    session_version:e.session_version};
  },
  readSessionEpoch:async binding=>{
   const row=raw.prepare('SELECT version FROM synthetic_epoch WHERE session_id=?')
    .get(binding.session_id);
   return row?{session_id:binding.session_id,app_id:'starry.one',
    environment:'staging',version:state.epochOverride??row.version}:null;
  },
  ...overrides
 });
 return {raw,state,db,sessionKey,issuerKey,rotatedIssuerKey,
  envelope,sign,request,deps,port:(o={})=>
   createOfflineR005SealedEventSessionAuthority(deps(o)),
  close:()=>raw.close()};
}
function safe(v,status,reason=null){
 assert.equal(v.contract,R005_ENVELOPE_AUTH_VERSION);
 assert.equal(v.status,status);
 if(reason)assert.equal(v.reason,reason);
 for(const flag of ['verified_live','may_send','may_ack_queue','may_grant',
  'may_charge','may_publish'])assert.equal(v[flag],false);
 const json=JSON.stringify(v);
 for(const secret of ['event-000001','actor-000001','session-u1','sub-one',
  'digest-r005','issuer_kid','synthetic-key-1','member_digest','nonce-000001'])
  assert.equal(json.includes(secret),false,secret);
}
test('default OFF, absence of real issuer gate and public hard-deny contract',async()=>{
 const f=await fixture();try{
  assert.equal(R005_ENVELOPE_AUTH_LIVE,false);
  const p=f.port({enabled:false});
  safe(await p.reviewFresh(await f.sign(),await f.request(),NOW),
   'blocked','DISABLED');
  assert.equal(f.state.dbReads,0);
  assert.equal(f.state.issuerReads,0);
 }finally{f.close();}
});
test('real ephemeral WebCrypto MAC + real R004/R003 signed Auth/SQLite: review-only',async()=>{
 const f=await fixture();try{
  const p=f.port(),v=await p.reviewFresh(await f.sign(),await f.request(),NOW);
  safe(v,'review_only','AUTH_REVIEW_ONLY');
  assert.ok(f.state.dbReads>=12);
  assert.equal(f.state.issuerReads,4);
  const privateReview=p.readServerReview(v);
  assert.equal(privateReview.session_fence_contract,R004_SESSION_FENCE_VERSION);
  assert.equal(privateReview.event_id,'event-000001');
  assert.equal(privateReview.issuer_epoch,1);
  assert.equal(privateReview.may_ack_queue,false);
  assert.equal(p.readServerReview(v),null);
  assert.equal(p.readServerReview({...v}),null);
 }finally{f.close();}
});
test('unsigned caller verified:true and tampered MAC never read current Auth SQL',async()=>{
 const f=await fixture();try{
  const p=f.port();
  safe(await p.reviewFresh({...f.envelope(),signature_verified:true},
   await f.request(),NOW),'blocked');
  assert.equal(f.state.dbReads,0);
  const b=await f.sign();
  safe(await p.reviewFresh({...b,mac:'0'.repeat(64)},await f.request(),NOW),
   'blocked');
  assert.equal(f.state.dbReads,0);
 }finally{f.close();}
});
test('modified event_id, actor_ref, type, version, nonce, app after signing deny',async()=>{
 for(const changed of [{event_id:'event-000002'},{actor_ref:'actor-000002'},
  {event_type:'identity.member.deleted'},{auth_version:4},
  {session_version:6},{nonce:'nonce-000002'},{app_id:'starry.two'}]){
  const f=await fixture();try{
   const b=await f.sign();
   safe(await f.port().reviewFresh({...b,envelope:{...b.envelope,...changed}},
    await f.request(),NOW),'blocked');
   assert.equal(f.state.dbReads,0);
  }finally{f.close();}
 }
});
test('same signed event replay and different actor re-sign using SAME event id deny',async()=>{
 const f=await fixture();try{
  const p=f.port();
  safe(await p.reviewFresh(await f.sign(),await f.request(),NOW),'review_only');
  safe(await p.reviewFresh(await f.sign(),await f.request(),NOW),
   'blocked','REPLAY_BLOCKED');
  safe(await p.reviewFresh(await f.sign(f.envelope({actor_ref:'actor-000002'})),
   await f.request(),NOW),'blocked','REPLAY_BLOCKED');
 }finally{f.close();}
});
test('changed signer key/KID epoch mid-verification must fail closed',async()=>{
 for(const readNo of [2,3,4]){
  const f=await fixture();try{
   f.state.keySwitchRead=readNo;
   const v=await f.port().reviewFresh(await f.sign(),await f.request(),NOW);
   safe(v,'blocked');
   assert.equal(v.may_ack_queue,false);
  }finally{f.close();}
 }
});
test('source and key availability outage deny before any Auth DB read',async()=>{
 const f=await fixture();try{
  f.state.keyUnavailable=true;
  safe(await f.port().reviewFresh(await f.sign(),await f.request(),NOW),
   'blocked','ISSUER_UNAVAILABLE');
  assert.equal(f.state.dbReads,0);
 }finally{f.close();}
});
test('exact own-data envelope: no getters, extra properties or symbols',async()=>{
 const f=await fixture();try{
  const signed=await f.sign();
  const bad=[
   {...signed,envelope:{...signed.envelope,extra:1}},
   {...signed,envelope:Object.create({event_id:'event-000001'})},
   {...signed,extra:1},
   {...signed,envelope:Object.defineProperty({...signed.envelope},
    'event_id',{get(){throw Error('hostile getter');},enumerable:true})},
   {...signed,envelope:{...signed.envelope,[Symbol('secret')]:true}},
   {...signed,mac:signed.mac.toUpperCase()}
  ];
  for(const item of bad)safe(await f.port().reviewFresh(item,
   await f.request(),NOW),'blocked');
  assert.equal(f.state.dbReads,0);
 }finally{f.close();}
});
test('wrong app/brand/environment, production and invalid event time windows',async()=>{
 for(const patch of [{app_id:'other.app'},{brand_id:'hglobal'},
  {environment:'production'},{issued_at:NOW+1,expires_at:NOW+20},
  {issued_at:NOW-61,expires_at:NOW-1},
  {issued_at:NOW-2,expires_at:NOW+61},
  {issued_at:NOW-2,expires_at:NOW}]){
  const f=await fixture();try{
   const signed=await f.sign(f.envelope(patch));
   safe(await f.port().reviewFresh(signed,await f.request(),NOW),'blocked');
   assert.equal(f.state.dbReads,0);
  }finally{f.close();}
 }
});
test('signed actor may not switch on second Auth check',async()=>{
 const f=await fixture();try{
  f.state.actorSwitch=true;
  safe(await f.port().reviewFresh(await f.sign(),await f.request(),NOW),
   'blocked');
 }finally{f.close();}
});
test('latest revoke after first signed source check denies current delivery',async()=>{
 const f=await fixture();try{
  f.state.lateRevoke=true;
  safe(await f.port().reviewFresh(await f.sign(),await f.request(),NOW),
   'blocked');
 }finally{f.close();}
});
test('wrong signed member account, suspension/deletion and deleted provider deny',async()=>{
 for(const sql of [null,
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "DELETE FROM starry_identities WHERE s_user_id='u1'"]){
  const f=await fixture();try{
   if(sql)f.raw.exec(sql);
   safe(await f.port().reviewFresh(await f.sign(),
    await f.request(sql?'u1':'u2'),NOW),'blocked');
  }finally{f.close();}
 }
});
test('session_version epoch rollback and KID/session verification failures deny',async()=>{
 for(const change of ['epoch','session','digest','mapping']){
  const f=await fixture();try{
   if(change==='epoch')f.state.epochOverride=4;
   if(change==='session')f.state.sessionKeyUnavailable=true;
   if(change==='digest')f.state.digestUnavailable=true;
   if(change==='mapping')f.state.actorGone=true;
   safe(await f.port().reviewFresh(await f.sign(),await f.request(),NOW),
    'blocked');
  }finally{f.close();}
 }
});
test('synthetic signed deletion audit is only candidate review; never ACK',async()=>{
 const f=await fixture();try{
  f.raw.exec("UPDATE starry_sessions SET revoked_at="+NOW+
    " WHERE session_id='session-u1'");
  f.raw.exec("UPDATE starry_members SET status='deleted',auth_version=4"+
    " WHERE s_user_id='u1'");
  const v=await f.port().reviewFresh(
   await f.sign(f.envelope({event_type:'identity.member.deleted'})),null,NOW);
  safe(v,'blocked'); // current version drift requires separate legal Gate.
 }finally{f.close();}
});

test('unauthenticated forged MAC cannot consume legitimate event replay identifier',async()=>{
 const f=await fixture();try{
  const p=f.port(),signed=await f.sign();
  safe(await p.reviewFresh({...signed,mac:'0'.repeat(64)},
   await f.request(),NOW),'blocked');
  assert.equal(f.state.dbReads,0);
  safe(await p.reviewFresh(signed,await f.request(),NOW),
   'review_only','AUTH_REVIEW_ONLY');
  safe(await p.reviewFresh(signed,await f.request(),NOW),
   'blocked','REPLAY_BLOCKED');
 }finally{f.close();}
});
test('hostile event type object cannot execute coercive toString before signature validation',async()=>{
 const f=await fixture();try{
  const signed=await f.sign();
  const hostile={toString(){throw Error('event-type side-effect');}};
  safe(await f.port().reviewFresh({...signed,
   envelope:{...signed.envelope,event_type:hostile}},
   await f.request(),NOW),'blocked','INVALID_ENVELOPE');
  assert.equal(f.state.dbReads,0);
 }finally{f.close();}
});
