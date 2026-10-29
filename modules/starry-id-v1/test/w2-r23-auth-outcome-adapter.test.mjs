import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {signServerSession} from '../src/session-crypto.ts';
import {isTrustedPrincipal, readSelf} from '../src/index.ts';
import {
 createOfflineW2CurrentAuthOutcomeAdapter, takeW2VerifiedPrincipal,
 W2_AUTH_OUTCOME_LIVE_ENABLED, W2_AUTH_OUTCOME_CONTRACT,
} from '../src/w2-r23-auth-outcome-adapter.ts';

const now = 1793000000;
const scope = Object.freeze({brand_id:'starry',app_id:'starry-id',environment:'staging'});
const origin = 'https://id.starry.example';
const badPrivate = 'DB_SECRET_RAW_TOKEN_NOT_FOR_CLIENT';
async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON');
  raw.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql', import.meta.url),'utf8'));
  for(const num of [1,2]){
    const id='u'+num, sid='sess'+num, sub='sub-'+num;
    raw.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,'active',3,1,'Member '+num,0,0,now,now);
    raw.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
      .run('apple',sub,id);
    raw.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)')
      .run(sid,id,'starry-id','staging',3,String(num).repeat(64),now+300);
  }
  const keys = new Map();
  const tokens = new Map();
  for(const num of [1,2]){
    const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
    keys.set('kid-'+num,key);
    const claims={...scope,provider:'apple',provider_subject:'sub-'+num,s_user_id:'u'+num,
      session_id:'sess'+num,auth_version:3,expires_at:now+300,issued_at:now,key_id:'kid-'+num};
    tokens.set(num,await signServerSession(claims,scope,now,{kid:'kid-'+num,key}));
  }
  const state={reads:0,prepareFails:false,bindFails:false,firstFails:false,
    dbFaultFor:null, keyFaultFor:null, keyNullFor:null, keyReads:0, afterRead:null, wallTime:now};
  const db={prepare(sql){
    assert.match(sql,/^SELECT /); state.reads++;
    if(state.prepareFails)throw Error(badPrivate);
    return {bind(...params){
      if(state.bindFails)throw Error(badPrivate);
      return {first:async()=>{
        await Promise.resolve();  // allow deterministic overlapping authentications
        if(state.firstFails || (state.dbFaultFor && params.includes(state.dbFaultFor)))
          throw Error(badPrivate);
        if(state.afterRead) await state.afterRead(sql,params);
        return raw.prepare(sql).get(...params) ?? null;
      }};
    }};
  }};
  const config={
    serverScope:scope,expectedOrigin:origin,authDb:db,now:()=>state.wallTime,
    getVerificationKey: async kid=>{
      state.keyReads++;
      await Promise.resolve();
      if(kid===state.keyFaultFor)throw Error('PRIVATE_KMS_INTERNAL_SIGNATURE');
      if(kid===state.keyNullFor)return null;
      return keys.get(kid)??null;
    },
  };
  const request=(num=1,options={})=>new Request(options.url??origin+'/private',{
    method:options.method??'GET',headers:{authorization:'Bearer '+(options.token??tokens.get(num)),
    ...(options.headers??{})},
  });
  return {raw,keys,tokens,state,config,request,close:()=>raw.close()};
}
const checkFlags=x=>{
  assert.equal(x.verified_live,false);assert.equal(x.may_publish,false);
  assert.equal(x.may_write_live_d1,false);assert.equal(x.may_grant,false);
  assert.equal(x.may_ack,false);
};

test('W2 adapter is default OFF, no DB/key call and never a live port',async()=>{
  const x=await setup();try{
    assert.equal(W2_AUTH_OUTCOME_LIVE_ENABLED,false);
    assert.equal(W2_AUTH_OUTCOME_CONTRACT,'starry.ai1.w2.auth-outcome.local-v1');
    const adapter=createOfflineW2CurrentAuthOutcomeAdapter(x.config);
    assert.equal((await adapter.authenticate(x.request())).status,'denied');
    assert.equal(x.state.keyReads,0);assert.equal(x.state.reads,0);
  }finally{x.close();}
});
test('production, non-Starry and unsafe origins rejected even when disabled',async()=>{
  const x=await setup();try{
    for(const change of [
      {serverScope:{...scope,environment:'production'}},
      {serverScope:{...scope,brand_id:'other'}},
      {serverScope:{...scope,app_id:'other'}},
      {expectedOrigin:'http://id.starry.example'},
      {expectedOrigin:origin+'/secret'},
    ])assert.throws(()=>createOfflineW2CurrentAuthOutcomeAdapter({...x.config,...change}));
  }finally{x.close();}
});
test('true WebCrypto HMAC and current SQLite Member/Session/provider link issue opaque verified outcome',async()=>{
  const x=await setup();try{
    const adapter=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true});
    const status=await adapter.authenticate(x.request());
    assert.equal(status.status,'verified');checkFlags(status);
    assert.equal(Object.isFrozen(status),true);
    const principal=takeW2VerifiedPrincipal(status);
    assert.equal(isTrustedPrincipal(principal),true);
    assert.equal(principal.s_user_id,'u1');
    assert.equal(readSelf(principal,scope,{
      s_user_id:'u1',status:'active',auth_version:3,profile_revision:1,
      display_name:'Member 1',directory_opt_in:false,display_name_public:false,
    },now).s_user_id,'u1');
    assert.deepEqual(JSON.parse(JSON.stringify(status)),{
      status:'verified',verified_live:false,may_publish:false,
      may_write_live_d1:false,may_grant:false,may_ack:false,
    });
    assert.equal(takeW2VerifiedPrincipal({...status}),null);
    assert.equal(takeW2VerifiedPrincipal(JSON.parse(JSON.stringify(status))),null);
    assert.equal(takeW2VerifiedPrincipal({status:'verified'}),null);
  }finally{x.close();}
});
test('tampered/expired/missing bearer, wrong host, invalid Request => denied, no token reflection',async()=>{
 const x=await setup();try{
  const adapter=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true});
  const signed=x.tokens.get(1);
  const mutated=signed.slice(0,-2)+(signed.endsWith('aa')?'bb':'aa');
  for(const req of [x.request(1,{token:mutated}),
    x.request(1,{token:'fake.bearer'}),x.request(1,{url:'https://other.example/private'}),
    x.request(1,{url:origin+'/private?user=u2'}), x.request(1,{method:'PUT'}),
    x.request(1,{headers:{cookie:'session=not-trusted'}}),
    new Request(origin+'/private'),{authorization:'Bearer '+signed},null]){
    const outcome=await adapter.authenticate(req);
    assert.equal(outcome.status,'denied');checkFlags(outcome);
    assert.equal(takeW2VerifiedPrincipal(outcome),null);
    assert.equal(JSON.stringify(outcome).includes(signed),false);
  }
  x.state.wallTime=now+301;
  assert.equal((await adapter.authenticate(x.request())).status,'denied');
 }finally{x.close();}
});
test('revoked/deleted/version-drift/missing binding all denied with real SQLite',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='sess1'",
  "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
  "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
  "DELETE FROM starry_identities WHERE s_user_id='u1'",
 ]){
  const x=await setup();try{
    x.raw.exec(sql);
    const res=await createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true}).authenticate(x.request());
    assert.equal(res.status,'denied');checkFlags(res);
  }finally{x.close();}
 }
});
test('unknown key KID returns denied; thrown key-ring failure returns unavailable (no details)',async()=>{
 const x=await setup();try{
  const adapter=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true});
  x.state.keyNullFor='kid-1';
  assert.equal((await adapter.authenticate(x.request())).status,'denied');
  x.state.keyNullFor=null;x.state.keyFaultFor='kid-1';
  const res=await adapter.authenticate(x.request());
  assert.equal(res.status,'dependency_unavailable');checkFlags(res);
  assert.equal(takeW2VerifiedPrincipal(res),null);
  assert.equal(JSON.stringify(res).includes('PRIVATE_KMS'),false);
  assert.equal(x.state.keyReads,2); // exactly one lookup per call, no retry
 }finally{x.close();}
});
test('synchronous prepare/bind and async first SQLite failures classified unavailable',async()=>{
 const x=await setup();try{
  const a=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true});
  for(const key of ['prepareFails','bindFails','firstFails']){
    x.state[key]=true;
    const res=await a.authenticate(x.request());
    assert.equal(res.status,'dependency_unavailable',key);checkFlags(res);
    assert.equal(JSON.stringify(res).includes(badPrivate),false);
    x.state[key]=false;
  }
  assert.equal((await a.authenticate(x.request())).status,'verified');
 }finally{x.close();}
});
test('trusted clock error/rollback fail closed and cannot generate a JSON principal',async()=>{
 const x=await setup();try{
  const a=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true,now:()=>{throw Error('PRIVATE_CLOCK');}});
  const unavailable=await a.authenticate(x.request());
  assert.equal(unavailable.status,'dependency_unavailable');checkFlags(unavailable);
  assert.equal(JSON.stringify(unavailable).includes('PRIVATE_CLOCK'),false);
  assert.equal(x.state.reads,0);assert.equal(x.state.keyReads,0);
  const invalid=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true,now:()=>Number.NaN});
  assert.equal((await invalid.authenticate(x.request())).status,'dependency_unavailable');
 }finally{x.close();}
});
test('concurrent key outage request does NOT contaminate valid request in SAME adapter',async()=>{
 const x=await setup();try{
  const a=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true});
  x.state.keyFaultFor='kid-2';
  const [good,bad]=await Promise.all([a.authenticate(x.request(1)),a.authenticate(x.request(2))]);
  assert.equal(good.status,'verified');
  assert.equal(bad.status,'dependency_unavailable');
  assert.equal(takeW2VerifiedPrincipal(bad),null);
  assert.equal(takeW2VerifiedPrincipal(good).s_user_id,'u1');
  x.state.keyFaultFor=null;
  assert.equal((await a.authenticate(x.request(2))).status,'verified');
 }finally{x.close();}
});
test('concurrent SQLite failure for one Session leaves independent valid request verified',async()=>{
 const x=await setup();try{
  const a=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true});
  x.state.dbFaultFor='sess2';
  const [good,bad]=await Promise.all([a.authenticate(x.request(1)),a.authenticate(x.request(2))]);
  assert.equal(good.status,'verified');
  assert.equal(bad.status,'dependency_unavailable');
  assert.equal(takeW2VerifiedPrincipal(good).s_user_id,'u1');
  assert.equal(takeW2VerifiedPrincipal(bad),null);
  x.state.dbFaultFor=null;
  assert.equal((await a.authenticate(x.request(2))).status,'verified');
 }finally{x.close();}
});
test('no automatic retry after bad credentials or read dependency outage',async()=>{
 const x=await setup();try{
  const a=createOfflineW2CurrentAuthOutcomeAdapter({...x.config,enabled:true});
  x.state.keyFaultFor='kid-1';
  const unavailable=await a.authenticate(x.request());
  assert.equal(unavailable.status,'dependency_unavailable');
  assert.equal(x.state.keyReads,1);
  assert.equal(x.state.reads,0);
  x.state.keyFaultFor=null;
  const again=await a.authenticate(x.request());
  assert.equal(again.status,'verified');
  assert.equal(x.state.keyReads,2);
  assert.equal(x.state.reads,3); // read member, session, identity once
 }finally{x.close();}
});
