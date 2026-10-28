#!/usr/bin/env node
/** Repo-local Auth G02/G03 preflight. No network, token, env secret or D1. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectR23AuthLiveReadiness} from '../src/r23-auth-g02-g03-live-preflight.ts';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const mode=process.argv[2]??'--assert-blocked';
if(!['--assert-blocked','--require-live'].includes(mode)){
 console.error('Usage: r23-auth-preflight.mjs --assert-blocked|--require-live');
 process.exitCode=2;
}else{
 try{
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const scan=inspectR23AuthLiveReadiness({
   releaseReadiness:JSON.parse(read('docs/release-readiness/release-readiness.v0.json')),
   workerToml:read('apps/api/wrangler.toml'),
   apiSource:read('apps/api/src/index.ts'),
   oidcSource:read('modules/starry-id-v1/src/oidc-crypto.ts'),
   signedRequestBoundarySource:read('modules/starry-id-v1/src/r23-signed-session-d1-request-boundary.ts'),
   sessionPersistenceSource:read('modules/starry-id-v1/src/session-persistence.ts')
  });
  console.log(JSON.stringify(scan,null,2));
  process.exitCode=mode==='--require-live'?3:
   scan.manifest_safe_to_assert_blocked?0:2;
 }catch{
  console.error('R23_AUTH_G02_G03_LOCAL_SOURCE_INVALID_OR_MISSING');
  process.exitCode=2;
 }
}
