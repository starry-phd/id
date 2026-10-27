import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {LIVE_ANONYMOUS_APPEALS_ENABLED,createAnonymousAppeals} from '../src/anonymous-appeals.ts';
const s={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const k='a_'+'a'.repeat(64),fileHash='b'.repeat(64);
const request={client_key:k,topic_code:'ACCOUNT_ACCESS',
 uploads:[{object_ref:'scan_passed_01',sha256:fileHash,bytes:1024,media_type:'image/png'}]};
const goodHash=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const saved=[],byKey=new Set(),lookups=[],checks=[],limits=[];
 let authorized=true,safe=true,rate=true,write='created',status='received',issueCount=0,failStore=false;
 const gate={
  limit:async op=>{limits.push(op);return rate},
  topicAllowed:async()=>authorized,
  scan:async files=>{checks.push(files);return safe},
 };
 const secrets={
  issue:async()=>{
   issueCount++;
   const credential=randomBytes(32).toString('hex');
   return {case_ref:'case_'+randomBytes(32).toString('hex'),credential,
    credential_digest:goodHash(credential)};
  },
  verify:async (digest,plain)=>{
   const v=Buffer.from(goodHash(plain),'hex'),e=Buffer.from(digest,'hex');
   return v.length===e.length&&timingSafeEqual(v,e);
  },
 };
 const store={
  findKey:async(_scope,key)=>{if(failStore)throw Error('STORE_DOWN');return byKey.has(key)},
  atomicCreate:async row=>{
   if(failStore)throw Error('STORE_DOWN');
   if(write==='duplicate')return {status:'duplicate',case_ref:row.case_ref};
   if(write==='bad')return {status:'created',case_ref:'case_'+ 'c'.repeat(64)};
   saved.push(row);byKey.add(row.client_key);
   return {status:'created',case_ref:row.case_ref};
  },
  status:async (_scope,ref)=>{
   lookups.push(ref);
   const match=saved.find(x=>x.case_ref===ref);
   return match?{case_ref:match.case_ref,credential_digest:match.credential_digest,
    status,updated_ms:5000}:null;
  },
 };
 const api=createAnonymousAppeals(s,gate,secrets,store);
 return {api,saved,checks,lookups,limits,issueCount:()=>issueCount,
  allow:x=>authorized=x,scan:x=>safe=x,rate:x=>rate=x,write:x=>write=x,
  state:x=>status=x,failStore:x=>failStore=x,
  secrets,store};
}
test('R8 disabled real API by default; Starry and environment only',()=>{
 assert.equal(LIVE_ANONYMOUS_APPEALS_ENABLED,false);
 assert.throws(()=>createAnonymousAppeals({...s,brand_id:'hglobal'}, {}, {}, {}),/SCOPE_DENIED/);
 assert.throws(()=>createAnonymousAppeals({...s,environment:'production'}, {}, {}, {}),/SCOPE_DENIED/);
});
test('anonymous submission issues one cryptographic credential, only digest and hashes persisted',async()=>{
 const f=fixture(),r=await f.api.submit(request,1000);
 assert.equal(r.outcome,'created');
 assert.match(r.credential,/^[a-f0-9]{64}$/);
 assert.match(r.case_ref,/^case_[a-f0-9]{64}$/);
 assert.equal(f.saved.length,1);
 const row=f.saved[0],stored=JSON.stringify(row);
 assert.equal(row.brand_id,'starry');assert.equal(row.credential_digest,goodHash(r.credential));
 assert.deepEqual(row.uploaded_hashes,[fileHash]);
 assert.equal(stored.includes(r.credential),false);
 assert.equal(stored.includes('scan_passed_01'),false);
 assert.equal('email' in row,false);
 const check=await f.api.lookup(r.case_ref,r.credential);
 assert.deepEqual(check,{case_ref:r.case_ref,status:'received',updated_ms:5000});
});
test('duplicate case key no second credential even after client retry',async()=>{
 const f=fixture();await f.api.submit(request,1000);
 const r=await f.api.submit(request,1001);
 assert.deepEqual(r,{outcome:'duplicate_no_new_credential',case_ref:null,credential:null});
 assert.equal(f.issueCount(),1);assert.equal(f.saved.length,1);
});
test('concurrent atomic duplicate receipt returns no potentially unpersisted credential',async()=>{
 const f=fixture();f.write('duplicate');
 assert.deepEqual(await f.api.submit(request,1000),
  {outcome:'duplicate_no_new_credential',case_ref:null,credential:null});
 assert.equal(f.saved.length,0);
});
test('unauthorized topic and scanner failure block storage and secret minting',async()=>{
 for(const which of ['allow','scan']){
  const f=fixture();f[which](false);
  await assert.rejects(f.api.submit(request,1000),/TOPIC_NOT_APPROVED|ATTACHMENT_NOT_CLEARED/);
  assert.equal(f.issueCount(),0);assert.equal(f.saved.length,0);
 }
});
test('rate gate precedes storage, issue and status enumeration',async()=>{
 const f=fixture();f.rate(false);
 await assert.rejects(f.api.submit(request,1000),/RATE_OR_AUTHORITY_DENIED/);
 await assert.rejects(f.api.lookup('case_'+ 'd'.repeat(64),'a'.repeat(64)),/RATE_OR_AUTHORITY_DENIED/);
 assert.deepEqual(f.limits,['submit','lookup']);
 assert.equal(f.saved.length,0);assert.equal(f.lookups.length,0);
});
test('malformed, unscanned or oversized attachments reject (including hidden or getter)',async()=>{
 const hidden={...request};Object.defineProperty(hidden,'email',{value:'pii',enumerable:false});
 const access={...request};Object.defineProperty(access,'topic_code',{enumerable:true,get(){return 'ACCOUNT_ACCESS'}});
 const revoked=Proxy.revocable({...request},{});revoked.revoke();
 for(const bad of [hidden,access,revoked.proxy,
  {...request,client_key:'client_anything'},
  {...request,topic_code:'pii'},
  {...request,uploads:[{...request.uploads[0],bytes:10000001}]},
  {...request,uploads:[{...request.uploads[0],media_type:'text/html'}]},
  {...request,uploads:[{...request.uploads[0],sha256:'raw'}]},
  {...request,uploads:[request.uploads[0],request.uploads[0]]},
  {...request,uploads:Array(4).fill(request.uploads[0])}
 ]){
  const f=fixture();
  await assert.rejects(f.api.submit(bad,1000));
  assert.equal(f.saved.length,0);
 }
});
test('incorrect credential never reveals status; unknown case has same nullable return',async()=>{
 const f=fixture(),r=await f.api.submit(request,1000);
 assert.equal(await f.api.lookup(r.case_ref,'a'.repeat(64)),null);
 assert.equal(await f.api.lookup('case_'+ 'd'.repeat(64),'a'.repeat(64)),null);
 assert.equal(await f.api.lookup('invalid','a'.repeat(64)),null);
 assert.equal(f.lookups.length,2);
});
test('lookup only exposes status, never topic, attachments, actor or denial reasons',async()=>{
 const f=fixture(),r=await f.api.submit(request,1000);f.state('reviewing');
 const stat=await f.api.lookup(r.case_ref,r.credential);
 assert.deepEqual(Object.keys(stat).sort(),['case_ref','status','updated_ms'].sort());
});
test('storage outage and uncertain receipt fail closed, never hand out usable uncommitted case',async()=>{
 const f=fixture();f.failStore(true);
 await assert.rejects(f.api.submit(request,1000),/STORE_DOWN/);
 assert.equal(f.saved.length,0);
 f.failStore(false);f.write('bad');
 await assert.rejects(f.api.submit(request,1000),/WRITE_RECEIPT_INVALID/);
 assert.equal(f.saved.length,0);
});
test('fake predictable, malformed cryptographic issuer never persists anything',async()=>{
 const f=fixture();f.secrets.issue=async()=>({case_ref:'1234',credential:'weak',credential_digest:'weak'});
 await assert.rejects(f.api.submit(request,1000),/SERVER_ENTROPY_UNVERIFIED/);
 assert.equal(f.saved.length,0);
});
test('real clock must be nonnegative safe integer, no anonymous identity assumption',async()=>{
 const f=fixture();
 for(const t of [-1,NaN,Infinity,1.1])await assert.rejects(f.api.submit(request,t),/MALFORMED/);
 assert.equal(f.saved.length,0);
});
