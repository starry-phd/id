import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {handleRequest} from '../src/index.ts';
import {
 R006_VERSION,R006_CANONICAL_VERSION,R006_CANONICAL_PURPOSE,R006_HMAC_DOMAIN,
 R006_FIELDS,R006_P05_DEPENDENCIES,R006_PUBLIC_ROUTES,R006_ADS_OFF,
 reviewR006P05VNextSchema,proposeR006PublicError
} from '../src/wave1-r006-p05-vnext-error-only.ts';
import {AI0_R005_P05_VERSION} from '../../../packages/integration/src/ai0-r005-p05-canonical-offline-verifier.ts';
import {R005_ENVELOPE_AUTH_VERSION} from '../../../modules/starry-id-v1/src/wave1-round005-sealed-event-session-authority.ts';
const NOW=1793200000;
function canonical(extra={}){
 const o={
  version:R006_CANONICAL_VERSION,purpose:R006_CANONICAL_PURPOSE,
  brand_id:'starry',app_id:'starry-id',environment:'development',
  event_id:'event-12345678',event_type:'notification.delivery.queued',
  actor_ref:'actor-12345678',auth_version:1,session_version:2,
  idempotency_key:'idem-12345678',issuer_kid:'kid-vnext-01',
  issuer_epoch:1,issued_at:NOW-12,expires_at:NOW+45,
  nonce:'abcdefghABCDEFGH',payload_sha256:'a'.repeat(64),...extra
 };
 return Object.fromEntries(R006_FIELDS.map(k=>[k,o[k]]));
}
const wrap=(envelope=canonical(),mac_hex='b'.repeat(64))=>({envelope,mac_hex});
function denied(r,reason,shape=false){
 assert.equal(r.contract,R006_VERSION);
 assert.equal(r.status,'blocked');assert.equal(r.reason,reason);
 assert.equal(r.schema_candidate,shape);
 assert.equal(r.field_count,shape?17:0);
 for(const k of ['may_verify_p05','may_authenticate','may_send',
   'may_ack_queue','may_claim_receipt','may_charge','may_grant',
   'may_initialize_ads','may_request_ad','may_deploy','publishable'])
  assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r));
}
test('actual AI0 and AI1 R005 versions remain distinct and live false',()=>{
 assert.equal(R006_P05_DEPENDENCIES.ai0_legacy_r005,AI0_R005_P05_VERSION);
 assert.equal(R006_P05_DEPENDENCIES.ai1_legacy_r005,R005_ENVELOPE_AUTH_VERSION);
 assert.notEqual(AI0_R005_P05_VERSION,R005_ENVELOPE_AUTH_VERSION);
 for(const k of ['old_ai0_live','old_ai1_live','new_signer_authorized',
  'new_crypto_verifier_authorized','new_hmac_key_installed',
  'session_replay_ledger_authorized','live_ack_authorized'])
  assert.equal(R006_P05_DEPENDENCIES[k],false);
});
test('AI0 Issue #1 vNext owns exact 17 ordered fields and domain-separated HMAC bytes',()=>{
 assert.equal(R006_FIELDS.length,17);
 assert.deepEqual([...R006_FIELDS],[
 'version','purpose','brand_id','app_id','environment','event_id',
 'event_type','actor_ref','auth_version','session_version',
 'idempotency_key','issuer_kid','issuer_epoch','issued_at',
 'expires_at','nonce','payload_sha256']);
 assert.equal(R006_HMAC_DOMAIN,'starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1');
 const e=canonical();
 const bytes=JSON.stringify([R006_HMAC_DOMAIN,...R006_FIELDS.map(k=>e[k])]);
 assert.deepEqual(JSON.parse(bytes).slice(0,3),[
  R006_HMAC_DOMAIN,R006_CANONICAL_VERSION,R006_CANONICAL_PURPOSE]);
 assert.equal(JSON.parse(bytes).length,18);
});
test('complete well-shaped 17 key envelope is still only UNTRUSTED, no MAC verified',()=>{
 denied(reviewR006P05VNextSchema(wrap(),NOW),'OWNER_GATE_REQUIRED',true);
});
test('all four AI0 R005 event types recognized structurally but still blocked',()=>{
 for(const type of ['notification.delivery.queued','identity.session.revoked',
  'identity.member.deleted','privacy.erasure.requested'])
  denied(reviewR006P05VNextSchema(wrap(canonical({event_type:type})),NOW),
    'OWNER_GATE_REQUIRED',true);
});
test('legacy AI0 {event,signature_hex} and AI1 {envelope,mac} dialects rejected',()=>{
 denied(reviewR006P05VNextSchema({event:canonical(),signature_hex:'a'.repeat(64)},NOW),
   'LEGACY_DIALECT_REJECTED');
 denied(reviewR006P05VNextSchema({envelope:canonical(),mac:'a'.repeat(64)},NOW),
   'LEGACY_DIALECT_REJECTED');
});
test('wrapper extra signature proof flags, key lease and unexpected keys rejected',()=>{
 for(const p of [{signature_verified:true},{can_ack:true},{loggedIn:true},
   {server_asserted:true},{key:'secrets'}])
  denied(reviewR006P05VNextSchema({...wrap(),...p},NOW),'INVALID_WRAPPER');
});
test('17 exact own data keys, missing/extras and accessors fail closed',()=>{
 const e=canonical();
 const out={...e};delete out.payload_sha256;
 denied(reviewR006P05VNextSchema(wrap(out),NOW),'INVALID_ENVELOPE');
 denied(reviewR006P05VNextSchema(wrap({...e,foo:'ok'}),NOW),'INVALID_ENVELOPE');
 // The AI-0 #219 source canonicalizes signed bytes using its fixed fields
 // regardless of input object insertion order; public review remains denied.
 denied(reviewR006P05VNextSchema(wrap(Object.fromEntries(
  [...Object.entries(e)].reverse())),NOW),'OWNER_GATE_REQUIRED',true);
 let reads=0;
 const g=canonical();
 Object.defineProperty(g,'actor_ref',{enumerable:true,get(){reads++;throw Error('evil');}});
 denied(reviewR006P05VNextSchema(wrap(g),NOW),'INVALID_ENVELOPE');
 assert.equal(reads,0);
});
test('invalid KID, issuer epoch, auth/session versions, nonce/payload digest fail',()=>{
 for(const p of [{issuer_kid:'!bad'}, {issuer_epoch:0},
   {auth_version:-1},{session_version:NaN},{nonce:'tiny'},
   {payload_sha256:'a'.repeat(63)}, {event_id:'x'},
   {actor_ref:'x'}, {idempotency_key:'bad'}])
  denied(reviewR006P05VNextSchema(wrap(canonical(p)),NOW),'INVALID_ENVELOPE');
});
test('MAC must be 64 lower hex, never proof of cryptographic verification',()=>{
 for(const mac of ['ABC','A'.repeat(64),'g'.repeat(64),null,42])
  denied(reviewR006P05VNextSchema(wrap(canonical(),mac),NOW),'INVALID_ENVELOPE');
});
test('Starry development/staging only, never production or HGlobal',()=>{
 denied(reviewR006P05VNextSchema(wrap(canonical({environment:'production'})),NOW),
  'PRODUCTION_BLOCKED');
 for(const p of [{brand_id:'hglobal'},{environment:'preview'}])
  denied(reviewR006P05VNextSchema(wrap(canonical(p)),NOW),'SCOPE_DENIED');
});
test('event type allowlist denies unknown events and client-defined actions',()=>{
 for(const event_type of ['payment.succeeded','p05.ack','unknown'])
  denied(reviewR006P05VNextSchema(wrap(canonical({event_type})),NOW),
   'EVENT_TYPE_DENIED');
});
test('TTL above 120, expired, issued after +5s or unsafe timestamps reject',()=>{
 for(const p of [{expires_at:NOW+300},{expires_at:NOW-13},
  {issued_at:NOW+6,expires_at:NOW+16},
  {issued_at:NaN},{expires_at:Infinity},{issued_at:-1},
  {expires_at:NOW-1},{issued_at:NOW,expires_at:NOW}])
  denied(reviewR006P05VNextSchema(wrap(canonical(p)),NOW),
   'BAD_TIME_OR_TTL');
});
test('<=5 sec future skew and max 120 second TTL still never authorize',()=>{
 denied(reviewR006P05VNextSchema(wrap(canonical({
  issued_at:NOW+5,expires_at:NOW+125
 })),NOW),'OWNER_GATE_REQUIRED',true);
});
test('current time cannot be spoofed into a trusted MAC or live service',()=>{
 for(const now of [undefined,'now',NaN,Infinity,-1])
  denied(reviewR006P05VNextSchema(wrap(),now),'BAD_TIME_OR_TTL');
});
test('prototype objects, getters and hostile accessors cannot execute',()=>{
 let reads=0;
 const w=wrap();
 Object.defineProperty(w,'mac_hex',{enumerable:true,get(){reads++;throw Error('secret');}});
 denied(reviewR006P05VNextSchema(w,NOW),'INVALID_WRAPPER');
 assert.equal(reads,0);
 denied(reviewR006P05VNextSchema(Object.assign(Object.create({admin:true}),wrap()),NOW),
  'INVALID_WRAPPER');
 for(const raw of [null,42,[],{},'fake'])
  denied(reviewR006P05VNextSchema(raw,NOW),'INVALID_WRAPPER');
});
test('R005 Ads OFF and all per-App SDK / AdUnit gates remain disabled',()=>{
 assert.equal(R006_ADS_OFF.provider,'google-admob-mediation');
 for(const [key,val] of Object.entries(R006_ADS_OFF))
  if(key!=='provider')assert.equal(val,false,key);
});
test('protected future DTOs pin vNext and stay UNREGISTERED in actual Worker',async()=>{
 const yaml=readFileSync(new URL('../openapi.yaml',import.meta.url),'utf8');
 assert.match(yaml,/^ {2}\/v1\/health:/m);
 assert.equal(R006_PUBLIC_ROUTES.length,3);
 const env={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
 assert.equal(handleRequest(new Request('https://starry.invalid/v1/health'),env).status,200);
 for(const r of R006_PUBLIC_ROUTES){
  assert.equal(r.lifecycle,'UNREGISTERED_ERROR_ONLY_PROPOSAL');
  assert.equal(r.public_success_authorized,false);
  assert.equal(r.real_worker_registered,false);
  assert.equal(r.p05_version,R006_CANONICAL_VERSION);
  assert.equal(yaml.includes(r.path),false);
  assert.equal(handleRequest(new Request('https://starry.invalid'+r.path,
   {method:'POST'}),env).status,405);
 }
});
test('SDK error DTO excludes any 2xx, PII, event, MAC and server authority',()=>{
 for(const status of [400,401,403,404,405,409,503]){
  const r=proposeR006PublicError(status);
  assert.equal(r.http_status,status);
  assert.equal(r.origin,'sdk_proposal_not_worker_response');
  assert.equal(r.body.error.message,'Operation unavailable');
  for(const k of ['may_dispatch','may_ack','may_send','may_grant','may_charge'])
   assert.equal(r[k],false);
  assert.ok(Object.isFrozen(r));
 }
 for(const status of [200,201,204,302,0,-1,'200',null,NaN,
  {event_id:'secret-event',mac_hex:'secret-signature',session:'secret-session'}]){
  const r=proposeR006PublicError(status);
  assert.equal(r.http_status,503);
  assert.doesNotMatch(JSON.stringify(r),/secret-event|secret-session|secret-signature/i);
 }
});
test('review code is no P05 HMAC signer, no live SDK, Queue or Cloudflare mutation',()=>{
 const s=readFileSync(new URL('../src/wave1-r006-p05-vnext-error-only.ts',import.meta.url),'utf8');
 assert.doesNotMatch(s,/\bcrypto\.subtle\.(?:sign|verify)\b/);
 assert.doesNotMatch(s,/\bfetch\s*\(/);
 assert.doesNotMatch(s,/from\s+['"]react-native-google-mobile-ads/);
 assert.doesNotMatch(s,/\bwrangler\s+deploy\b/);
});

test('AI-0 #219 signed fields are ordered by canonical tuple, not JSON insertion',()=>{
 const e=canonical();
 const unordered=Object.fromEntries([...Object.entries(e)].reverse());
 assert.notDeepEqual(Object.keys(unordered),[...R006_FIELDS]);
 const preimageA=JSON.stringify([R006_HMAC_DOMAIN,...R006_FIELDS.map(k=>e[k])]);
 const preimageB=JSON.stringify([R006_HMAC_DOMAIN,...R006_FIELDS.map(k=>unordered[k])]);
 assert.equal(preimageA,preimageB);
 denied(reviewR006P05VNextSchema(wrap(unordered),NOW),
  'OWNER_GATE_REQUIRED',true);
});
test('AI-0 #219 permits monotonic session_version zero as a candidate only',()=>{
 denied(reviewR006P05VNextSchema(wrap(canonical({session_version:0})),NOW),
  'OWNER_GATE_REQUIRED',true);
 denied(reviewR006P05VNextSchema(wrap(canonical({session_version:-1})),NOW),
  'INVALID_ENVELOPE');
});
test('AI-0 #219 expiry equals now is already expired, never reviewable',()=>{
 denied(reviewR006P05VNextSchema(wrap(canonical({
  issued_at:NOW-60,expires_at:NOW
 })),NOW),'BAD_TIME_OR_TTL');
});
test('AI-0 #219 identifier length ranges and positive issued_at are mirrored',()=>{
 denied(reviewR006P05VNextSchema(wrap(canonical({
  event_id:'e'.repeat(128),actor_ref:'a'.repeat(128),
  idempotency_key:'i'.repeat(128),app_id:'s'.repeat(100)
 })),NOW),'OWNER_GATE_REQUIRED',true);
 for(const changes of [{event_id:'e'.repeat(129)},
   {actor_ref:'a'.repeat(129)}, {idempotency_key:'i'.repeat(129)},
   {app_id:'s'.repeat(101)}, {issued_at:0,expires_at:120}])
  denied(reviewR006P05VNextSchema(wrap(canonical(changes)),NOW),
   'INVALID_ENVELOPE');
});
