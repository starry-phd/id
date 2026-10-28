/** AI-3 R23 G07: repository-only readiness evidence. NO network, Wrangler invocation,
 * secrets, DB writes, deployments or implied external attestation. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const ID=/^[A-Za-z0-9_-]{1,96}$/;
export function scanWranglerDeclarations(toml,env='staging'){
 if(typeof toml!=='string'||!['development','staging'].includes(env))
  throw Error('AI3_R23_INVALID_WRANGLER_INPUT');
 const tables={d1:[],producers:[],consumers:[]};
 let active=null;
 for(const raw of toml.split(/\r?\n/)){
  const line=raw.trim();
  if(!line||line.startsWith('#'))continue;
  const a=/^\[\[([a-zA-Z0-9_.-]+)\]\]$/.exec(line);
  if(a){
   const table=a[1],type=table===`env.${env}.d1_databases`?'d1':
    table===`env.${env}.queues.producers`?'producers':
    table===`env.${env}.queues.consumers`?'consumers':null;
   active=type?{}:null;
   if(type)tables[type].push(active);
   continue;
  }
  if(/^\[[^\]]+\]$/.test(line)||/^\[\[/.test(line)){active=null;continue;}
  if(!active)continue;
  const kv=/^([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*"([^"\r\n]*)"\s*(?:#.*)?$/.exec(line);
  if(kv&&['binding','database_name','database_id','queue','dead_letter_queue'].includes(kv[1]))
   active[kv[1]]=kv[2];
 }
 const d1=tables.d1.filter(x=>ID.test(x.binding??'')&&ID.test(x.database_name??'')&&
  /^[0-9a-fA-F-]{36}$/.test(x.database_id??''));
 const producer=tables.producers.filter(x=>ID.test(x.binding??'')&&ID.test(x.queue??''));
 const consumer=tables.consumers.filter(x=>ID.test(x.queue??'')&&ID.test(x.dead_letter_queue??''));
 return Object.freeze({d1_binding_declared:d1.length>0,d1_count:d1.length,
  queue_producer_declared:producer.length>0,
  queue_consumer_with_dlq_declared:consumer.length>0});
}
export function assessR23G07({wranglerToml,releaseJson,environment='staging'}){
 const topology=scanWranglerDeclarations(wranglerToml,environment);
 if(!releaseJson||typeof releaseJson!=='object'||Array.isArray(releaseJson)||
  !Array.isArray(releaseJson.gates)||!releaseJson.release_authorization||
  !releaseJson.deployment_automation)throw Error('AI3_R23_INVALID_RELEASE_MANIFEST');
 const gates=releaseJson.gates.filter(x=>x?.id==='G07-AUDIT-QUEUE');
 if(gates.length!==1)throw Error('AI3_R23_G07_MANIFEST_MISSING');
 const missing=[];
 if(!topology.d1_binding_declared)missing.push('STAGING_D1_BINDING_NOT_DECLARED');
 if(!topology.queue_producer_declared)missing.push('STAGING_QUEUE_PRODUCER_NOT_DECLARED');
 if(!topology.queue_consumer_with_dlq_declared)
  missing.push('STAGING_QUEUE_CONSUMER_DLQ_NOT_DECLARED');
 if(gates[0].status!=='passed')missing.push('OFFICIAL_G07_NOT_PASSED');
 if(releaseJson.release_authorization.granted!==true||
  releaseJson.deployment_automation.can_auto_deploy!==true)
  missing.push('OWNER_RELEASE_NOT_AUTHORIZED');
 // Static declarations can NEVER attest actual provider authority.
 missing.push('PHYSICAL_D1_QUEUE_AND_ACK_NOT_LIVE_VERIFIED',
  'CROSS_D1_ADR_87_AB_NOT_APPROVED',
  'SIGNED_P05_AND_LAWFUL_RETENTION_NOT_ATTESTED',
  'INDEPENDENT_NONROLLBACK_PITR_WITNESS_NOT_ATTESTED');
 return Object.freeze({schema_version:'starry.ai3.r23.g07-physical-preflight.v1',
  brand_id:'starry',environment,gate_id:'G07-AUDIT-QUEUE',status:'blocked',
  evidence_level:'repository_configuration_only',topology,missing,
  may_write_battery:false,may_ack_queue:false,may_restore:false,may_deploy:false,
  may_grant_or_sell_battery:false,verified_live:false});
}
export function inspectCheckout(root=ROOT){
 const wranglerToml=readFileSync(resolve(root,'apps/api/wrangler.toml'),'utf8');
 const releaseJson=JSON.parse(readFileSync(resolve(root,'docs/release-readiness/release-readiness.v0.json'),'utf8'));
 return assessR23G07({wranglerToml,releaseJson});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2);
 if(a.length!==1||!['--json','--assert-blocked','--assert-ready'].includes(a[0])){
  process.stderr.write('usage: node r23-g07-readiness-preflight.mjs --json|--assert-blocked|--assert-ready\n');
  process.exitCode=2;
 }else try{
  const report=inspectCheckout();
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(a[0]==='--assert-ready')process.exitCode=1;
  if(a[0]==='--assert-blocked'&&report.status!=='blocked')process.exitCode=2;
 }catch(e){process.stderr.write('AI3_R23_PREFLIGHT_FAILED: '+String(e?.message??'unknown')+'\n');process.exitCode=2;}
}
