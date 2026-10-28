import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {signServerSession} from '../src/session-crypto.ts';
import {
 R006_AI0_P05_VERSION,R006_AI0_P05_PURPOSE,R006_AI0_P05_DOMAIN,
 R006_P05_FIELDS,R006_AUTH_ADAPTER_VERSION,R006_AUTH_ADAPTER_LIVE,
 r006VNextSigningBytes,createOfflineR006P05VNextAuthAdapter
} from '../src/wave1-round006-p05-vnext-auth-adapter.ts';

const NOW=1793000000,ORIGIN='https://id.starry.example';
const scope=(app_id='starry.one',environment='staging')=>({
 brand_id:'starry',app_id,environment
});
async function fixture(){
 const raw=new DatabaseSync(':memory:');
 raw.exec('PRAGMA foreign_keys=ON');
 raw.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 raw.exec('CREATE TABLE synthetic_session_epoch(session_id TEXT PRIMARY KEY,version INTEGER NOT NULL)');
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
 const state={dbReads:0,keyReads:0,rotateOn:0,keyOut:false,
  authKeyOut:false,digestOut:false,lateRevoke:false,
  actorReads:0,actorSwitch:false,actorMissing:false,epochVersion:null};
 const authDb={prepare(sql){
  assert.match(sql,/^SELECT /);state.dbReads++;
  return {bind(...args){return {first:async()=>{
   if(state.lateRevoke&&state.keyReads>=3)
    raw.exec("UPDATE starry_sessions SET revoked_at="+NOW+" WHERE session_id='session-u1'");
   return raw.prepare(sql).get(...args)??null;
  }};}};
 }};
 const sessionKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
  false,['sign','verify']);
 const digestKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
  false,['sign']);
 // The TEST ONLY signing key is exportable for separate nonextractable verify-only
 // key import. Runtime adapter never signs or exports any key.
 const createIssuer=async()=>{
  const signer=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
   true,['sign','verify']);
  const rawKey=await crypto.subtle.exportKey('raw',signer);
  const verifier=await crypto.subtle.importKey('raw',rawKey,
   {name:'HMAC',hash:'SHA-256'},false,['verify']);
  return {signer,verifier};
 };
 const k1=await createIssuer(),k2=await createIssuer();
 const envelope=(extra={})=>({
  version:R006_AI0_P05_VERSION,purpose:R006_AI0_P05_PURPOSE,
  brand_id:'starry',app_id:'starry.one',environment:'staging',
  event_id:'event-000001',event_type:'notification.delivery.queued',
  actor_ref:'actor-000001',auth_version:3,session_version:5,
  idempotency_key:'idempotency-000001',issuer_kid:'issuer-001',
  issuer_epoch:1,issued_at:NOW-2,expires_at:NOW+30,
  nonce:'nonce_000000000001',payload_sha256:'a'.repeat(64),...extra
 });
 const signed=async(body=envelope(),key=k1.signer)=>{
  const bytes=r006VNextSigningBytes(body);assert.ok(bytes);
  const mac=await crypto.subtle.sign('HMAC',key,bytes);
  return {envelope:body,mac_hex:Array.from(new Uint8Array(mac))
   .map(x=>x.toString(16).padStart(2,'0')).join('')};
 };
 const token=async (u='u1')=>signServerSession({
  brand_id:'starry',app_id:'starry.one',environment:'staging',
  provider:'apple',provider_subject:u==='u1'?'sub-one':'sub-two',
  s_user_id:u,session_id:'session-'+u,
  auth_version:3,expires_at:NOW+300,issued_at:NOW,key_id:'session-kid'
 },scope(),NOW,{kid:'session-kid',key:sessionKey});
 const request=async (u='u1')=>new Request(ORIGIN+'/private',{
  method:'POST',headers:{authorization:'Bearer '+await token(u)}
 });
 const deps=(extra={})=>({
  enabled:true,serverScope:scope(),expectedOrigin:ORIGIN,authDb,
  getVerificationKey:async kid=>state.authKeyOut?null:
   kid==='session-kid'?sessionKey:null,
  readActiveDigestKey:async()=>state.digestOut?null:
   {kid:'digest-001',epoch:1,key:digestKey},
  readCurrentIssuerKey:async()=>{
   state.keyReads++;
   if(state.keyOut)return null;
   const rotated=state.rotateOn!==0&&state.keyReads>=state.rotateOn;
   return rotated?{kid:'issuer-002',epoch:2,key:k2.verifier}:
    {kid:'issuer-001',epoch:1,key:k1.verifier};
  },
  resolveEventActor:async e=>{
   state.actorReads++;
   if(state.actorMissing)return null;
   return {brand_id:'starry',app_id:e.app_id,environment:e.environment,
    event_id:e.event_id,actor_ref:state.actorSwitch&&state.actorReads>1?
     'actor-changed':e.actor_ref,
    s_user_id:'u1',session_id:'session-u1',provider:'apple',
    provider_subject:'sub-one',auth_version:e.auth_version,
    session_version:e.session_version};
  },
  readSessionEpoch:async b=>{
   const row=raw.prepare('SELECT version FROM synthetic_session_epoch WHERE session_id=?')
    .get(b.session_id);
   return row?{session_id:b.session_id,app_id:'starry.one',
    environment:'staging',version:state.epochVersion??row.version}:null;
  },...extra
 });
 return {raw,state,k1,k2,envelope,signed,request,deps,
  port:(extra={})=>createOfflineR006P05VNextAuthAdapter(deps(extra)),
  close:()=>raw.close()};
}
function safe(v,status,reason=null){
 assert.equal(v.contract,R006_AUTH_ADAPTER_VERSION);
 assert.equal(v.wire_version,R006_AI0_P05_VERSION);
 assert.equal(v.status,status);
 if(reason)assert.equal(v.reason,reason);
 for(const k of ['verified_live','may_read_live','may_write_d1','may_send',
  'may_enqueue','may_ack_queue','may_grant','may_purchase','may_charge',
  'may_publish'])assert.equal(v[k],false,k);
 const out=JSON.stringify(v);
 for(const secret of ['event-000001','actor-000001','session-u1','sub-one',
  'nonce_000000000001','issuer_kid','payload_sha256','idempotency-000001',
  'digest-001','member_digest'])assert.equal(out.includes(secret),false,secret);
}
test('AI-0 exact 17 fields/domain/reference bytes pinned, never an issuer',()=>{
 assert.equal(R006_AUTH_ADAPTER_LIVE,false);
 assert.equal(R006_P05_FIELDS.length,17);
 assert.equal(R006_AI0_P05_DOMAIN,
  'starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1');
 const e={
  version:R006_AI0_P05_VERSION,purpose:R006_AI0_P05_PURPOSE,
  brand_id:'starry',app_id:'starry.one',environment:'staging',
  event_id:'event-000001',event_type:'notification.delivery.queued',
  actor_ref:'actor-000001',auth_version:3,session_version:5,
  idempotency_key:'idempotency-000001',issuer_kid:'issuer-001',
  issuer_epoch:1,issued_at:NOW-2,expires_at:NOW+30,
  nonce:'nonce_000000000001',payload_sha256:'a'.repeat(64)
 };
 const arr=JSON.parse(new TextDecoder().decode(r006VNextSigningBytes(e)));
 assert.equal(arr.length,18);
 assert.equal(arr[0],R006_AI0_P05_DOMAIN);
 assert.deepEqual(arr.slice(1),R006_P05_FIELDS.map(k=>e[k]));
});
test('default disabled blocks before key reads/SQL',async()=>{
 const f=await fixture();try{
  const p=f.port({enabled:false});
  safe(await p.reviewFresh(await f.signed(),await f.request(),NOW),
   'blocked','DISABLED');
  assert.equal(f.state.dbReads,0);assert.equal(f.state.keyReads,0);
 }finally{f.close();}
});
test('synthetic HMAC vNext passes review-only via REAL R004/R003 signed Auth SQL',async()=>{
 const f=await fixture();try{
  assert.equal(f.k1.verifier.extractable,false);
  assert.deepEqual(f.k1.verifier.usages,['verify']);
  const p=f.port(),v=await p.reviewFresh(await f.signed(),await f.request(),NOW);
  safe(v,'review_only','REVIEW_ONLY_NOT_AUTHORIZED');
  assert.ok(f.state.dbReads>=12);
  assert.equal(f.state.keyReads,4);
  const privateProof=p.readServerReview(v);
  assert.equal(privateProof.event_id,'event-000001');
  assert.equal(privateProof.session_version,5);
  assert.equal(privateProof.payload_sha256,'a'.repeat(64));
  assert.equal(privateProof.may_ack_queue,false);
  assert.equal(p.readServerReview(v),null);
  assert.equal(p.readServerReview({...v}),null);
 }finally{f.close();}
});
test('R005 AI-0/AI-1 wire formats and domains never auto-authorize vNext',async()=>{
 const f=await fixture();try{
  const p=f.port(),e=f.envelope(),request=await f.request();
  for(const old of [
   {event:e,signature_hex:'0'.repeat(64)},
   {envelope:e,mac:'0'.repeat(64)},
   {envelope:{...e,version:'starry.auth.p05-envelope-r005.v1-offline-candidate'},
    mac_hex:'0'.repeat(64)}
  ])safe(await p.reviewFresh(old,request,NOW),'blocked');
  assert.equal(f.state.dbReads,0);
 }finally{f.close();}
});
test('tampered MAC and forged source boolean do not touch Auth SQL or poison event',async()=>{
 const f=await fixture();try{
  const p=f.port(),e=await f.signed(),request=await f.request();
  safe(await p.reviewFresh({...e,mac_hex:'0'.repeat(64)},request,NOW),'blocked');
  safe(await p.reviewFresh({...e,signature_verified:true},request,NOW),'blocked');
  assert.equal(f.state.dbReads,0);
  safe(await p.reviewFresh(e,request,NOW),'review_only');
 }finally{f.close();}
});
test('signed event_id/actor_ref/nonce/idempotency/payload tamper rejected before SQL',async()=>{
 for(const patch of [{event_id:'event-000002'},{actor_ref:'actor-000002'},
  {nonce:'nonce_000000000002'},{idempotency_key:'idempotency-000002'},
  {payload_sha256:'b'.repeat(64)},{auth_version:4},{session_version:6}]){
  const f=await fixture();try{
   const e=await f.signed();
   safe(await f.port().reviewFresh(
    {...e,envelope:{...e.envelope,...patch}},await f.request(),NOW),'blocked');
   assert.equal(f.state.dbReads,0);
  }finally{f.close();}
 }
});
test('local duplicate event, same nonce, same idempotency key all deny after valid MAC',async()=>{
 const f=await fixture();try{
  const p=f.port(),r=await f.request();
  safe(await p.reviewFresh(await f.signed(),r,NOW),'review_only');
  safe(await p.reviewFresh(await f.signed(),r,NOW),'blocked','REPLAY_DENIED');
  safe(await p.reviewFresh(await f.signed(f.envelope({
   event_id:'event-000002',actor_ref:'actor-000002'})),r,NOW),
   'blocked','REPLAY_DENIED');
  safe(await p.reviewFresh(await f.signed(f.envelope({
   event_id:'event-000003',idempotency_key:'idempotency-000003'})),r,NOW),
   'blocked','REPLAY_DENIED');
 }finally{f.close();}
});
test('KID/epoch rotation at any verification step denies',async()=>{
 for(const rotateOn of [2,3,4]){
  const f=await fixture();try{
   f.state.rotateOn=rotateOn;
   safe(await f.port().reviewFresh(await f.signed(),await f.request(),NOW),
    'blocked');
  }finally{f.close();}
 }
});
test('missing issuer, auth Session key and member digest key fail closed',async()=>{
 for(const failure of ['keyOut','authKeyOut','digestOut']){
  const f=await fixture();try{
   f.state[failure]=true;
   safe(await f.port().reviewFresh(await f.signed(),await f.request(),NOW),
    'blocked');
   if(failure==='keyOut')assert.equal(f.state.dbReads,0);
  }finally{f.close();}
 }
});
test('cross app/brand/environment, production, prohibited event types and time windows',async()=>{
 for(const patch of [
  {brand_id:'hglobal'},{app_id:'other.app'},{environment:'production'},
  {event_type:'privacy.erasure.requested'},{event_type:'unapproved.event'},
  {issued_at:NOW-2,expires_at:NOW+119},
  {issued_at:NOW+6,expires_at:NOW+8},{issued_at:NOW-200,expires_at:NOW-1},
  {expires_at:NOW},{expires_at:NOW-1}
 ]){
  const f=await fixture();try{
   safe(await f.port().reviewFresh(await f.signed(f.envelope(patch)),
    await f.request(),NOW),'blocked');
   assert.equal(f.state.dbReads,0);
  }finally{f.close();}
 }
});
test('strict own-data parser refuses getters, unexpected keys and poisoned prototypes',async()=>{
 const f=await fixture();try{
  const e=await f.signed();
  const hostile=Object.defineProperty({...e.envelope},'actor_ref',{
   enumerable:true,get(){throw Error('getter must not run');}
  });
  const candidates=[
   {...e,envelope:hostile},
   {...e,envelope:{...e.envelope,extra:1}},
   {...e,envelope:{...e.envelope,[Symbol('symbol')]:true}},
   {...e,extra:true},
   {...e,envelope:Object.create({event_id:'event-000001'})},
   {...e,mac_hex:e.mac_hex.toUpperCase()}
  ];
  const p=f.port(),r=await f.request();
  for(const x of candidates)safe(await p.reviewFresh(x,r,NOW),'blocked');
  assert.equal(f.state.dbReads,0);
 }finally{f.close();}
});
test('server-owned actor mapping switch, account switch, provider removal fail',async()=>{
 for(const mode of ['actorSwitch','otherAccount','providerMissing']){
  const f=await fixture();try{
   if(mode==='actorSwitch')f.state.actorSwitch=true;
   if(mode==='providerMissing')
    f.raw.exec("DELETE FROM starry_identities WHERE s_user_id='u1'");
   safe(await f.port().reviewFresh(await f.signed(),
    await f.request(mode==='otherAccount'?'u2':'u1'),NOW),'blocked');
  }finally{f.close();}
 }
});
test('late revocation and monotonic session epoch regression are blocked',async()=>{
 for(const mode of ['lateRevoke','epochRollback']){
  const f=await fixture();try{
   if(mode==='lateRevoke')f.state.lateRevoke=true;
   else f.state.epochVersion=4;
   safe(await f.port().reviewFresh(await f.signed(),
    await f.request(),NOW),'blocked');
  }finally{f.close();}
 }
});
test('short future skew is accepted at vNext wire but conservatively rejected at R004',async()=>{
 const f=await fixture();try{
  const s=await f.signed(f.envelope({issued_at:NOW+3,expires_at:NOW+20}));
  safe(await f.port().reviewFresh(s,await f.request(),NOW),'blocked');
 }finally{f.close();}
});

test('R006 field length limits agree with actual AI-0 #219 source: IDs up to 128 and App at most 100',async()=>{
 const f=await fixture();try{
  const max128='A'.repeat(128);
  const e=f.envelope({event_id:max128,actor_ref:'B'.repeat(128),
   idempotency_key:'C'.repeat(128)});
  const v=await f.port().reviewFresh(await f.signed(e),await f.request(),NOW);
  safe(v,'review_only','REVIEW_ONLY_NOT_AUTHORIZED');
  assert.ok(f.state.dbReads>0);
  assert.throws(()=>f.port({serverScope:scope('a'.repeat(101))}),
   /R006_TRUSTED_PORTS_REQUIRED/);
 }finally{f.close();}
});
test('R006 rejects ID length 129 and zero issued_at before any trusted issuer or Auth SQL read',async()=>{
 for(const invalid of [{event_id:'x'.repeat(129)},
  {actor_ref:'y'.repeat(129)},{idempotency_key:'z'.repeat(129)},
  {issued_at:0,expires_at:100}]){
  const f=await fixture();try{
   const v=await f.port().reviewFresh(
    await f.signed(f.envelope(invalid)),await f.request(),NOW);
   safe(v,'blocked','INVALID_VNEXT');
   assert.equal(f.state.keyReads,0);
   assert.equal(f.state.dbReads,0);
  }finally{f.close();}
 }
});
