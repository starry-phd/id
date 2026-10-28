import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {AI0_R006_FIELDS,AI0_R006_P05_VERSION,AI0_R006_P05_PURPOSE,AI0_R006_HMAC_DOMAIN,
 AI0_R006_LIVE,r006CanonicalBytes,createOfflineR006P05Verifier}
 from '../src/ai0-r006-p05-canonical-proposal.ts';
import {R006_AI0_P05_VERSION,R006_AI0_P05_PURPOSE,R006_AI0_P05_DOMAIN,R006_P05_FIELDS,
 R006_AUTH_ADAPTER_LIVE,r006VNextSigningBytes,createOfflineR006P05VNextAuthAdapter}
 from '../../../modules/starry-id-v1/src/wave1-round006-p05-vnext-auth-adapter.ts';
import {R006_STORE_LIVE,R006_P05_DEPENDENCY,R006_P05_PURPOSE,R006_P05_SIGNATURE_DOMAIN,
 r006SyntheticFixtureBytes,createOfflineR006SignedStoreBoundary}
 from '../../rebuild-billing/src/wave1-r006-synthetic-store-provenance.ts';
import {R006_CANONICAL_VERSION,R006_CANONICAL_PURPOSE,R006_HMAC_DOMAIN,R006_FIELDS,
 R006_ADS_OFF,R006_PUBLIC_ROUTES,reviewR006P05VNextSchema,proposeR006PublicError}
 from '../../../apps/api/src/wave1-r006-p05-vnext-error-only.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const m=JSON.parse(readFileSync(resolve(root,'docs/operations/ai0-wave1-r006-owner-blobs.v1.json'),'utf8'));
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const now=1793200000;
const event=()=>({
 version:AI0_R006_P05_VERSION,purpose:AI0_R006_P05_PURPOSE,
 ...scope,event_id:'event_123456789',event_type:'notification.delivery.queued',
 actor_ref:'actor_123456789',auth_version:3,session_version:0,
 idempotency_key:'idem_123456789',issuer_kid:'r006-offline-01',issuer_epoch:1,
 issued_at:now,expires_at:now+50,nonce:'nonce_ABCDEFGHIJKLMNOP',
 payload_sha256:'a'.repeat(64)
});
const never=(obj,keys)=>{for(const k of keys)assert.equal(obj[k],false,k);};

test('R006 merged checkout contains precisely 12 original Owner Git Blobs with no rewritten bytes',()=>{
 assert.equal(m.owners.length,4);
 assert.equal(m.integration_parent.head_sha,'64f949e4d40277d964f9d4a8c4d33cc442df2c32');
 const seen=new Set();
 for(const o of m.owners){
  assert.equal(o.files.length,3,o.owner);
  for(const f of o.files){
   assert.equal(seen.has(f.path),false,f.path);seen.add(f.path);
   const bytes=readFileSync(resolve(root,f.path));
   const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
   assert.equal(sha,f.blob_sha,f.path);
  }
 }
 assert.equal(seen.size,12);
});

test('AI0, AI1, AI2 and AI4 pin exactly one R006 vNext P05 contract and HMAC namespace',()=>{
 for(const x of [R006_AI0_P05_VERSION,R006_P05_DEPENDENCY,R006_CANONICAL_VERSION])
  assert.equal(x,AI0_R006_P05_VERSION);
 for(const x of [R006_AI0_P05_PURPOSE,R006_P05_PURPOSE,R006_CANONICAL_PURPOSE])
  assert.equal(x,AI0_R006_P05_PURPOSE);
 for(const x of [R006_AI0_P05_DOMAIN,R006_P05_SIGNATURE_DOMAIN,R006_HMAC_DOMAIN])
  assert.equal(x,AI0_R006_HMAC_DOMAIN);
 for(const a of [R006_P05_FIELDS,R006_FIELDS])assert.deepEqual([...a],[...AI0_R006_FIELDS]);
 assert.equal(AI0_R006_FIELDS.length,17);
 assert.equal(AI0_R006_LIVE,false);assert.equal(R006_AUTH_ADAPTER_LIVE,false);
 assert.equal(R006_STORE_LIVE,false);
});

test('AI0 exact signing bytes equal real AI1 wire adapter on reordered input, not insertion-order gate',()=>{
 const ordered=event();
 const reversed=Object.fromEntries(Object.entries(ordered).reverse());
 const original=Buffer.from(r006CanonicalBytes(ordered));
 const reordered=Buffer.from(r006CanonicalBytes(reversed));
 const auth=Buffer.from(r006VNextSigningBytes(reversed));
 assert.deepEqual(original,reordered);
 assert.deepEqual(original,auth);
 assert.equal(r006CanonicalBytes({...event(),extra:'must-reject'}),null);
 assert.equal(r006VNextSigningBytes({...event(),extra:'must-reject'}),null);
});

test('AI0 true synthetic crypto match still cannot authorize delivery; AI4 structural review never trusts it',async()=>{
 const raw=new Uint8Array(32).fill(13);
 const sign=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const verify=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const e=event();
 const sig=await crypto.subtle.sign('HMAC',sign,r006CanonicalBytes(e));
 const mac_hex=Buffer.from(sig).toString('hex');
 const signed={envelope:e,mac_hex};
 const ai0=createOfflineR006P05Verifier({enabled:true,scope,nowSeconds:()=>now,
  readCurrentVerificationKey:async()=>({kid:e.issuer_kid,epoch:1,key:verify})});
 const r=await ai0.review(signed);
 assert.equal(r.status,'review_only');
 assert.equal(r.cryptographic_candidate_match,true);
 never(r,['verified_live','may_authorize_actor','may_grant','may_read_d1','may_write_d1',
  'may_send','may_enqueue','may_ack_queue','may_publish','may_charge','may_request_ads','live']);
 const a4=reviewR006P05VNextSchema({mac_hex,envelope:Object.fromEntries(Object.entries(e).reverse())},now);
 assert.equal(a4.status,'blocked');assert.equal(a4.reason,'OWNER_GATE_REQUIRED');
 assert.equal(a4.schema_candidate,true);
 never(a4,['may_verify_p05','may_authenticate','may_send','may_ack_queue','may_claim_receipt',
  'may_charge','may_grant','may_initialize_ads','may_request_ad','may_deploy','publishable']);
});

test('old R005 dialects and hostile wrapper fail closed; no accidental Auth, Store or production ports',async()=>{
 const bad=[
  {event:event(),signature_hex:'a'.repeat(64)},
  {envelope:event(),mac:'a'.repeat(64)},
  {envelope:{...event(),verified_live:true},mac_hex:'a'.repeat(64)}
 ];
 let keys=0;
 const a=createOfflineR006P05Verifier({enabled:true,scope,nowSeconds:()=>now,
  readCurrentVerificationKey:async()=>{keys++;return null;}});
 for(const x of bad){
  assert.equal((await a.review(x)).status,'blocked');
  assert.equal(reviewR006P05VNextSchema(x,now).status,'blocked');
 }
 assert.equal(keys,0);
 assert.throws(()=>createOfflineR006P05VNextAuthAdapter({
  enabled:true,serverScope:{...scope,environment:'production'}
 }),/R006_TRUSTED_PORTS_REQUIRED/);
 assert.throws(()=>createOfflineR006SignedStoreBoundary({
  enabled:true,scope:{...scope,environment:'production'}
 }),/R006_SCOPE_OR_AUTH_NOT_TRUSTED/);
 assert.equal(r006SyntheticFixtureBytes({is_paid:true,signature_verified:true}),null);
});

test('AI3 real Python R006 structural parser has matching 17 fields and durable rights all denied',()=>{
 const code=`import importlib.util,json,sys
path="packages/rebuild-ai3/src/wave1_r006_p05_vnext_sqlite_review.py"
spec=importlib.util.spec_from_file_location("ai3_r006_same_checkout",path)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
d=m.Decision(m.CONTRACT,"blocked","OFFLINE_ONLY")
print(json.dumps({"version":m.CANONICAL_VNEXT,"domain":m.DOMAIN,
"fields":list(m.FIELDS),"may_ack":d.may_ack,"may_send":d.may_send,
"may_write_real_d1":d.may_write_real_d1,"external_witness":d.external_witness_verified,
"live":d.live}))`;
 const p=spawnSync('python3',['-c',code],{cwd:root,encoding:'utf8',timeout:15000});
 assert.equal(p.status,0,p.stderr);
 const ai3=JSON.parse(p.stdout);
 assert.equal(ai3.version,AI0_R006_P05_VERSION);
 assert.equal(ai3.domain,AI0_R006_HMAC_DOMAIN);
 assert.deepEqual(ai3.fields,[...AI0_R006_FIELDS]);
 never(ai3,['may_ack','may_send','may_write_real_d1','external_witness','live']);
});

test('Ads SDK, Cloudflare, P05/Store release stay blocked and public SDK emits only redacted errors',()=>{
 for(const key of ['ads_sdk_initialized','ad_requests_enabled','native_app_id_authorized',
 'ad_unit_authorized','cross_app_remove_ads_authorized'])assert.equal(R006_ADS_OFF[key],false);
 for(const r of R006_PUBLIC_ROUTES){
  assert.equal(r.real_worker_registered,false);
  assert.equal(r.public_success_authorized,false);
 }
 const err=proposeR006PublicError(503);
 assert.equal(err.body.error.message,'Operation unavailable');
 assert.equal(err.may_dispatch,false);assert.equal(err.may_ack,false);
 assert.equal(m.gate1.status,'PARTIAL_BLOCKED');
 assert.equal(m.gate3.status,'BLOCKED');
 assert.equal(m.gate3.g00_g10_blocked,11);
 assert.equal(m.gate3.p05_publishable,false);
 assert.equal(m.gate3.release_authorization_granted,false);
 assert.equal(m.restrictions.admob_ads,false);
 assert.equal(m.restrictions.paid_resources,false);
 assert.equal(m.restrictions.main_merge,false);
 assert.equal(m.cloudflare_external.status,'UNRESOLVED_EXTERNAL_FAILURE');
});
