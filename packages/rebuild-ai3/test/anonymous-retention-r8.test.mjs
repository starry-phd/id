import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {LIVE_ANONYMOUS_APPEALS_ENABLED,createAnonymousAppeals} from '../src/anonymous-appeals.ts';
import {AUTOMATED_AUDIT_PURGE_ENABLED,planAuditReview} from '../src/audit-retention.ts';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'},key='a_'+'a'.repeat(64),hash='b'.repeat(64);
const request={client_key:key,topic_code:'ACCESS_REVIEW',uploads:[{object_ref:'scan1',sha256:hash,bytes:100,media_type:'image/png'}]};
const sha=s=>createHash('sha256').update(s).digest('hex');
function fx(){
 const records=[],lookups=[],metrics=[];let approved=true,scan=true,rate=true,reply='created';
 const gate={limit:async op=>{metrics.push(op);return rate},
  topicAllowed:async()=>approved,scan:async()=>scan};
 const secrets={issue:async()=>{const credential=randomBytes(32).toString('hex');
  return {case_ref:'case_'+randomBytes(32).toString('hex'),credential,credential_digest:sha(credential)}},
  verify:async(d,s)=>timingSafeEqual(Buffer.from(d,'hex'),Buffer.from(sha(s),'hex'))};
 const store={findKey:async(_scope,k)=>records.some(x=>x.client_key===k),
  atomicCreate:async x=>{if(reply==='created')records.push(x);
   return {status:reply,case_ref:x.case_ref}},
  status:async(_scope,ref)=>{lookups.push(ref);const x=records.find(x=>x.case_ref===ref);
   return x?{case_ref:x.case_ref,credential_digest:x.credential_digest,
    updated_ms:2000,status:'reviewing'}:null}};
 const api=createAnonymousAppeals(scope,gate,secrets,store);
 return {api,records,lookups,metrics,gate,secrets,store,
  allow:x=>approved=x,safe:x=>scan=x,rate:x=>rate=x,receipt:x=>reply=x};
}
test('R8 appeal never live and rejects cross-brand/production',()=>{
 assert.equal(LIVE_ANONYMOUS_APPEALS_ENABLED,false);
 for(const bad of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'}])
  assert.throws(()=>createAnonymousAppeals(bad,{},{},{}),/SCOPE_DENIED/);
});
test('R8 anonymous case secret issued once, digest only stored, status requires proof',async()=>{
 const f=fx(),r=await f.api.submit(request,1000);
 assert.equal(r.outcome,'created');assert.match(r.credential,/^[a-f0-9]{64}$/);
 assert.equal(f.records.length,1);assert.equal(f.records[0].credential_digest,sha(r.credential));
 assert.equal(JSON.stringify(f.records[0]).includes(r.credential),false);
 assert.equal(JSON.stringify(f.records[0]).includes('scan1'),false);
 assert.deepEqual(f.records[0].uploaded_hashes,[hash]);
 assert.deepEqual(await f.api.lookup(r.case_ref,r.credential),
  {case_ref:r.case_ref,status:'reviewing',updated_ms:2000});
});
test('R8 duplicate idempotency key cannot reissue access secret',async()=>{
 const f=fx();await f.api.submit(request,1000);
 assert.deepEqual(await f.api.submit(request,1001),
  {outcome:'duplicate_no_new_credential',case_ref:null,credential:null});
 assert.equal(f.records.length,1);
});
test('R8 concurrent duplicate receipt does not leak generated secret',async()=>{
 const f=fx();f.receipt('duplicate');
 assert.deepEqual(await f.api.submit(request,1000),
  {outcome:'duplicate_no_new_credential',case_ref:null,credential:null});
 assert.equal(f.records.length,0);
});
test('R8 rate-limit before submit/status; content scan/topic approval required',async()=>{
 const f=fx();f.rate(false);
 await assert.rejects(f.api.submit(request,1000),/RATE_OR_AUTHORITY_DENIED/);
 await assert.rejects(f.api.lookup('case_'+'a'.repeat(64),'b'.repeat(64)),/RATE_OR_AUTHORITY_DENIED/);
 assert.equal(f.lookups.length,0);assert.equal(f.records.length,0);
 f.rate(true);f.safe(false);
 await assert.rejects(f.api.submit(request,1000),/ATTACHMENT_NOT_CLEARED/);
 f.safe(true);f.allow(false);
 await assert.rejects(f.api.submit(request,1000),/TOPIC_NOT_APPROVED/);
});
test('R8 forged/oversized/raw data rejected without storing a record',async()=>{
 const hidden={...request};Object.defineProperty(hidden,'email',{value:'raw',enumerable:false});
 const getter={...request};Object.defineProperty(getter,'topic_code',{enumerable:true,get(){return 'ACCESS_REVIEW'}});
 for(const input of [hidden,getter,{...request,paid:true},
  {...request,client_key:'a_not_random'},
  {...request,uploads:[{...request.uploads[0],bytes:10000001}]},
  {...request,uploads:[{...request.uploads[0],media_type:'text/html'}]},
  {...request,uploads:[request.uploads[0],request.uploads[0]]},
  {...request,uploads:[{...request.uploads[0],sha256:'token'}]}]){
  const f=fx();await assert.rejects(f.api.submit(input,1000));assert.equal(f.records.length,0);
 }
});
test('R8 case enumeration returns generic null and no user data',async()=>{
 const f=fx(),r=await f.api.submit(request,1000);
 assert.equal(await f.api.lookup(r.case_ref,'c'.repeat(64)),null);
 assert.equal(await f.api.lookup('case_'+'d'.repeat(64),'c'.repeat(64)),null);
 assert.equal(await f.api.lookup('invalid','c'.repeat(64)),null);
 assert.deepEqual(f.lookups,[r.case_ref,'case_'+'d'.repeat(64)]);
});
test('R8 server proof and write receipt failures do not give successful credentials',async()=>{
 const f=fx();f.secrets.issue=async()=>({case_ref:'weak',credential:'weak',credential_digest:'weak'});
 await assert.rejects(f.api.submit(request,1000),/SERVER_ENTROPY_UNVERIFIED/);
 const g=fx();g.store.atomicCreate=async()=>({status:'created',case_ref:'case_'+'f'.repeat(64)});
 await assert.rejects(g.api.submit(request,1000),/WRITE_RECEIPT_INVALID/);
});
test('R8 minimum ordinary audit 90 days, review only, never auto-delete',async()=>{
 assert.equal(AUTOMATED_AUDIT_PURGE_ENABLED,false);
 const now=Date.UTC(2025,0,1),row={brand_id:'starry',event_ref:'audit1',classification:'ordinary',occurred_at_ms:now};
 const legal={status:async()=>({legal_hold:'clear',statutory_keep_until_ms:null}),approvedReview:async()=>true};
 assert.equal((await planAuditReview(row,now+89*86400000,legal)).disposition,'not_due');
 const r=await planAuditReview(row,now+90*86400000,legal);
 assert.equal(r.disposition,'review_only');assert.equal(r.purge_permitted,false);
});
test('R8 management 1 calendar year honors leap day, statutory longer hold',async()=>{
 const t=Date.UTC(2024,1,29),row={brand_id:'starry',event_ref:'admin1',classification:'important_management',occurred_at_ms:t};
 const port=until=>({status:async()=>({legal_hold:'clear',statutory_keep_until_ms:until}),
  approvedReview:async()=>true});
 assert.equal((await planAuditReview(row,Date.UTC(2025,1,28),port(null))).disposition,'not_due');
 assert.equal((await planAuditReview(row,Date.UTC(2025,2,1),port(null))).disposition,'review_only');
 assert.equal((await planAuditReview(row,Date.UTC(2025,2,1),port(Date.UTC(2026,0,1)))).disposition,'not_due');
});
test('R8 legal hold, approval missing, authority unavailable all block',async()=>{
 const t=Date.UTC(2025,0,1),row={brand_id:'starry',event_ref:'audit1',classification:'ordinary',occurred_at_ms:t};
 for(const x of [
  {status:async()=>({legal_hold:'held',statutory_keep_until_ms:null}),approvedReview:async()=>true},
  {status:async()=>({legal_hold:'unknown',statutory_keep_until_ms:null}),approvedReview:async()=>true},
  {status:async()=>{throw Error('outage')},approvedReview:async()=>true},
  {status:async()=>({legal_hold:'clear',statutory_keep_until_ms:null}),approvedReview:async()=>false},
 ]){
  const r=await planAuditReview(row,t+400*86400000,x);assert.equal(r.disposition,'blocked');
  assert.equal(r.purge_permitted,false);
 }
});
test('R8 retention rejects H-Global, future timestamps and malformed classifications',async()=>{
 const t=Date.UTC(2025,0,1),legal={status:async()=>({legal_hold:'clear',statutory_keep_until_ms:null}),approvedReview:async()=>true};
 for(const row of [{brand_id:'hglobal',event_ref:'a1',classification:'ordinary',occurred_at_ms:t},
  {brand_id:'starry',event_ref:'a1',classification:'unknown',occurred_at_ms:t},
  {brand_id:'starry',event_ref:'pii@email',classification:'ordinary',occurred_at_ms:t}]){
  assert.equal((await planAuditReview(row,t+100*86400000,legal)).disposition,'blocked');
 }
});
