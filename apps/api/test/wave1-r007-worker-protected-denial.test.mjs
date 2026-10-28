import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {URL} from 'node:url';
import {handleRequest} from '../src/index.ts';
import {
  R006_CANONICAL_VERSION,R006_PUBLIC_ROUTES,
  proposeR006PublicError,reviewR006P05VNextSchema
} from '../src/wave1-r006-p05-vnext-error-only.ts';
import {
  R007_VERSION,R007_PROTECTED_PINS,reviewR007UnregisteredTransport
} from '../src/wave1-r007-worker-protected-denial.ts';

const ORIGIN='https://offline.example.invalid';
const DEVELOPMENT={STARRY_ENVIRONMENT:'development',STARRY_APP_ID:'starry-id'};
const STAGING={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
const PRODUCTION={STARRY_ENVIRONMENT:'production',STARRY_APP_ID:'starry-id'};
const FOREIGN_APP={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'foreign-app'};
const file=(relative)=>readFileSync(new URL(relative,import.meta.url),'utf8');
const ask=(path,method='GET',env=STAGING,body)=>{
  const args={method};
  if(body!==undefined) {
    args.body=JSON.stringify(body);
    args.headers={'content-type':'application/json','authorization':'Bearer synthetic-test-token'};
  }
  return handleRequest(new Request(ORIGIN+path,args),env);
};
async function denied(response,code,status){
  assert.equal(response.status,status);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const body=await response.text();
  assert.deepEqual(JSON.parse(body),{error:{code,message:
    code==='METHOD_NOT_ALLOWED'?'Method not allowed':
    code==='NOT_FOUND'?'Resource not found':
    code==='ENVIRONMENT_DISABLED'?'Not enabled':'Invalid application scope'}});
  assert.doesNotMatch(body,/token|mac_hex|actor_ref|issuer_kid|idempotency_key|receipt|sensitive-secret/i);
}
test('R007 audit is a strict versioned offline refusal, never an authority',()=>{
  const result=reviewR007UnregisteredTransport({});
  assert.equal(result.contract,R007_VERSION);
  assert.equal(result.state,'blocked');
  assert.equal(result.authority,'offline_review_only');
  assert.equal(result.reason,'PROTECTED_ROUTE_NOT_REGISTERED');
  for(const flag of ['may_verify','may_authenticate','may_dispatch','may_send',
    'may_ack_queue','may_grant','may_initialize_ads','may_request_ad',
    'may_deploy','publishable']) assert.equal(result[flag],false,flag);
  assert.ok(Object.isFrozen(result));
});
test('untrusted getters/proxies are never read or serialized by offline refusal',()=>{
  let reads=0;
  const hostile=Object.defineProperty({},'mac_hex',{
    enumerable:true,get(){reads++;throw Error('should never read');}
  });
  assert.equal(reviewR007UnregisteredTransport(hostile),
    reviewR007UnregisteredTransport(null));
  assert.equal(reads,0);
  assert.equal(reviewR007UnregisteredTransport(new Proxy({},{
    get(){throw Error('proxy access');},
    ownKeys(){throw Error('proxy keys');}
  })).state,'blocked');
});
test('R007 future route pins match R006 canonical version without registration',()=>{
  assert.equal(R007_PROTECTED_PINS.length,R006_PUBLIC_ROUTES.length);
  assert.equal(R007_PROTECTED_PINS.length,3);
  for(let i=0;i<R007_PROTECTED_PINS.length;i++){
    const pin=R007_PROTECTED_PINS[i];
    assert.equal(pin.path,R006_PUBLIC_ROUTES[i].path);
    assert.equal(pin.method,'POST');
    assert.equal(pin.canonical_p05,R006_CANONICAL_VERSION);
    assert.equal(pin.actual_worker_registered,false);
    assert.equal(pin.public_success_authorized,false);
    assert.ok(Object.isFrozen(pin));
  }
});
test('actual OpenAPI paths remain GET /v1/health ONLY, no protected POST',()=>{
  const yaml=file('../openapi.yaml');
  const paths=yaml.split(/^paths:\s*$/m)[1]?.split(/^components:\s*$/m)[0];
  assert.ok(paths,'OpenAPI paths section missing');
  assert.deepEqual([...paths.matchAll(/^ {2}(\/[^:]+):/gm)].map(x=>x[1]),['/v1/health']);
  assert.match(paths,/^ {4}get:/m);
  assert.doesNotMatch(paths,/^ {4}(?:post|patch|put|delete):/m);
  for(const p of R007_PROTECTED_PINS)assert.equal(yaml.includes(p.path),false,p.path);
});
test('actual Worker exposes only Starry development/staging liveness',async()=>{
  for(const env of [DEVELOPMENT,STAGING]){
    const response=ask('/v1/health','GET',env);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.deepEqual(body,{
      status:'ok',brand_id:'starry',app_id:'starry-id',
      environment:env.STARRY_ENVIRONMENT,service:'id-api',kind:'liveness-only'
    });
  }
});
test('future protected POSTs are 405 in BOTH permitted environments',async()=>{
  for(const env of [DEVELOPMENT,STAGING])
    for(const pin of R007_PROTECTED_PINS)
      await denied(ask(pin.path,'POST',env,{
        version:R006_CANONICAL_VERSION,mac_hex:'sensitive-secret',
        signature_verified:true,may_ack_queue:true
      }),'METHOD_NOT_ALLOWED',405);
});
test('future protected GETs are 404, never hidden successful APIs',async()=>{
  for(const pin of R007_PROTECTED_PINS)
    await denied(ask(pin.path,'GET',STAGING),'NOT_FOUND',404);
});
test('POST, PATCH, PUT, DELETE, OPTIONS and HEAD cannot mutate even health',async()=>{
  for(const method of ['POST','PATCH','PUT','DELETE','OPTIONS','HEAD'])
    await denied(ask('/v1/health',method,STAGING),'METHOD_NOT_ALLOWED',405);
});
test('production forbids health and protected POST regardless of request body',async()=>{
  await denied(ask('/v1/health','GET',PRODUCTION),'ENVIRONMENT_DISABLED',503);
  for(const pin of R007_PROTECTED_PINS)
    await denied(ask(pin.path,'POST',PRODUCTION,{verified:true}),
      'ENVIRONMENT_DISABLED',503);
});
test('wrong app scope and unknown environment are denied before all routes',async()=>{
  await denied(ask('/v1/health','GET',FOREIGN_APP),'APP_SCOPE_DENIED',403);
  for(const pin of R007_PROTECTED_PINS)
    await denied(ask(pin.path,'POST',FOREIGN_APP,{verified:true}),
      'APP_SCOPE_DENIED',403);
  await denied(ask('/v1/health','GET',{
    STARRY_ENVIRONMENT:'preview',STARRY_APP_ID:'starry-id'
  }),'ENVIRONMENT_DISABLED',503);
});
test('foreign/unknown path and encoded-path variants are not alternate APIs',async()=>{
  for(const path of ['/v1/anything','/v1/%68ealth','/v1/health/','/admin',
    '/v1/health?event_id=sensitive-secret'])
    if(path.includes('?')){
      const ok=ask(path,'GET',STAGING);
      assert.equal(ok.status,200);
      assert.doesNotMatch(await ok.text(),/sensitive-secret/);
    }else if(path!=='/v1/%68ealth'){
      await denied(ask(path,'GET',STAGING),'NOT_FOUND',404);
    }else{
      const response=ask(path,'GET',STAGING);
      assert.notEqual(response.status,201);
    }
});
test('synthetic MAC and success-looking DTO cannot turn owner review into release',()=>{
  assert.equal(reviewR006P05VNextSchema({
    envelope:{},mac_hex:'a'.repeat(64)
  },1793200000).may_ack_queue,false);
  for(const status of [200,201,204,302,'200',null]){
    const dto=proposeR006PublicError(status);
    assert.equal(dto.http_status,503);
    for(const f of ['may_dispatch','may_ack','may_send','may_grant','may_charge'])
      assert.equal(dto[f],false);
    assert.doesNotMatch(JSON.stringify(dto),/mac_hex|actor_ref|idempotency_key/i);
  }
});
test('actual Worker source remains no body parsing, dispatch, Queue ACK or signer',()=>{
  const s=file('../src/index.ts');
  assert.doesNotMatch(s,/\.json\s*\(|\.text\s*\(|\.formData\s*\(/);
  assert.doesNotMatch(s,/\bfetch\s*\(/);
  assert.doesNotMatch(s,/crypto\.subtle|\.send\s*\(|\.ack\s*\(/);
  assert.match(s,/url\.pathname === '\/v1\/health'/);
});
test('Wrangler remains isolated staging-only with no accidental Preview or bindings',()=>{
  const cfg=file('../wrangler.toml');
  const rootConfig=new URL('../../../wrangler.toml',import.meta.url);
  assert.equal(existsSync(rootConfig),false,'Root Wrangler config requires owner review');
  assert.match(cfg,/\[env\.staging\]/);
  assert.match(cfg,/STARRY_ENVIRONMENT = "staging"/);
  assert.match(cfg,/workers_dev = false/);
  assert.doesNotMatch(cfg,/\[env\.production\]|\[previews(?:\.|\])|\[\[d1_databases\]\]|\[\[queues\./);
});
test('new tests are executed by existing CI, without triggering deploy in workflow',()=>{
  const wf=file('../../../.github/workflows/ai0-current-offline-gate.yml');
  assert.match(wf,/npm test/);
  assert.match(wf,/npm run api:check/);
  assert.match(wf,/node --experimental-strip-types --test packages\/integration\/test\/\*\.test\.mjs/);
  assert.doesNotMatch(wf,/^\s*run:\s*(?:wrangler deploy|npx wrangler preview)/m);
});
