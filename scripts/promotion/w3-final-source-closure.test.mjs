import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(ROOT,p),'utf8');
const source=JSON.parse(read('docs/operations/AI4-W3-FINAL-PROMOTION-CLOSURE.v1.json'));
const baseline=JSON.parse(read('docs/operations/AI4-W3-AUTH-SOURCE-CLOSURE.v1.json'));
const paths=source.source_files.map(f=>f.path);
test('Final W3 exactly six owner blobs plus four AI3 originals; W2 original twenty unchanged',()=>{
 assert.equal(source.schema,'starry.ai4.w3.final-promotion-source-closure.v1');
 assert.equal(source.selected_count,10);assert.equal(source.new_owner_blobs,6);
 assert.equal(source.ai3_original_dependencies,4);assert.equal(new Set(paths).size,10);
 assert.equal(baseline.selected_count,20);
 for(const f of [...baseline.source_files,...source.source_files]){
  assert.equal(f.mode,'100644');
  assert.equal(execFileSync('git',['hash-object',f.path],{cwd:ROOT,encoding:'utf8'}).trim(),f.sha,f.path);
 }
 assert.equal(source.source_files.filter(f=>f.owner==='AI-1').length,2);
 assert.equal(source.source_files.filter(f=>f.owner==='AI-2').length,2);
 assert.equal(source.source_files.filter(f=>f.owner==='AI-3').length,6);
 assert.ok(source.source_files.filter(f=>f.owner==='AI-2').every(f=>f.source_commit.startsWith('dd1f1ccb')));
});
test('Final W3 import closure contains no missing or out-of-repo runtime/test imports',()=>{
 const included=new Set([...baseline.source_files.map(f=>f.path),...paths,
  'apps/api/src/index.ts','apps/api/wrangler.toml','packages/sdk/src/index.ts']);
 const missing=[];
 for(const item of source.source_files.filter(f=>/\.(ts|mjs)$/.test(f.path))){
  const contents=read(item.path);
  const rx=/\bfrom\s*['"]([.]{1,2}\/[^'"]+)['"]|\bnew URL\(\s*['"]([.]{1,2}\/[^'"]+)['"]/g;
  for(const match of contents.matchAll(rx)){
   const spec=match[1]??match[2];
   const abs=resolve(dirname(resolve(ROOT,item.path)),spec);
   const rel=relative(ROOT,abs).replaceAll(sep,'/');
   if(rel.startsWith('../')||isAbsolute(rel)||!included.has(rel)||!existsSync(abs))
    missing.push(item.path+' -> '+spec+' = '+rel);
  }
 }
 assert.deepEqual(missing,[]);
});
test('Final W3 tests truly wired; public Worker SDK OpenAPI Wrangler production workflow remain health-only',()=>{
 const pkg=JSON.parse(read('package.json'));const ci=read('.github/workflows/starry-ci.yml');
 for(const name of ['w3-local-vnext-typed-self-profile.test.mjs','trusted-store-namespace.test.mjs','w3-offline-only-factory.test.mjs'])
  assert.ok(pkg.scripts.test.includes(name),name);
 assert.ok(pkg.scripts['auth:test'].includes('w3-local-vnext-typed-self-profile.test.mjs'));
 assert.ok(ci.includes('npm run w3:typecheck'));
 const boundaries={
  'apps/api/src/index.ts':'a9addff8a16c351ee8cbf3900c8aee52e7fb012b',
  'packages/sdk/src/index.ts':'b73c40bb72c7c2605e9caf77df4ffe6f0d71eee9',
  'apps/api/openapi.yaml':'2d7d42d8ed9529db5b4e92f895bd83a71702da77',
  'apps/api/wrangler.toml':'55f53e1e63349b2ab275d92479d10258af47b6b4',
  '.github/workflows/starry-production.yml':'900f49b561a4fc2a89ed054d3e37e2b2c20e549b',
  'apps/mobile/app/index.tsx':'7927350de91ac90f3c42a2d5a9ad725cd574d244',
 };
 for(const [file,sha] of Object.entries(boundaries))
  assert.equal(execFileSync('git',['hash-object',file],{cwd:ROOT,encoding:'utf8'}).trim(),sha,file);
 assert.equal(source.registered_public_worker,false);
 assert.equal(source.added_bindings,false);
 assert.equal(source.live_queue_or_audit,false);
 assert.equal(source.live_auth_or_iap,false);
});
