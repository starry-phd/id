import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerIdentityResolver,isTrustedPrincipal} from '../src/index.ts';
import {createOfflineReviewerAuthority,isTrustedReviewerReceipt} from '../src/round9-appeal-reviewer.ts';
const now=1793000000,caseRef='case_'+'a'.repeat(64);
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const member={s_user_id:'s1',status:'active',auth_version:3,profile_revision:1,display_name:null,directory_opt_in:false,display_name_public:false};
const session={session_id:'sid1',s_user_id:'s1',app_id:'starry-id',environment:'staging',
 auth_version:3,expires_at:now+600,revoked_at:null,step_up_method:'passkey',
 step_up_verified_at:now,step_up_expires_at:now+60};
async function mint(){
 const resolver=createServerIdentityResolver({trusted_scope:scope,
 verify_oidc_or_session:async()=>({brand_id:'starry',app_id:'starry-id',environment:'staging',
 provider:'apple',provider_subject:'sub',s_user_id:'s1',session_id:'sid1',
 auth_version:3,expires_at:now+300}),
 read_member:async()=>member,read_session:async()=>session,identity_matches:async()=>true});
 return resolver('synthetic-server-verification',now);
}
function make(opts={}){
 let auditCount=0,reads=0;const auditEvents=[],sql=[];
 const grant={permission:'appeal:review_status',expires_at:now+200,revoked_at:null,auth_version:3,
 role:'supreme',role_revoked_at:null,member_version:3,member_status:'active',...opts.grant};
 const backend={
 db:{prepare(q){sql.push(q);return {bind(...args){sql.push(args);return {first:async()=>opts.noGrant?null:grant};}}}},
 readCurrentMember:async()=>opts.member??member,
 readCurrentSession:async()=>opts.session??session,
 abuseLimit:async()=>opts.rate??true,
 privacyCanReview:async()=>opts.privacy??true,
 readMinimalCase:async()=>{reads++;if(opts.throwRead)throw Error('store down');return opts.info??{
  case_ref:caseRef,status:'reviewing',updated_ms:now*1000-100};},
 appendAuditAccess:async e=>{auditCount++;auditEvents.push(e);if(opts.throwAudit)throw Error('audit down');
  return opts.audit??{persisted:true,event_ref:'audit-r9-event-0000001'};},
 };
 return {backend,get auditCount(){return auditCount},get reads(){return reads},auditEvents,sql,
 gate:createOfflineReviewerAuthority({scope,backend,enabled:opts.enabled??true})};
}
test('default OFF rejects without touching D1, privacy or audit',async()=>{
 const p=await mint();const x=make({enabled:false});
 assert.equal(await x.gate.review(p,'appeal:review_status',caseRef,now),null);
 assert.equal(x.sql.length,0);assert.equal(x.auditCount,0);assert.equal(x.reads,0);
});
test('scope/prod/hglobal and forged principal cannot issue reviewer receipts',async()=>{
 const p=await mint();assert.equal(isTrustedPrincipal(p),true);
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'},{...scope,app_id:'bad/path'}]){
  assert.throws(()=>createOfflineReviewerAuthority({scope:s,backend:make().backend,enabled:true}),/REVIEW_SCOPE_DENIED/);
 }
 const x=make();
 assert.equal(await x.gate.review({...p},'appeal:review_status',caseRef,now),null);
 assert.equal(await x.gate.review({admin:true,verified:true},'appeal:review_status',caseRef,now),null);
 assert.equal(await x.gate.review(p,'member:delete',caseRef,now),null);
 assert.equal(await x.gate.review(p,'appeal:review_status','case_secret',now),null);
 assert.equal(x.sql.length,0);
});
test('real sealed principal + current session + exact grant yields only minimal audited receipt',async()=>{
 const p=await mint(),x=make();
 const res=await x.gate.review(p,'appeal:review_status',caseRef,now);
 assert.equal(res.status,'reviewing');assert.equal(res.case_ref,caseRef);
 assert.equal(isTrustedReviewerReceipt(res),true);
 assert.equal(isTrustedReviewerReceipt({...res}),false);
 assert.deepEqual(Object.keys(res).sort(),['case_ref','checked_at','purpose','status','updated_ms'].sort());
 assert.equal(x.auditCount,1);
 assert.equal(x.auditEvents[0].actor_id,'s1');
 assert.equal(x.auditEvents[0].purpose,'appeal:review_status');
 assert.equal(x.sql.length,2);
 assert.deepEqual(x.sql[1],['s1','starry-id','staging','appeal:review_status']);
 for(const keyword of ['g.app_id=?','g.environment=?','g.permission=?','a.environment=g.environment','m.s_user_id=g.s_user_id'])
  assert.ok(x.sql[0].includes(keyword),keyword);
});
test('role alone never grants access, including supreme; delegated explicit grant allowed',async()=>{
 const p=await mint();
 for(const cfg of [{noGrant:true},{grant:{permission:'privacy:review_retention'}},
  {grant:{revoked_at:now}},{grant:{role_revoked_at:now}},{grant:{expires_at:now}},
  {grant:{auth_version:2}},{grant:{member_version:4}},{grant:{role:'unrecognized'}},
  {grant:{member_status:'deleted'}}]){
  const x=make(cfg);
  assert.equal(await x.gate.review(p,'appeal:review_status',caseRef,now),null);
  assert.equal(x.reads,0);assert.equal(x.auditCount,0);
 }
 const x=make({grant:{role:'delegated'}});
 assert.equal((await x.gate.review(p,'appeal:review_status',caseRef,now)).status,'reviewing');
});
test('wrong member version/status and revoked or stale step-up all deny',async()=>{
 const p=await mint();
 for(const cfg of [{member:{...member,status:'deleted'}},{member:{...member,status:'suspended'}},
  {member:{...member,auth_version:4}},
  {session:{...session,revoked_at:now}},
  {session:{...session,auth_version:4}},
  {session:{...session,app_id:'hglobal'}},
  {session:{...session,step_up_method:null}},
  {session:{...session,step_up_verified_at:now-301}},
  {session:{...session,step_up_expires_at:now}}]){
  const x=make(cfg);
  assert.equal(await x.gate.review(p,'appeal:review_status',caseRef,now),null);
  assert.equal(x.reads,0);assert.equal(x.auditCount,0);
 }
 const x=make();
 assert.equal(await x.gate.review(p,'appeal:review_status',caseRef,now+301),null);
});
test('rate/privacy/unknown legal decision & case mismatch fail before audit',async()=>{
 const p=await mint();
 for(const cfg of [{rate:false},{privacy:false},{privacy:null},
  {info:{case_ref:'case_'+'b'.repeat(64),status:'reviewing',updated_ms:now*1000}},
  {info:{case_ref:caseRef,status:'unknown',updated_ms:now*1000}},
  {throwRead:true}]){
  const x=make(cfg);
  assert.equal(await x.gate.review(p,'appeal:review_status',caseRef,now),null);
  assert.equal(x.auditCount,0);
 }
});
test('no durable audit, wrong acknowledgement and audit outage fail closed',async()=>{
 const p=await mint();
 for(const cfg of [{audit:null},{audit:{persisted:false,event_ref:'a'}},
  {audit:{persisted:true,event_ref:''}},{throwAudit:true}]){
  const x=make(cfg);
  assert.equal(await x.gate.review(p,'appeal:review_status',caseRef,now),null);
  assert.equal(x.auditCount,1);
 }
});
test('privacy retention review is separate permission and does not purge any record',async()=>{
 const p=await mint(),x=make({grant:{permission:'privacy:review_retention'}});
 assert.equal(await x.gate.review(p,'appeal:review_status',caseRef,now),null);
 const res=await x.gate.review(p,'privacy:review_retention',caseRef,now);
 assert.equal(res.purpose,'privacy:review_retention');
 assert.equal(x.auditEvents.length,1);
 assert.equal(Object.hasOwn(res,'delete'),false);
});
