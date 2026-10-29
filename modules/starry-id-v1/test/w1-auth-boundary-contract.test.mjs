import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
 W1_AUTH_SELF_PATH,W1_AUTH_PROFILE_FIELDS,W1_AUTH_EVENT_CORE_NAMES,
 W1_AUTH_EVENT_CONDITIONAL_NAME,W1_AUTH_PRIVATE_ENVELOPE_CANDIDATES,
 W1_AUTH_LIVE_ENABLED,reviewW1AuthPublicCoreNames,reviewW1AuthReadRouteMetadata
} from '../src/w1-auth-boundary-contract.ts';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const read=p=>JSON.parse(readFileSync(root+p,'utf8'));
const proposal=read('modules/starry-id-v1/W1-AUTH-SOURCE-MAP.v1.json');
const eventKeys=[...W1_AUTH_EVENT_CORE_NAMES];
test('W1 read route and exactly five profile fields, no sixth/private field',()=>{
 assert.equal(W1_AUTH_SELF_PATH,'/v1/starry-id/members/me');
 assert.deepEqual([...W1_AUTH_PROFILE_FIELDS],proposal.read_response_exact_fields);
 assert.equal(new Set(W1_AUTH_PROFILE_FIELDS).size,5);assert.equal(W1_AUTH_LIVE_ENABLED,false);
 assert.ok(!W1_AUTH_PROFILE_FIELDS.includes('email'));
});
test('D06 exact 11 core names are accepted for review only, no release',()=>{
 const x=reviewW1AuthPublicCoreNames(eventKeys);
 assert.equal(x.status,'review_only');assert.equal(x.may_publish,false);
 assert.equal(x.may_write_live_d1,false);assert.equal(x.may_ack,false);
});
test('D06 one conditional idempotency field is review-only; do not invent 13th',()=>{
 const x=reviewW1AuthPublicCoreNames([...eventKeys,W1_AUTH_EVENT_CONDITIONAL_NAME]);
 assert.equal(x.status,'review_only');assert.equal(x.verified_live,false);
 assert.equal(eventKeys.length,11);
});
test('D06 public layer denies missing/duplicate/unknown/17-field unapproved payload',()=>{
 for(const x of [eventKeys.slice(1),[...eventKeys,eventKeys[0]],[...eventKeys,'actor_id'],
  [...eventKeys,'session_id'],[...eventKeys,'raw_token'],[...eventKeys,'issuer'],
  [...eventKeys,'session_ref_hash'],[...eventKeys,'unknown_thirteenth'],
  Array(17).fill('event_id'),null,{fields:eventKeys}]){
   assert.equal(reviewW1AuthPublicCoreNames(x).status,'denied');
 }
});
test('field-name review rejects field-value objects and inherited extra fields',()=>{
 assert.equal(reviewW1AuthPublicCoreNames({'event_id':'token'}).status,'denied');
 assert.ok(W1_AUTH_PRIVATE_ENVELOPE_CANDIDATES.every(x=>!eventKeys.includes(x)));
});
test('read-route metadata only accepts Starry central GET exact path, no client identity',()=>{
 const good={method:'GET',path:W1_AUTH_SELF_PATH,brand_id:'starry',app_id:'starry-id'};
 assert.equal(reviewW1AuthReadRouteMetadata(good).status,'review_only');
 for(const x of [{...good,method:'POST'},{...good,path:'/v1/member/self'},
  {...good,app_id:'echo'}, {...good,brand_id:'hglobal'},
  {...good,authorization:'Bearer redacted'}, {...good,s_user_id:'attacker'},
  {method:'GET'},new Date(),null]){
  const v=reviewW1AuthReadRouteMetadata(x);
  assert.equal(v.status,'denied');assert.equal(v.may_publish,false);
 }
});
test('route review rejects accessor/prototype/symbol claim smuggling',()=>{
 const good={method:'GET',path:W1_AUTH_SELF_PATH,brand_id:'starry',app_id:'starry-id'};
 const accessor={...good};
 Object.defineProperty(accessor,'method',{get(){throw Error('MUST_NOT_ACCESS')}});
 assert.equal(reviewW1AuthReadRouteMetadata(accessor).status,'denied');
 assert.equal(reviewW1AuthReadRouteMetadata(Object.assign(Object.create({privileged:true}),good)).status,'denied');
 const sym={...good};sym[Symbol('hidden')]=true;
 assert.equal(reviewW1AuthReadRouteMetadata(sym).status,'denied');
});
test('all 22 source IDs and actual R8 decision class preserved; no owner semantic approval',()=>{
 const inventory=read('docs/requirements/original-inventory.v0.json');
 const reconciliation=read('docs/requirements/source-reconciliation-r8.v0.json');
 assert.equal(proposal.entries.length,22);
 assert.equal(new Set(proposal.entries.map(x=>x.source_id)).size,22);
 for(const x of proposal.entries){
  const orig=inventory.entries.find(y=>y.id===x.source_id);
  const r8=reconciliation.entries.find(y=>y.source_id===x.source_id);
  assert.equal(x.source_title,orig.title);
  assert.equal(x.source_title,r8.source_title);
  assert.equal(x.r8_decision_class,r8.decision_class);
  assert.equal(x.semantic_approval_by_this_packet,false);
  assert.equal(x.live_verified,false);
 }
 assert.equal(reconciliation.source_clause_reconciled_count,0);
 assert.deepEqual(proposal.entries.filter(x=>x.r8_decision_class==='superseded_by_latest')
  .map(x=>x.source_id),['01.05','02.07','05.01']);
});
test('D87/D00/D06 approved direction cannot become Live Gate or physical DB grant',()=>{
 assert.equal(proposal.gate.g00_g10_release,'blocked');
 assert.equal(proposal.gate.release_authorized,false);
 assert.equal(proposal.gate.deploy_allowed,false);
 assert.equal(proposal.gate.auth_live_verified,false);
 assert.match(proposal.direction.D87,/direction-approved-physical-boundaries-pending/);
 assert.match(proposal.direction.D06,/schema-pending/);
});

test('D06 review field arrays reject accessor/sparse/proxy rather than evaluating caller code',()=>{
 const evil=[...eventKeys];
 Object.defineProperty(evil,0,{get(){throw Error('MUST_NOT_INVOKE')}});
 assert.equal(reviewW1AuthPublicCoreNames(evil).status,'denied');
 const sparse=[...eventKeys];delete sparse[1];
 assert.equal(reviewW1AuthPublicCoreNames(sparse).status,'denied');
 const proxy=new Proxy([...eventKeys],{getOwnPropertyDescriptor(){throw Error('TRAP')}});
 assert.equal(reviewW1AuthPublicCoreNames(proxy).status,'denied');
});
