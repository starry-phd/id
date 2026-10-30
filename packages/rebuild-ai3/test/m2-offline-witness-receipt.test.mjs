import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  reviewOfflinePitrWitnessReceipt,M2_WITNESS_RECEIPT_LIVE_ENABLED,
} from '../src/m2-offline-witness-receipt.ts';

const nonce='A'.repeat(43);
const candidate=(changes={})=>({
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  snapshot_generation:31,
  members:[{member_ref:'member_001',status:'deleted',
    auth_version:8,profile_present:false,
    sessions:[{session_ref:'session_001',auth_version:8,revoked_at:123}]}],
  ...changes,
});
const witness=(changes={})=>({
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  observed_generation:31,
  records:[{member_ref:'member_001',minimum_auth_version:8,deleted:true}],
  ...changes,
});
const bytes=(s)=>new TextEncoder().encode(s);
const hex=(buffer)=>Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join('');
const b64url=(buffer)=>Buffer.from(buffer).toString('base64url');
const key=()=>crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),
  {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const trust=(verification_key,extra={})=>({
  expected_nonce:nonce,minimum_witness_generation:31,
  expected_key_id:'local-test-kid',now_seconds:1000030,
  verification_key,...extra,
});
const canonicalCandidate=(c)=>JSON.stringify({
  brand_id:c.brand_id,app_id:c.app_id,environment:c.environment,
  snapshot_generation:c.snapshot_generation,
  members:c.members.map(m=>({
    member_ref:m.member_ref,status:m.status,auth_version:m.auth_version,
    profile_present:m.profile_present,
    sessions:m.sessions.map(s=>({
      session_ref:s.session_ref,auth_version:s.auth_version,revoked_at:s.revoked_at,
    })).sort((a,b)=>a.session_ref.localeCompare(b.session_ref)),
  })).sort((a,b)=>a.member_ref.localeCompare(b.member_ref)),
});
const canonicalWitness=(w)=>JSON.stringify({
  brand_id:w.brand_id,app_id:w.app_id,environment:w.environment,
  observed_generation:w.observed_generation,
  records:w.records.map(r=>({
    member_ref:r.member_ref,minimum_auth_version:r.minimum_auth_version,deleted:r.deleted,
  })).sort((a,b)=>a.member_ref.localeCompare(b.member_ref)),
});
const payload=(r)=>JSON.stringify([
  'starry.ai3.m2.offline-witness-receipt.v1',
  r.brand_id,r.app_id,r.environment,r.nonce,
  r.snapshot_generation,r.witness_generation,r.issued_at,
  r.snapshot_sha256,r.witness_sha256,r.key_id,
]);
async function signReceipt(c,w,secret,extra={}){
  const [cd,wd]=await Promise.all([
    crypto.subtle.digest('SHA-256',bytes(canonicalCandidate(c))),
    crypto.subtle.digest('SHA-256',bytes(canonicalWitness(w))),
  ]);
  const r={
    schema_version:'starry.ai3.m2.offline-witness-receipt.v1',
    brand_id:'starry',app_id:'starry-id',environment:'staging',
    nonce,snapshot_generation:c.snapshot_generation,
    witness_generation:w.observed_generation,issued_at:1000000,
    snapshot_sha256:hex(cd),witness_sha256:hex(wd),
    key_id:'local-test-kid',mac:'',...extra,
  };
  r.mac=b64url(await crypto.subtle.sign('HMAC',secret,bytes(payload(r))));
  return r;
}
const assertQuarantined=(r)=>{
  assert.equal(r.status,'quarantined_review_required');
  assert.equal(r.may_restore,false);
  assert.equal(r.may_open_api,false);
  assert.equal(r.may_grant_battery,false);
  assert.equal(r.may_ack_queue,false);
  assert.equal(r.independently_verified,false);
  assert.equal(r.live_enabled,false);
  assert.equal(Object.isFrozen(r),true);
};

test('genuine local WebCrypto receipt binds nonce, SHA-256 snapshot and scope but NEVER approves recovery',async()=>{
  const secret=await key(),c=candidate(),w=witness();
  const r=await reviewOfflinePitrWitnessReceipt(c,w,await signReceipt(c,w,secret),
    trust(secret));
  assert.equal(M2_WITNESS_RECEIPT_LIVE_ENABLED,false);
  assert.equal(r.receipt,'offline_authenticated');
  assert.equal(r.reason,'MATCHED_SYNTHETIC_RECEIPT');
  assert.deepEqual(r.source_risks,[]);
  assertQuarantined(r);
});

test('tampered snapshot member/profile/session after signing rejects hash binding',async()=>{
  const secret=await key(),c=candidate(),w=witness();
  const signed=await signReceipt(c,w,secret);
  for(const changed of [
    candidate({members:[{...c.members[0],status:'active'}]}),
    candidate({members:[{...c.members[0],profile_present:true}]}),
    candidate({members:[{...c.members[0],sessions:[{...c.members[0].sessions[0],revoked_at:null}]}]}),
  ]){
    const result=await reviewOfflinePitrWitnessReceipt(changed,w,signed,trust(secret));
    assert.equal(result.receipt,'rejected');
    assertQuarantined(result);
  }
});

test('witness substitution, deletion tamper and stale source cannot reuse old receipt',async()=>{
  const secret=await key(),c=candidate(),w=witness();
  const signed=await signReceipt(c,w,secret);
  for(const changed of [
    witness({records:[{...w.records[0],deleted:false}]}),
    witness({records:[]}),
    witness({observed_generation:30}),
  ]){
    const r=await reviewOfflinePitrWitnessReceipt(c,changed,signed,trust(secret));
    assert.equal(r.receipt,'rejected');
    assertQuarantined(r);
  }
});

test('same signed receipt replay with different challenge or after freshness window is refused',async()=>{
  const secret=await key(),c=candidate(),w=witness(),r=await signReceipt(c,w,secret);
  for(const changes of [
    {expected_nonce:'B'.repeat(43)},
    {now_seconds:1000121},
    {now_seconds:999900},
    {minimum_witness_generation:32},
  ]){
    const result=await reviewOfflinePitrWitnessReceipt(c,w,r,trust(secret,changes));
    assert.equal(result.receipt,'rejected');
    assertQuarantined(result);
  }
});

test('witness older than candidate snapshot is refused even when correctly signed',async()=>{
  const secret=await key(),c=candidate(),w=witness({observed_generation:30});
  const signed=await signReceipt(c,w,secret);
  const r=await reviewOfflinePitrWitnessReceipt(c,w,signed,
    trust(secret,{minimum_witness_generation:30}));
  assert.equal(r.receipt,'rejected');
  assertQuarantined(r);
});

test('cryptographically valid older snapshot still flags deletion/version rollback and cannot restore',async()=>{
  const secret=await key(),c=candidate({snapshot_generation:30,
    members:[{member_ref:'member_001',status:'active',auth_version:3,
      profile_present:true,sessions:[{session_ref:'session_001',auth_version:3,revoked_at:null}]}]}),
  w=witness();
  const r=await reviewOfflinePitrWitnessReceipt(c,w,await signReceipt(c,w,secret),
    trust(secret));
  assert.equal(r.receipt,'offline_authenticated');
  assert.ok(r.source_risks.includes('DELETED_MEMBER_REAPPEARED'));
  assert.ok(r.source_risks.includes('OLD_SESSION_UNREVOKED'));
  assert.ok(r.source_risks.includes('SNAPSHOT_BEHIND_WITNESS'));
  assertQuarantined(r);
});

test('unknown KID, different signing key and tampered MAC fail closed',async()=>{
  const secret=await key(),c=candidate(),w=witness();
  const signed=await signReceipt(c,w,secret);
  const other=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(9),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  for(const [receipt,options] of [
    [{...signed,key_id:'unknown-kid'},trust(secret)],
    [signed,trust(secret,{expected_key_id:'other-key'})],
    [signed,trust(other)],
    [{...signed,mac:'A'.repeat(43)},trust(secret)],
  ]){
    const r=await reviewOfflinePitrWitnessReceipt(c,w,receipt,options);
    assert.equal(r.receipt,'rejected');
    assertQuarantined(r);
  }
});

test('extra approval flag, wrong brand, production and invented independent authority are refused',async()=>{
  const secret=await key(),c=candidate(),w=witness(),signed=await signReceipt(c,w,secret);
  for(const [cc,ww,rr] of [
    [c,w,{...signed,approved:true}],
    [c,w,{...signed,independently_verified:true}],
    [c,w,{...signed,environment:'production'}],
    [candidate({brand_id:'hglobal'}),w,signed],
    [c,witness({environment:'production'}),signed],
  ]){
    const r=await reviewOfflinePitrWitnessReceipt(cc,ww,rr,trust(secret));
    assert.equal(r.receipt,'rejected');
    assertQuarantined(r);
  }
});

test('untrusted getter on receipt has no effects',async()=>{
  const secret=await key(),c=candidate(),w=witness(),r=await signReceipt(c,w,secret);
  let touched=0;
  Object.defineProperty(r,'mac',{get(){touched++;throw Error('getter called');}});
  const result=await reviewOfflinePitrWitnessReceipt(c,w,r,trust(secret));
  assert.equal(touched,0);
  assert.equal(result.receipt,'rejected');
  assertQuarantined(result);
});

test('missing or extractable signing key is rejected without crypto side effects',async()=>{
  const secret=await key(),c=candidate(),w=witness(),signed=await signReceipt(c,w,secret);
  const extractable=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),
    {name:'HMAC',hash:'SHA-256'},true,['sign','verify']);
  for(const bad of [null,extractable]){
    const result=await reviewOfflinePitrWitnessReceipt(c,w,signed,
      trust(bad));
    assert.equal(result.receipt,'rejected');
    assertQuarantined(result);
  }
});

test('reordered member/session records bind canonical deterministic snapshot',async()=>{
  const secret=await key();
  const first={member_ref:'member_001',status:'active',auth_version:8,
    profile_present:true,sessions:[{session_ref:'session_002',auth_version:8,revoked_at:25},
      {session_ref:'session_001',auth_version:8,revoked_at:20}]};
  const second={member_ref:'member_002',status:'deleted',auth_version:9,
    profile_present:false,sessions:[]};
  const c=candidate({members:[second,first]});
  const w=witness({records:[{member_ref:'member_002',minimum_auth_version:9,deleted:true},
    {member_ref:'member_001',minimum_auth_version:8,deleted:false}]});
  const r=await signReceipt(c,w,secret);
  const reversed=candidate({members:[{...first,sessions:[...first.sessions].reverse()},second]});
  const reversedWitness=witness({records:[...w.records].reverse()});
  const out=await reviewOfflinePitrWitnessReceipt(reversed,reversedWitness,r,trust(secret));
  assert.equal(out.receipt,'offline_authenticated');
  assertQuarantined(out);
});

test('receipt and trusted nonce cannot be swapped during asynchronous hash validation',async()=>{
  const secret=await key(),c=candidate(),w=witness();
  const forged=await signReceipt(c,w,secret,{nonce:'B'.repeat(43)});
  forged.nonce=nonce; // checked initially as A, but MAC was signed for B
  const pending=reviewOfflinePitrWitnessReceipt(c,w,forged,trust(secret));
  forged.nonce='B'.repeat(43); // try to swap back after pre-await checks
  const r=await pending;
  assert.equal(r.receipt,'rejected');
  assertQuarantined(r);
});

test('invalid snapshot digest cannot become valid after the first await',async()=>{
  const secret=await key(),c=candidate(),w=witness();
  const valid=await signReceipt(c,w,secret);
  const forged={...valid,snapshot_sha256:'0'.repeat(64)};
  const pending=reviewOfflinePitrWitnessReceipt(c,w,forged,trust(secret));
  forged.snapshot_sha256=valid.snapshot_sha256;
  const r=await pending;
  assert.equal(r.receipt,'rejected');
  assertQuarantined(r);
});

test('trust boundary rejects getters, self-reported approval and unexpected fields without accessing them',async()=>{
  const secret=await key(),c=candidate(),w=witness(),receipt=await signReceipt(c,w,secret);
  let calls=0;
  const forged=trust(secret);
  Object.defineProperty(forged,'expected_nonce',{enumerable:true,get(){calls++;throw Error('side effect');}});
  const outcome=await reviewOfflinePitrWitnessReceipt(c,w,receipt,forged);
  assert.equal(calls,0);
  assert.equal(outcome.receipt,'rejected');
  assertQuarantined(outcome);
  for(const extra of [{approved:true},{source:'production'},{independently_verified:true}]){
    const r=await reviewOfflinePitrWitnessReceipt(c,w,receipt,{...trust(secret),...extra});
    assert.equal(r.receipt,'rejected');
    assertQuarantined(r);
  }
});

test('canonical 32-byte HMAC encoding forbids alternative trailing base64url padding bits',async()=>{
  const secret=await key(),c=candidate(),w=witness(),receipt=await signReceipt(c,w,secret);
  const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last=abc.indexOf(receipt.mac.at(-1));
  assert.ok(last>=0);
  const alias=receipt.mac.slice(0,-1)+abc[(last&60)|((last+1)&3)];
  assert.notEqual(alias,receipt.mac);
  const r=await reviewOfflinePitrWitnessReceipt(c,w,{...receipt,mac:alias},trust(secret));
  assert.equal(r.receipt,'rejected');
  assertQuarantined(r);
});

test('mutable candidate array cannot report clean risks for a different signed unsafe snapshot',async()=>{
  const secret=await key(),w=witness();
  const safe=candidate().members[0]; // deleted, revoked, profile absent
  const unsafe={...safe,status:'active',profile_present:true,
    sessions:[{...safe.sessions[0],revoked_at:null}]};
  const signed=await signReceipt(candidate({members:[unsafe]}),w,secret);
  let reads=0;
  // The ORIGINAL verifier iterated this caller-owned array for risk analysis,
  // then .map() read it again for the signed digest. Two different contents
  // could therefore authenticate an unsafe digest while reporting no risks.
  const swapped=new Proxy([safe],{
    get(target,key,receiver){
      if(key==='0')return ++reads===1?safe:unsafe;
      return Reflect.get(target,key,receiver);
    },
  });
  const out=await reviewOfflinePitrWitnessReceipt(
    candidate({members:swapped}),w,signed,trust(secret));
  assert.equal(out.receipt,'rejected');
  assertQuarantined(out);
});

test('mutable witness array cannot hide deletion risk in a newly authenticated MAC',async()=>{
  const secret=await key();
  const c=candidate({members:[{...candidate().members[0],status:'active'}]});
  const safe={member_ref:'member_001',minimum_auth_version:8,deleted:false};
  const unsafe={...safe,deleted:true};
  const signed=await signReceipt(c,witness({records:[unsafe]}),secret);
  let reads=0;
  const swapped=new Proxy([safe],{
    get(target,key,receiver){
      if(key==='0')return ++reads===1?safe:unsafe;
      return Reflect.get(target,key,receiver);
    },
  });
  const out=await reviewOfflinePitrWitnessReceipt(
    c,witness({records:swapped}),signed,trust(secret));
  assert.equal(out.receipt,'rejected');
  assertQuarantined(out);
});

test('nested array element getter cannot run during offline evidence snapshot',async()=>{
  const secret=await key(),c=candidate(),w=witness();
  const signed=await signReceipt(c,w,secret);
  let reads=0;
  const malicious=[c.members[0]];
  Object.defineProperty(malicious,'0',{get(){reads++;throw Error('PRIVATE_GETTER');}});
  const out=await reviewOfflinePitrWitnessReceipt(
    candidate({members:malicious}),w,signed,trust(secret));
  assert.equal(reads,0);
  assert.equal(out.receipt,'rejected');
  assertQuarantined(out);
});

test('new source is checked by strict TypeScript in repository CI',()=>{
  const executable=process.platform==='win32'?'node_modules/.bin/tsc.cmd':'./node_modules/.bin/tsc';
  const args=['--noEmit','--strict','--target','ES2022','--module','ESNext',
    '--moduleResolution','Bundler','--skipLibCheck','--allowImportingTsExtensions',
    'packages/rebuild-ai3/src/m2-offline-witness-receipt.ts'];
  const result=spawnSync(executable,args,{encoding:'utf8',timeout:60000});
  assert.equal(result.status,0,(result.stdout||'')+(result.stderr||'')+String(result.error??''));
});
