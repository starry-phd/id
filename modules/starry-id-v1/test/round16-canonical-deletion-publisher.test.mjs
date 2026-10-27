import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineCanonicalAuthDeletionPublisher,isSealedAuthDeletionDispatchClaim,
 LIVE_AUTH_DELETION_PUBLISHER_ENABLED,AUTH_CANONICAL_PUBLISHER_ID,
 AUTH_DELETION_TRANSPORT_ACK_ALLOWED,AUTH_CLAIM_SQL}
 from '../src/round16-canonical-deletion-publisher.ts';
const now=1793000000,scope={brand_id:'starry',environment:'staging'};
const eventId='starry-delete-'+'a'.repeat(64);
const verifiedRow={event_id:eventId,s_user_id:'u1',occurred_at:now,
 event_type:'account_deleted',auth_version:4,member_status:'deleted',
 member_updated_at:now,profile_name:null,directory_opt_in:0,
 display_name_public:0,pending_sessions:0};
function make(cfg={}){
 const log=[];let sourceReads=0;
 const db={prepare(sql){
  const entry={sql,args:[]};log.push(entry);
  return {bind(...args){entry.args=args;return{first:async()=>{
   if(sql===AUTH_CLAIM_SQL){
    if(cfg.denyLease)return null;
    return {event_id:eventId,publisher_id:AUTH_CANONICAL_PUBLISHER_ID,
      lease_token:args[0],lease_expires_at:args[1],attempt_no:cfg.attempt??1};
   }
   sourceReads++;
   if(cfg.outage)throw Error('DB DOWN');
   if(cfg.changeAtSecondRead&&sourceReads===2)return {...verifiedRow,member_status:'active'};
   return Object.hasOwn(cfg,'row')?cfg.row:verifiedRow;
  }};}};
 }};
 const p=createOfflineCanonicalAuthDeletionPublisher({scope,db,
  enabled:cfg.enabled??true,readServerNow:()=>Object.hasOwn(cfg,'now')?cfg.now:now,
  lawfulDeletionProcessingApprovedNow:async()=>Object.hasOwn(cfg,'legal')?cfg.legal:true});
 return {p,log,get sourceReads(){return sourceReads}};
}
test('off by default; fail-closed legal gate never queries Auth database',async()=>{
 assert.equal(LIVE_AUTH_DELETION_PUBLISHER_ENABLED,false);
 assert.equal(AUTH_DELETION_TRANSPORT_ACK_ALLOWED,false);
 const off=make({enabled:false});
 assert.equal(await off.p.claim(eventId),null);assert.equal(off.log.length,0);
 const denied=make({legal:false});
 assert.equal(await denied.p.claim(eventId),null);assert.equal(denied.log.length,0);
 for(const wrong of [{brand_id:'hglobal',environment:'staging'},
  {brand_id:'starry',environment:'production'}])
 assert.throws(()=>createOfflineCanonicalAuthDeletionPublisher({
  scope:wrong,db:{prepare(){throw Error('should not execute')}},
  readServerNow:()=>now,lawfulDeletionProcessingApprovedNow:async()=>true}),
  /AUTH_SOLE_PUBLISHER_CONFIG_DENIED/);
});
test('one Auth-only owner, 256-bit random lease token, same event ID, mandatory second source check',async()=>{
 const x=make();const claim=await x.p.claim(eventId);
 assert.ok(claim);
 assert.equal(claim.publisher_id,'starry-auth-sole-v1');
 assert.equal(claim.event.event_id,eventId);
 assert.deepEqual(claim.event,{event_id:eventId,member_ref:'u1',
  occurred_at_sec:now,event_type:'account_deleted'});
 assert.match(claim.lease_token,/^[a-f0-9]{64}$/);
 assert.equal(claim.lease_expires_at,now+30);
 assert.equal(isSealedAuthDeletionDispatchClaim(claim),true);
 assert.equal(isSealedAuthDeletionDispatchClaim({...claim}),false);
 assert.equal(x.sourceReads,2);
 assert.equal(x.log.length,3);
 assert.equal(x.log[1].sql,AUTH_CLAIM_SQL);
 assert.deepEqual(x.log[1].args.slice(2),[eventId,'staging',now,now]);
 assert.equal(claim.may_ack_queue,false);
 assert.equal(claim.may_mark_delivered,false);
 assert.equal(claim.may_regrant,false);
 assert.equal(claim.live,false);
 assert.equal(typeof x.p.send,'undefined');
 assert.equal(typeof x.p.ack,'undefined');
});
test('database lease conflict and invalid producer receipts are denied without delivery',async()=>{
 for(const cfg of [{denyLease:true},{attempt:0},{attempt:1001},
  {row:{...verifiedRow,member_status:'active'}},
  {row:{...verifiedRow,pending_sessions:1}},
  {changeAtSecondRead:true},{outage:true},{now:NaN}]){
  const x=make(cfg);
  assert.equal(await x.p.claim(eventId),null,JSON.stringify(cfg));
 }
});
test('invalid event ID, added requester props and no acknowledgement APIs',async()=>{
 const x=make();
 assert.equal(await x.p.claim({eventId,verified:true}),null);
 assert.equal(await x.p.claim('not valid'),null);
 assert.equal(x.log.length,0);
 assert.equal(x.p.publisher_status,'CANDIDATE_NOT_APPROVED_CANONICAL_PROTOCOL');
});
