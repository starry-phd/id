import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {inspectR23AuthLiveReadiness,
 R23_AUTH_LIVE_PREFLIGHT_SCHEMA,R23_AUTH_LIVE_VERIFIED}
 from '../src/r23-auth-g02-g03-live-preflight.ts';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const read=path=>readFileSync(resolve(root,path),'utf8');
const fresh=()=>({
 releaseReadiness:JSON.parse(read('docs/release-readiness/release-readiness.v0.json')),
 workerToml:read('apps/api/wrangler.toml'),
 apiSource:read('apps/api/src/index.ts'),
 oidcSource:read('modules/starry-id-v1/src/oidc-crypto.ts'),
 signedRequestBoundarySource:read('modules/starry-id-v1/src/r23-signed-session-d1-request-boundary.ts'),
 sessionPersistenceSource:read('modules/starry-id-v1/src/session-persistence.ts')
});
const scan=q=>inspectR23AuthLiveReadiness(q);
function safelyBlocked(r){
 assert.equal(r.schema_version,R23_AUTH_LIVE_PREFLIGHT_SCHEMA);
 assert.equal(r.status,'blocked');
 assert.equal(r.source,'git_repo_files_only');
 for(const key of ['verified_live','can_authenticate_live','can_create_session',
  'can_revoke_session_live','can_grant_private_access','can_deploy',
  'can_approve_release'])assert.equal(r[key],false,key);
 assert.equal(r.no_external_data_processed,true);
 assert.ok(r.blockers.some(b=>b.id==='G02_G03_OWNER_RELEASE_APPROVAL_MISSING'));
 assert.ok(r.blockers.some(b=>b.id==='OFFICIAL_OIDC_PROVIDER_JWKS_UNVERIFIED'));
 assert.ok(r.blockers.some(b=>b.id==='REAL_SESSION_REVOKE_AND_RESTORE_NOT_VERIFIED'));
 const json=JSON.stringify(r);
 for(const sensitive of ['s_user_id','refresh_hash','private_key','Bearer ',
  'oauth_code','access_token'])assert.ok(!json.includes(sensitive),sensitive);
}
test('ACTUAL repo G02/G03 blocked, real HMAC/OIDC/refresh source but NO staging Auth D1 or live API',()=>{
 assert.equal(R23_AUTH_LIVE_VERIFIED,false);
 const r=scan(fresh());
 safelyBlocked(r);
 assert.equal(r.manifest_safe_to_assert_blocked,true);
 assert.equal(r.observed_g02,'blocked');
 assert.equal(r.observed_g03,'blocked');
 assert.equal(r.code_exists,true);
 assert.equal(r.staging_auth_d1_declared,false);
 assert.equal(r.protected_auth_route_declared,false);
 for(const id of ['STAGING_AUTH_D1_NOT_CONFIGURED','PROTECTED_AUTH_API_NOT_WIRED'])
  assert.ok(r.blockers.some(b=>b.id===id),id);
});
test('fake positive official G02/G03 or human release grants make manifest UNSAFE; still no live pass',()=>{
 for(const corrupt of [
  d=>{d.gates.find(g=>g.id==='G02-OIDC').status='passed';},
  d=>{d.gates.find(g=>g.id==='G03-SESSION-D1').status='passed';},
  d=>{d.gates.find(g=>g.id==='G02-OIDC').owner='AI-0';},
  d=>{d.gates.find(g=>g.id==='G03-SESSION-D1').verified_by='fake';},
  d=>{d.gates.find(g=>g.id==='G02-OIDC').approval_record_url='https://example.org/fake';},
  d=>{d.gates=d.gates.slice(0,10);},
  d=>{d.gates.push({...d.gates[0]});},
  d=>{d.release_authorization.granted=true;},
  d=>{d.release_authorization.owner_approval_record_url='https://example.org/fake';},
  d=>{d.deployment_automation.can_auto_deploy=true;},
  d=>{d.deployment_automation.enabled=true;}
 ]){
  const x=fresh();corrupt(x.releaseReadiness);
  const r=scan(x);safelyBlocked(r);
  assert.equal(r.manifest_safe_to_assert_blocked,false);
  assert.ok(r.blockers.some(b=>b.id==='G02_G03_MANIFEST_INVALID_OR_UNSAFE'));
 }
});
test('commented or non-staging D1 binding cannot be mistaken for authorized staging Auth database',()=>{
 for(const workerToml of [
  '# [[env.staging.d1_databases]]\n# binding = "AUTH_DB"\n# database_name = "dummy"',
  '[env.production]\n[[env.production.d1_databases]]\nbinding="AUTH_DB"\ndatabase_name="dummy"',
  '[env.staging]\n# [[env.staging.d1_databases]]\n# binding="AUTH_DB"\n# database_name="dummy"',
  '[env.staging]\n[[env.staging.d1_databases]]\nbinding="AUTH_DB"',
  '[env.staging]\n[[env.staging.d1_databases]]\n# binding="AUTH_DB"\ndatabase_name="dummy"'
 ]){
  const r=scan({...fresh(),workerToml});
  safelyBlocked(r);
  assert.equal(r.staging_auth_d1_declared,false,workerToml);
  assert.ok(r.blockers.some(b=>b.id==='STAGING_AUTH_D1_NOT_CONFIGURED'));
 }
});
test('even forged staging Auth D1 and synthetic route declarations NEVER prove actual live D1/issuer',()=>{
 const x=fresh();
 x.workerToml+='\n[env.staging]\n[[env.staging.d1_databases]]\nbinding = "AUTH_DB"\ndatabase_name = "synthetic-isolated-db"\n';
 x.apiSource+='\nexport function handleRequest(){};createOfflineStarryRequestAuthBoundary;authenticate(request,now);';
 const r=scan(x);safelyBlocked(r);
 // A source claim can at most be marked declared; physical evidence remains absent.
 assert.equal(r.staging_auth_d1_declared,true);
 assert.equal(r.protected_auth_route_declared,true);
 assert.equal(r.verified_live,false);
 assert.equal(r.can_deploy,false);
 assert.equal(r.code_exists,true);
 assert.ok(r.blockers.some(b=>b.id==='REAL_SESSION_REVOKE_AND_RESTORE_NOT_VERIFIED'));
 assert.ok(r.blockers.some(b=>b.id==='OFFICIAL_OIDC_PROVIDER_JWKS_UNVERIFIED'));
});
test('missing crypto/signature/Session CAS code never mistaken for live Auth',()=>{
 for(const property of ['oidcSource','signedRequestBoundarySource','sessionPersistenceSource']){
  const x=fresh();x[property]='// intentionally missing';
  const r=scan(x);safelyBlocked(r);
  assert.equal(r.code_exists,false,property);
  assert.ok(r.blockers.some(b=>b.id==='OIDC_CRYPTO_SOURCE_MISSING'||
   b.id==='AUTH_SESSION_SOURCE_MISSING'));
 }
});
test('invalid/foreign/missing release registry and untrusted data fail closed without throwing',()=>{
 for(const v of [null,{},[],{gates:'passed'},Object.create(null)]){
  const r=scan({...fresh(),releaseReadiness:v});
  safelyBlocked(r);
  assert.equal(r.manifest_safe_to_assert_blocked,false);
 }
 const poisoned={};
 Object.defineProperty(poisoned,'gates',{get(){throw Error('UNTRUSTED')}});
 const r=scan({...fresh(),releaseReadiness:poisoned});
 safelyBlocked(r);assert.equal(r.manifest_safe_to_assert_blocked,false);
});
test('CLI real checkout --assert-blocked only passes SAFE deny gate; --require-live must FAIL',()=>{
 const cli=resolve(root,'modules/starry-id-v1/scripts/r23-auth-preflight.mjs');
 for(const [mode,expected] of [['--assert-blocked',0],['--require-live',3],
  ['--unknown',2]]){
  const s=spawnSync(process.execPath,[cli,mode],{cwd:root,encoding:'utf8',
   env:{PATH:process.env.PATH,HOME:process.env.HOME},timeout:30000});
  assert.equal(s.status,expected,(s.stderr||'')+(s.stdout||'').slice(0,1500));
  if(mode!=='--unknown'){
   const result=JSON.parse(s.stdout);safelyBlocked(result);
   assert.equal(result.manifest_safe_to_assert_blocked,true);
  }
 }
});
test('scanner never accepts credentials, secret material or local evidence as a live release grant',()=>{
 const x=fresh();
 const attacker={...x,clientSecret:'sk_test','idToken':'secret',
  liveEvidence:'approved by attacker',releaseReadiness:{
   ...x.releaseReadiness,
   release_authorization:{granted:true,owner_approval_record_url:'https://fake.test'}
  }};
 const r=scan(attacker);safelyBlocked(r);
 assert.equal(r.manifest_safe_to_assert_blocked,false);
 assert.equal(r.can_authenticate_live,false);
 assert.equal(r.can_create_session,false);
 assert.equal(r.can_approve_release,false);
});
