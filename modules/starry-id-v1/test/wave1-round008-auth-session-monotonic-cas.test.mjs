import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {
 createOfflineR008AuthSessionCasReview,R008_AUTH_CAS_VERSION,R008_AUTH_CAS_LIVE
} from '../src/wave1-round008-auth-session-monotonic-cas.ts';

const NOW=1793000000,ORIGIN='https://id.starry.example';
const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
const fingerprint='a'.repeat(64);
const claim=(extra={})=>({
 source:'synthetic_server_auth_resolver',...scope,
 event_id:'event-000001',actor_ref:'actor-000001',
 member_ref:'member-000001',session_ref:'session-000001',
 provider_ref:'provider-000001',token_fingerprint:fingerprint,
 auth_version:3,session_version:5,issuer_epoch:1,expires_at:NOW+60,
 ...extra
});
const lease=(extra={})=>({
 source:'synthetic_server_issuer_lease',kid:'issuer-001',
 issuer_epoch:1,generation:1,...extra
});
const request=(token='valid_token_000001',extra={})=>
 new Request(ORIGIN+'/auth/review',{
  method:'POST',headers:{authorization:'Bearer '+token,...extra}
 });
function fixture(opts={}){
 const db=new DatabaseSync(':memory:');
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE auth_current (
  brand_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
  session_ref TEXT PRIMARY KEY,member_ref TEXT NOT NULL,
  provider_ref TEXT NOT NULL,actor_ref TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,auth_version INTEGER NOT NULL,
  session_version INTEGER NOT NULL,issuer_epoch INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','revoked','deleted')));
 CREATE TABLE local_event_replay(
  event_id TEXT NOT NULL,session_ref TEXT NOT NULL,
  PRIMARY KEY(event_id,session_ref));
 INSERT INTO auth_current VALUES(
  'starry','starry.one','staging','session-000001','member-000001',
  'provider-000001','actor-000001','${fingerprint}',3,5,1,'active');
 `);
 const state={claimReads:0,leaseReads:0,casCalls:0,floor:5,
  beforeCas:null,beforeCommit:null,lateRotate:false,
  forceTimeout:false,throwRead:false};
 const get=()=>db.prepare(
  'SELECT auth_version,session_version,state FROM auth_current WHERE session_ref=?'
 ).get('session-000001');
 const update=(sql)=>db.exec(sql);
 const deps={
  enabled:true,serverScope:scope,expectedOrigin:ORIGIN,
  readServerAuthenticatedClaim:async req=>{
   state.claimReads++;
   if(state.throwRead)throw Error('synthetic read failure');
   if(req.headers.get('authorization')!=='Bearer valid_token_000001')
    return null;
   return opts.claimFactory?.()??claim();
  },
  readMockMonotonicFloor:async()=>state.floor,
  readMockIssuerLease:async()=>{
   state.leaseReads++;
   return state.lateRotate&&state.leaseReads>1?
    lease({issuer_epoch:2,generation:2}):lease();
  },
  compareAndSwapLocalOnly:async (c,l)=>{
   state.casCalls++;
   if(state.forceTimeout)throw Error('simulated sqlite timeout');
   if(state.beforeCas)state.beforeCas();
   // Only one local SQLite transaction, never Worker/D1, Queue or Store.
   db.exec('BEGIN IMMEDIATE');
   try{
    const changed=db.prepare(`UPDATE auth_current SET
     session_version=session_version+1
     WHERE brand_id=? AND app_id=? AND environment=?
     AND session_ref=? AND member_ref=? AND provider_ref=?
     AND actor_ref=? AND token_fingerprint=? AND auth_version=?
     AND session_version=? AND issuer_epoch=? AND state='active'`)
     .run(c.brand_id,c.app_id,c.environment,c.session_ref,
      c.member_ref,c.provider_ref,c.actor_ref,c.token_fingerprint,
      c.auth_version,c.session_version,l.issuer_epoch);
    if(changed.changes!==1){db.exec('ROLLBACK');return 'denied';}
    db.prepare('INSERT INTO local_event_replay VALUES (?,?)')
     .run(c.event_id,c.session_ref);
    if(state.beforeCommit)state.beforeCommit();
    db.exec('COMMIT');return 'local_applied';
   }catch{
    db.exec('ROLLBACK');return 'denied';
   }
  }
 };
 const port=createOfflineR008AuthSessionCasReview({...deps,...opts.deps});
 return {db,state,port,get,update,close:()=>db.close()};
}
function blocked(out,status='blocked',reason){
 assert.equal(out.contract,R008_AUTH_CAS_VERSION);
 assert.equal(out.status,status);
 if(reason)assert.equal(out.reason,reason);
 assert.equal(out.authority,'local_sqlite_memory_simulation_only');
 for(const k of ['verified_live','may_write_live_d1','may_send',
  'may_enqueue','may_ack_queue','may_grant','may_bill','may_charge',
  'may_publish'])assert.equal(out[k],false,k);
 const json=JSON.stringify(out);
 for(const sensitive of ['valid_token_000001',fingerprint,
  'session-000001','member-000001','provider-000001','actor-000001'])
  assert.equal(json.includes(sensitive),false);
}
test('R008 is explicitly offline; successful local CAS NEVER grants delivery',async()=>{
 assert.equal(R008_AUTH_CAS_LIVE,false);
 const f=fixture();try{
  blocked(await f.port.review(request(),NOW),'review_only',
   'OFFLINE_CAS_NOT_LIVE_AUTHORITY');
  assert.equal(f.get().session_version,6);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_event_replay').get().n,1);
 }finally{f.close();}
});
test('default disabled does not access server claim, issuer or SQL',async()=>{
 const f=fixture({deps:{enabled:false}});try{
  blocked(await f.port.review(request(),NOW),'blocked','DISABLED');
  assert.equal(f.state.claimReads,0);
  assert.equal(f.state.casCalls,0);
 }finally{f.close();}
});
test('forged client verified/version headers and hostile Host deny before SQL',async()=>{
 for(const h of [{'x-verified':'true'},{'x-auth-version':'999'},
  {'x-session-version':'999'},{'x-issuer-epoch':'99'},
  {host:'evil.example'}]){
  const f=fixture();try{
   blocked(await f.port.review(request(undefined,h),NOW),'blocked',
    'UNTRUSTED_REQUEST');
   assert.equal(f.state.claimReads,0);
  }finally{f.close();}
 }
 const f=fixture();try{
  const forged=new Request('https://attacker.example/private',{
   method:'POST',headers:{authorization:'Bearer valid_token_000001'}});
  blocked(await f.port.review(forged,NOW),'blocked','UNTRUSTED_REQUEST');
 }finally{f.close();}
});
test('old token, malformed bearer and missing authenticated principal fail closed',async()=>{
 const f=fixture();try{
  blocked(await f.port.review(request('old_token_00000001'),NOW),
   'blocked','AUTH_UNAVAILABLE');
  blocked(await f.port.review(new Request(ORIGIN+'/test',{method:'POST'}),
   NOW),'blocked','UNTRUSTED_REQUEST');
  assert.equal(f.state.casCalls,0);
 }finally{f.close();}
});
test('server-only scope brand/app/env, wrong binding and getter reject',async()=>{
 for(const patch of [{brand_id:'hglobal'},{app_id:'other.app'},
  {environment:'production'},{provider_ref:'bad'},
  {actor_ref:'event-CHANGED'}]){
  const f=fixture({claimFactory:()=>claim(patch)});try{
   blocked(await f.port.review(request(),NOW),'blocked');
   assert.equal(f.state.casCalls,patch.brand_id||patch.app_id||
    patch.environment?0:1);
  }finally{f.close();}
 }
 const f=fixture({claimFactory:()=>Object.defineProperty(claim(),
  'actor_ref',{enumerable:true,get(){throw Error('do not run getters');}})});
 try{
  blocked(await f.port.review(request(),NOW),'blocked','AUTH_UNAVAILABLE');
  assert.equal(f.state.casCalls,0);
 }finally{f.close();}
});
test('two competing writers to same local row: exactly one CAS wins',async()=>{
 const f=fixture();try{
  const out=await Promise.all([
   f.port.review(request(),NOW),f.port.review(request(),NOW)
  ]);
  assert.equal(out.filter(x=>x.status==='review_only').length,1);
  assert.equal(out.filter(x=>x.status==='blocked').length,1);
  for(const x of out)blocked(x,x.status);
  assert.equal(f.get().session_version,6);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_event_replay').get().n,1);
 }finally{f.close();}
});
test('stale expected session version and auth version cannot write',async()=>{
 for(const patch of [{session_version:4},{session_version:6},
  {auth_version:2},{auth_version:4}]){
  const f=fixture({claimFactory:()=>claim(patch)});try{
   blocked(await f.port.review(request(),NOW),'blocked',
    patch.session_version===4?'STALE_SESSION':'CAS_CONFLICT_OR_REPLAY');
   assert.equal(f.get().session_version,5);
  }finally{f.close();}
 }
});
test('same event redelivery/replay after local commit and updated version denies',async()=>{
 const f=fixture();try{
  blocked(await f.port.review(request(),NOW),'review_only');
  blocked(await f.port.review(request(),NOW),'blocked','CAS_CONFLICT_OR_REPLAY');
  const p=f.port;
  // Even if the in-memory current version is updated, duplicated event fails.
  const g=createOfflineR008AuthSessionCasReview({
   enabled:true,serverScope:scope,expectedOrigin:ORIGIN,
   readServerAuthenticatedClaim:async()=>claim({session_version:6}),
   readMockMonotonicFloor:async()=>5,
   readMockIssuerLease:async()=>lease(),
   compareAndSwapLocalOnly:async(c,l)=>{
    f.db.exec('BEGIN IMMEDIATE');
    try{
     f.db.prepare(`INSERT INTO local_event_replay VALUES (?,?)`)
      .run(c.event_id,c.session_ref);
     f.db.exec('COMMIT');return 'local_applied';
    }catch{f.db.exec('ROLLBACK');return 'denied';}
   }
  });
  blocked(await g.review(request(),NOW),'blocked','CAS_CONFLICT_OR_REPLAY');
  assert.equal(f.get().session_version,6);
 }finally{f.close();}
});
test('revoke immediately before compare, deleted session and post-change revoke deny',async()=>{
 for(const state of ['revoked','deleted']){
  const f=fixture();try{
   f.state.beforeCas=()=>f.update(
    `UPDATE auth_current SET state='${state}',auth_version=auth_version+1 WHERE session_ref='session-000001'`);
   blocked(await f.port.review(request(),NOW),'blocked',
    'CAS_CONFLICT_OR_REPLAY');
   assert.equal(f.get().session_version,5);
  }finally{f.close();}
 }
 const f=fixture();try{
  blocked(await f.port.review(request(),NOW),'review_only');
  f.update(`UPDATE auth_current SET state='revoked',auth_version=4 WHERE session_ref='session-000001'`);
  blocked(await f.port.review(request(),NOW),'blocked',
   'CAS_CONFLICT_OR_REPLAY');
  assert.equal(f.get().state,'revoked');
 }finally{f.close();}
});
test('failed transaction rolls back row and replay ledger together',async()=>{
 const f=fixture();try{
  f.state.beforeCommit=()=>{throw Error('inject disk failure');};
  blocked(await f.port.review(request(),NOW),'blocked',
   'CAS_CONFLICT_OR_REPLAY');
  assert.equal(f.get().session_version,5);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_event_replay').get().n,0);
 }finally{f.close();}
});
test('mock timeout, issuer rotation or missing lease never grants live',async()=>{
 const a=fixture();try{
  a.state.forceTimeout=true;
  blocked(await a.port.review(request(),NOW),'blocked','PORT_FAILURE');
 }finally{a.close();}
 const b=fixture();try{
  b.state.lateRotate=true;
  blocked(await b.port.review(request(),NOW),'blocked','ISSUER_DRIFT');
  assert.equal(b.get().session_version,6); // local commit, NOT live.
 }finally{b.close();}
 const c=fixture({deps:{readMockIssuerLease:async()=>null}});try{
  blocked(await c.port.review(request(),NOW),'blocked','ISSUER_DRIFT');
  assert.equal(c.state.casCalls,0);
 }finally{c.close();}
});
test('restored older local snapshot fails against synthetic monotonic floor',async()=>{
 const f=fixture();try{
  f.state.floor=6;
  f.update(`UPDATE auth_current SET session_version=4 WHERE session_ref='session-000001'`);
  const p=createOfflineR008AuthSessionCasReview({
   enabled:true,serverScope:scope,expectedOrigin:ORIGIN,
   readServerAuthenticatedClaim:async()=>claim({session_version:4}),
   readMockMonotonicFloor:async()=>f.state.floor,
   readMockIssuerLease:async()=>lease(),
   compareAndSwapLocalOnly:async()=>{throw Error('must not reach CAS');}
  });
  blocked(await p.review(request(),NOW),'blocked','STALE_SESSION');
  assert.equal(f.get().session_version,4);
 }finally{f.close();}
});
test('missing server claim, expiry and invalid shape fail without SQL',async()=>{
 for(const data of [null,{...claim(),expires_at:NOW},
  {...claim(),event_id:'x'}, {...claim(),unexpected:'field'}]){
  const f=fixture({claimFactory:()=>data});try{
   blocked(await f.port.review(request(),NOW),'blocked','AUTH_UNAVAILABLE');
   assert.equal(f.state.casCalls,0);
  }finally{f.close();}
 }
});
test('invalid time, disabled ports and unavailable floor deny',async()=>{
 const f=fixture({deps:{readMockMonotonicFloor:async()=>null}});
 try{
  blocked(await f.port.review(request(),NOW),'blocked','STALE_SESSION');
  blocked(await f.port.review(request(),0),'blocked','UNTRUSTED_REQUEST');
  assert.equal(f.state.casCalls,0);
 }finally{f.close();}
 assert.throws(()=>createOfflineR008AuthSessionCasReview({
  serverScope:scope,expectedOrigin:ORIGIN,
  readServerAuthenticatedClaim:null,readMockMonotonicFloor:null,
  readMockIssuerLease:null,compareAndSwapLocalOnly:null
 }),/R008_LOCAL_AUTH_PORTS_REQUIRED/);
});
