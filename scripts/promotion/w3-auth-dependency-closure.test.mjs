import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative,isAbsolute,sep} from 'node:path';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const rootFile=p=>resolve(ROOT,p);
const manifest=JSON.parse(readFileSync(rootFile('docs/operations/AI4-W3-AUTH-SOURCE-CLOSURE.v1.json'),'utf8'));
const allSelected=new Set(manifest.source_files.map(x=>x.path));
const preservedBaseline=[
'apps/api/src/index.ts',
'apps/api/wrangler.toml',
'packages/sdk/src/index.ts',
'docs/release-readiness/check-release-readiness.mjs'
];
test('W3 exactly 20 source-pinned original #255 blobs and strict server-only scope',()=>{
 assert.equal(manifest.schema,'starry.ai4.w3.auth-source-promotion-closure.v1');
 assert.equal(manifest.source_sha,'6ae5c2bc5cbf71db715e7e70b18833c4cd6f8a79');
 assert.equal(manifest.selected_count,20);
 assert.equal(allSelected.size,20);
 for(const entry of manifest.source_files){
  assert.equal(entry.mode,'100644');
  assert.match(entry.sha,/^[a-f0-9]{40}$/);
  assert.equal(execFileSync('git',['hash-object',entry.path],{cwd:ROOT,encoding:'utf8'}).trim(),entry.sha,entry.path);
 }
});
test('W3 relative runtime/test imports and local schema references resolve inside the curated tree',()=>{
 const tracked=new Set([...allSelected,...preservedBaseline]);
 const missing=[];
 for(const entry of manifest.source_files.filter(x=>/\.(ts|mjs)$/.test(x.path))){
  const code=readFileSync(rootFile(entry.path),'utf8');
  const pattern=/\bfrom\s*['"]([.]{1,2}\/[^'"]+)['"]|\bnew URL\(\s*['"]([.]{1,2}\/[^'"]+)['"]/g;
  for(const match of code.matchAll(pattern)){
   const spec=match[1]??match[2];
   const candidate=resolve(dirname(rootFile(entry.path)),spec);
   const result=relative(ROOT,candidate).replaceAll(sep,'/');
   if(result.startsWith('../')||isAbsolute(result)||!tracked.has(result)||!existsSync(candidate))
    missing.push(entry.path+' -> '+spec+' = '+result);
  }
 }
 assert.deepEqual(missing,[],'Missing imported originals, schema or detached client dependencies');
});
test('W3 original local test-only composition is NOT registered by public Worker/SDK/OpenAPI',()=>{
 const worker=readFileSync(rootFile('apps/api/src/index.ts'),'utf8');
 const sdk=readFileSync(rootFile('packages/sdk/src/index.ts'),'utf8');
 const openapi=readFileSync(rootFile('apps/api/openapi.yaml'),'utf8');
 const wrangler=readFileSync(rootFile('apps/api/wrangler.toml'),'utf8');
 assert.doesNotMatch(worker,/ai4-w2-local-worker-composition|ai0-w1-isolated-self-profile|w2-r23-auth-outcome|starry-id-v1/);
 assert.doesNotMatch(sdk,/ai0-w1-isolated-self-profile|w2-r23-auth-outcome/);
 assert.doesNotMatch(openapi,/\/v1\/starry-id\/members\/me|\/v1\/member\/self/);
 assert.match(wrangler,/main = "src\/index.ts"/);
 assert.doesNotMatch(wrangler,/\[env\.production\]|\[\[d1_databases\]\]/);
});
