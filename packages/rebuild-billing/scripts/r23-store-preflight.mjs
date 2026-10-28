#!/usr/bin/env node
/** R23 read-only local Store preflight. Never contacts Apple/Google/Cloudflare. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {inspectR23StoreReadiness} from '../src/r23-store-release-preflight.ts';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const read=path=>readFileSync(resolve(root,path),'utf8');
const mode=process.argv[2]??'--assert-blocked';
if(!['--assert-blocked','--require-live'].includes(mode)){
 console.error('Usage: r23-store-preflight.mjs --assert-blocked|--require-live');
 process.exitCode=2;
}else{
 try{
  const result=inspectR23StoreReadiness({
   releaseReadiness:JSON.parse(read('docs/release-readiness/release-readiness.v0.json')),
   workerToml:read('apps/api/wrangler.toml'),
   billingSource:read('packages/rebuild-billing/src/sbase-billing-client-candidate.ts')
  });
  console.log(JSON.stringify(result,null,2));
  if(mode==='--require-live')process.exitCode=3;
  else process.exitCode=result.blockers.some(
   x=>x.id==='GATE_MANIFEST_INVALID_OR_UNSAFE')?2:0;
 }catch{
  console.error('R23_STORE_PREFLIGHT_LOCAL_FILES_INVALID_OR_MISSING');
  process.exitCode=2;
 }
}
