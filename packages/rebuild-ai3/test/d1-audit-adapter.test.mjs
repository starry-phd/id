import test from 'node:test';
import assert from 'node:assert/strict';
import {createAi3AuditD1Store} from '../src/d1-audit-adapter.ts';
import {createRound4BillingAuditConsumer} from '../src/queue-consumer.ts';
import {CANDIDATE_VERSION,BATTERY} from '../src/index.ts';
const key='b_'+'a'.repeat(64),digest='b'.repeat(64);
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const p05={...scope,schema_version:'billing.p05.v1-candidate',event_id:key,
 event_type:'billing.store_state_observed',occurred_at:'2026-10-26T08:12:00Z',
 correlation_id:key,idempotency_key:key,actor_ref:'anon_serverproof',resource_ref:key,
 result:'recorded',classification:'metadata_only'};
const meta={...p05,schema_version:CANDIDATE_VERSION};
function mockD1(){
 const tables={inbox:new Map(),audit:new Map(),quarantine:new Map()};
 let failBatchAt=0,unsafeReceipt=false,batches=0;
 return {
  tables,get batches(){return batches},
  failAt:n=>failBatchAt=n,receipt:s=>unsafeReceipt=s,
  prepare(sql){return {bind(...args){return {sql,args}}}},
  async batch(stmts){
   batches++;
   if(unsafeReceipt)return [{success:false,results:[]}];
   const state={
    inbox:new Map(tables.inbox),audit:new Map(tables.audit),
    quarantine:new Map(tables.quarantine),
   };
   const results=[];
   for(let i=0;i<stmts.length;i++){
    if(failBatchAt===i+1)throw Error('simulated atomic batch abort');
    const {sql,args}=stmts[i];
    assert.equal(sql.includes('?'),true,'all SQL must be bound');
    let res={success:true,meta:{changes:0},results:[]};
    if(sql.startsWith('INSERT INTO ai3_r4_inbox')){
     assert.match(sql,/ON CONFLICT\(brand_id,app_id,environment,idempotency_key\) DO NOTHING/);
     const k=args.slice(0,4).join('|');
     if(!state.inbox.has(k)){
      state.inbox.set(k,{event_id:args[4],payload_digest:args[5]});
      res.meta.changes=1;
     }
    }else if(sql.startsWith('INSERT INTO ai3_r4_audit')){
     assert.match(sql,/WHERE EXISTS/);
     const k=args.slice(0,3).join('|')+'|'+args[4];
     const inbox=state.inbox.get(k);
     const auditKey=args.slice(0,4).join('|');
     if(inbox&&inbox.event_id===args[3]&&inbox.payload_digest===args.at(-1)
       &&!state.audit.has(auditKey)){
      state.audit.set(auditKey,{
       event_id:args[3],idempotency_key:args[4],schema_version:args[5],
       event_type:args[6],occurred_at:args[7],actor_ref:args[8],
       resource_ref:args[9],classification:args[10],result:args[11],
      });res.meta.changes=1;
     }
    }else if(sql.startsWith('SELECT event_id,payload_digest')){
     const found=state.inbox.get(args.join('|'));res.results=found?[found]:[];
    }else if(sql.startsWith('SELECT event_id,idempotency_key')){
     const found=state.audit.get(args.join('|'));res.results=found?[found]:[];
    }else if(sql.startsWith('INSERT INTO ai3_r4_quarantine')){
     const k=args.join('|');if(!state.quarantine.has(k)){state.quarantine.set(k,true);res.meta.changes=1;}
    }else if(sql.startsWith('SELECT reason FROM ai3_r4_quarantine')){
     res.results=state.quarantine.has(args.join('|'))?[{reason:args[4]}]:[];
    }else throw Error('unexpected SQL '+sql);
    results.push(res);
   }
   tables.inbox=state.inbox;tables.audit=state.audit;
   tables.quarantine=state.quarantine;
   return results;
  },
 };
}
const claim=(digestInput=digest)=>({
 scope,key,eventId:key,digest:digestInput,event:meta,
});
test('D1 batch writes inbox and audit atomically, then duplicate is idempotent',async()=>{
 const db=mockD1(),store=createAi3AuditD1Store(db,scope);
 assert.equal(await store.claimAndAppendAtomically(claim()),'inserted');
 assert.equal(db.tables.inbox.size,1);assert.equal(db.tables.audit.size,1);
 assert.equal(await store.claimAndAppendAtomically(claim()),'duplicate');
 assert.equal(db.tables.audit.size,1);assert.equal(BATTERY.purchasable,false);
});
test('same event key with changed digest is conflict, not ACK',async()=>{
 const db=mockD1(),store=createAi3AuditD1Store(db,scope);
 await store.claimAndAppendAtomically(claim());
 assert.equal(await store.claimAndAppendAtomically(claim('c'.repeat(64))),'conflict');
 assert.equal(db.tables.audit.size,1);
});
test('crash in second statement produces no commit receipt and no partial audit',async()=>{
 const db=mockD1(),store=createAi3AuditD1Store(db,scope);
 db.failAt(2);
 await assert.rejects(store.claimAndAppendAtomically(claim()),/abort/);
 assert.equal(db.tables.inbox.size,0);assert.equal(db.tables.audit.size,0);
 db.failAt(0);assert.equal(await store.claimAndAppendAtomically(claim()),'inserted');
});
test('untrustworthy D1 batch result fails closed',async()=>{
 const db=mockD1(),store=createAi3AuditD1Store(db,scope);
 db.receipt(true);
 await assert.rejects(store.claimAndAppendAtomically(claim()),/TRANSACTION_UNCERTAIN/);
 assert.equal(db.tables.audit.size,0);
});
test('reject cross environment, unsafe event/actor and invalid digest',async()=>{
 const store=createAi3AuditD1Store(mockD1(),scope);
 for(const bad of [
  {...claim(),scope:{...scope,environment:'production'}},
  {...claim(),event:{...meta,actor_ref:'email@private'}},
  {...claim(),event:{...meta,event_id:'client_override'}},
  {...claim(),digest:'payload_json'},
 ]){
  await assert.rejects(store.claimAndAppendAtomically(bad));
 }
 assert.throws(()=>createAi3AuditD1Store(mockD1(),{...scope,environment:'production'}),/DRAFT_ONLY/);
});
test('quarantine requires durable return and exact safe reason',async()=>{
 const db=mockD1(),store=createAi3AuditD1Store(db,scope);
 await store.recordQuarantine(scope,key,'IDEMPOTENCY_DIGEST_CONFLICT');
 await store.recordQuarantine(scope,key,'IDEMPOTENCY_DIGEST_CONFLICT');
 assert.equal(db.tables.quarantine.size,1);
 await assert.rejects(store.recordQuarantine(scope,key,'secret at alice@example.com'),/QUARANTINE_DENIED/);
 db.failAt(2);
 await assert.rejects(store.recordQuarantine(scope,key,'STALE_BILLING_EVENT'),/abort/);
 assert.equal(db.tables.quarantine.size,1);
});
test('Round4 consumer quarantines source-proven stale events but retains audit-only rule',async()=>{
 const db=mockD1(),store=createAi3AuditD1Store(db,scope);
 let freshness='superseded';
 const consumer=createRound4BillingAuditConsumer(scope,
  {schemaVersion:'billing.p05.v1-candidate',accepts:async()=>true},
  {readAfterCommit:async()=>({p05,payload_digest:digest,committed:true,provider_verified:true})},
  store,{afterCommitOrder:async()=>freshness});
 const first=await consumer.consume(key,1);
 assert.equal(first.outcome,'quarantine_recorded');
 assert.equal(db.tables.audit.size,0);assert.equal(db.tables.quarantine.size,1);
 freshness='current';
 assert.equal((await consumer.consume(key,2)).outcome,'ack');
 assert.equal(db.tables.audit.size,1);
});
test('round4 missing/unknown freshness source blocks writes, retries',async()=>{
 const db=mockD1(),store=createAi3AuditD1Store(db,scope);
 assert.throws(()=>createRound4BillingAuditConsumer(scope,
  {schemaVersion:'billing.p05.v1-candidate',accepts:async()=>true},
  {readAfterCommit:async()=>null},store,null),/AUTHORITY_REQUIRED/);
 const consumer=createRound4BillingAuditConsumer(scope,
  {schemaVersion:'billing.p05.v1-candidate',accepts:async()=>true},
  {readAfterCommit:async()=>({p05,payload_digest:digest,committed:true,provider_verified:true})},
  store,{afterCommitOrder:async()=> 'unknown'});
 const r=await consumer.consume(key,1);
 assert.equal(r.outcome,'retry');assert.equal(r.ack_safe,false);
 assert.equal(db.tables.audit.size,0);
});
