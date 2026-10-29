import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {inspectM0,flattenM0} from './m0-guard-policy.mjs';
import {dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(ROOT,p),'utf8');
const source=JSON.parse(read('docs/operations/AI4-W3-FINAL-PROMOTION-CLOSURE.v1.json'));
const baseline=JSON.parse(read('docs/operations/AI4-W3-AUTH-SOURCE-CLOSURE.v1.json'));
const paths=source.source_files.map(f=>f.path);
test('Final W3 historic six owner blobs plus four AI3 originals remain traceable',()=>{
 assert.equal(source.schema,'starry.ai4.w3.final-promotion-source-closure.v1');
 assert.equal(source.selected_count,10);assert.equal(source.new_owner_blobs,6);
 assert.equal(source.ai3_original_dependencies,4);assert.equal(new Set(paths).size,10);
 assert.equal(baseline.selected_count,20);
 for(const f of [...baseline.source_files,...source.source_files]){
  assert.equal(f.mode,'100644');
  // Preserve original promoted SHA as provenance, but do not freeze repairable src.
  assert.ok(existsSync(resolve(ROOT,f.path)),f.path);
 }
 assert.equal(source.source_files.filter(f=>f.owner==='AI-1').length,2);
 assert.equal(source.source_files.filter(f=>f.owner==='AI-2').length,2);
 assert.equal(source.source_files.filter(f=>f.owner==='AI-3').length,6);
 assert.ok(source.source_files.filter(f=>f.owner==='AI-2').every(f=>f.source_commit.startsWith('dd1f1ccb')));
});
test('Final W3 import closure contains no missing or out-of-repo runtime/test imports',()=>{
 const included=new Set(execFileSync('git',['ls-files','-z'],{cwd:ROOT,encoding:'utf8'}).split('\0').filter(Boolean));
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
test('Final W3 tests remain wired; active platform follows reviewed M0 guard instead of ancient SHA',()=>{
 const pkg=JSON.parse(read('package.json'));const ci=read('.github/workflows/starry-ci.yml');
 for(const name of ['w3-local-vnext-typed-self-profile.test.mjs','trusted-store-namespace.test.mjs','w3-offline-only-factory.test.mjs'])
  assert.ok(pkg.scripts.test.includes(name),name);
 assert.ok(pkg.scripts['auth:test'].includes('w3-local-vnext-typed-self-profile.test.mjs'));
 assert.ok(ci.includes('npm run w3:typecheck'));
 const tracked=execFileSync('git',['ls-files','-z'],{cwd:ROOT,encoding:'utf8'}).split('\0').filter(Boolean);
 const result=inspectM0({
   read:p=>read(p),
   trackedPaths:tracked,
   hashOf:p=>execFileSync('git',['hash-object',p],{cwd:ROOT,encoding:'utf8'}).trim(),
 });
 assert.deepEqual(flattenM0(result),[], 'Release/capability/provenance/workflow independent review gates');
 assert.equal(source.registered_public_worker,false);
 assert.equal(source.added_bindings,false);
 assert.equal(source.live_queue_or_audit,false);
 assert.equal(source.live_auth_or_iap,false);
});
