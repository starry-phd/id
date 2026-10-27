import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const directories=Object.freeze({
 auth:'modules/starry-id-v1/schema',
 billing:'packages/rebuild-billing/schema',
 battery_audit:'packages/rebuild-ai3/schema',
 task:'apps/api/contracts'
});
const officialGateIds=['G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1',
 'G04-STORE','G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE','G08-WORKER-SDK',
 'G09-DEVICES','G10-OPS'];
const isSha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
export const readJson=path=>JSON.parse(readFileSync(join(repoRoot,path),'utf8'));

export function inspectSqlDraftInventory(inventory,release,{listPaths}={}){
 const errors=[],reject=m=>errors.push(m);
 if(!inventory||!Array.isArray(inventory.entries))return {ok:false,errors:['inventory missing entries']};
 if(inventory.schema_version!=='0.1-proposed'||
  inventory.repository!=='starry-phd/id'||
  inventory.baseline?.ai0_pr!==106||!isSha(inventory.baseline?.commit_sha)||
  inventory.type!=='immutable_baseline_sql_draft_inventory_not_deployment_permission'||
  inventory.scope!=='starry_only_hglobal_paused')reject('inventory scope, origin or classification invalid');
 for(const k of ['migration_approval','live_execution_authorized','staging_execution_authorized','production_rollback_verified','data_retention_and_legal_approval','cloudflare_d1_compatibility_verified'])
  if(inventory[k]!==false)reject('cannot claim live migration readiness: '+k);
 if(inventory.all_release_gates_blocked!==true)reject('inventory release assertions changed');
 if(!Array.isArray(inventory.known_scope_limits)||inventory.known_scope_limits.length<6)
  reject('snapshot limitations not recorded');
 const actual=listPaths??Object.values(directories).flatMap(dir=>
  readdirSync(join(repoRoot,dir)).filter(n=>n.endsWith('.sql')).map(n=>dir+'/'+n));
 const known=new Set(),actualSet=new Set(actual);
 if(inventory.entries.length!==36)reject('R14 fixed baseline must contain 36 SQL paths');
 for(const e of inventory.entries){
  if(!e||typeof e.path!=='string'||known.has(e.path)){
   reject('repeated/missing draft SQL path');continue;
  }
  known.add(e.path);
  if(typeof e.domain!=='string'||!(e.domain in directories)||!e.path.startsWith(directories[e.domain]+'/')||
    !/^[\w./-]+\.sql$/.test(e.path)||e.path.includes('..')||e.path.startsWith('/'))
    reject('untrusted SQL owner/path: '+e.path);
  if(!actualSet.has(e.path)||!existsSync(join(repoRoot,e.path)))
    reject('phantom SQL evidence: '+e.path);
  else if(!readFileSync(join(repoRoot,e.path),'utf8').trim())
    reject('empty SQL source: '+e.path);
  const isUp=e.path.endsWith('.UP.DRAFT.sql'),isDown=e.path.endsWith('.DOWN.DRAFT.sql');
  const kind=isUp?'versioned_up':isDown?'versioned_down':'standalone_draft';
  const partner=isUp?e.path.replace('.UP.DRAFT.sql','.DOWN.DRAFT.sql'):
    isDown?e.path.replace('.DOWN.DRAFT.sql','.UP.DRAFT.sql'):null;
  if(e.kind!==kind||e.paired_source!==partner)reject('misrepresented UP/DOWN status: '+e.path);
  if(!/\.DRAFT\.sql$|_DRAFT\.sql$/.test(e.path))reject('SQL source not visibly draft-only: '+e.path);
  if(e.execution_authorized!==false||e.production_rollback_verified!==false||
    e.scope!=='draft_sql_offline_only')reject('unapproved execution/rollback: '+e.path);
 }
 // Keep R14's immutable 36 SQL snapshot; R15's 013 pair is reviewed separately.
 // A Git blob hash pins exact owner-source bytes, so a renamed/altered SQL
 // cannot be waved through by simply adding its filename to this addendum.
 const reviewed=readJson('docs/operations/r15-sql-additions.v0.json');
 const ext=reviewed?.entries;
 if(reviewed?.classification!=='R15_AI1_reviewed_addendum_to_immutable_R14_36_sql_source_snapshot_not_approval'||
    reviewed?.original_inventory!=='docs/operations/r15-sql-migration-inventory.v0.json'||
    reviewed?.source_owner!=='AI-1'||reviewed?.source_pr!==110||
    reviewed?.source_sha!=='357948d1fc1e3afc0f6bc515f742aabea971ff09'||
    reviewed?.live_d1_migration_authorized!==false||reviewed?.production_rollback_approved!==false||
    !Array.isArray(ext)||ext.length!==2)
  reject('R15 SQL extension not reviewed or false live permission');
 const expanded=new Set(known);
 const extraPaths=new Set((Array.isArray(ext)?ext:[]).map(e=>e?.path));
 for(const e of Array.isArray(ext)?ext:[]){
  if(!e||typeof e.path!=='string'||!e.path.startsWith('modules/starry-id-v1/schema/013_starry_deletion_source_immutability.')||
     !/\.(UP|DOWN)\.DRAFT\.sql$/.test(e.path)||e.git_blob_sha?.length!==40||
     !/^[0-9a-f]{40}$/.test(e.git_blob_sha)||expanded.has(e.path)||
     !e.peer||!extraPaths.has(e.peer)||!e.peer.startsWith('modules/starry-id-v1/schema/013_starry_deletion_source_immutability.')||
     e.kind!==(e.path.endsWith('.UP.DRAFT.sql')?'versioned_up':'versioned_down'))
   reject('unsafe/unpaired R15 SQL addendum entry: '+e?.path);
  if(!actualSet.has(e.path)||!existsSync(join(repoRoot,e.path)))reject('R15 new source file missing: '+e.path);
  else {
   const bytes=readFileSync(join(repoRoot,e.path));
   const sha=createHash('sha1').update('blob '+bytes.byteLength+'\0').update(bytes).digest('hex');
   if(sha!==e.git_blob_sha)reject('R15 new SQL content differs from original owner Git Blob: '+e.path);
  }
  expanded.add(e.path);
 }
 for(const p of actualSet)if(!expanded.has(p))reject('new SQL path not triaged in manifest: '+p);
 for(const e of inventory.entries)if(e.paired_source&&!known.has(e.paired_source))
  reject('missing UP/DOWN peer: '+e.path);
 if(!release||!Array.isArray(release.gates)||release.gates.length!==11||
    officialGateIds.some(id=>!release.gates.some(g=>g.id===id&&g.status==='blocked'))||
    release.release_authorization?.granted!==false||
    release.deployment_automation?.can_auto_deploy!==false)
  reject('authoritative release Gate unauthorized state');
 const byDomain=Object.fromEntries(Object.keys(directories).map(domain=>
   [domain,inventory.entries.filter(x=>x?.domain===domain).length]));
 return {ok:errors.length===0,errors,count:inventory.entries.length,byDomain,
  verified:'baseline_sql_file_presence_and_up_down_naming_only',
  real_d1_schema_migrated:false,production_rollback_approved:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=inspectSqlDraftInventory(readJson('docs/operations/r15-sql-migration-inventory.v0.json'),
  readJson('docs/release-readiness/release-readiness.v0.json'));
 if(!result.ok){console.error(result.errors.join('\n'));process.exitCode=1;}
 else console.log('AI-0 R15 SQL DRAFT baseline PASS: '+result.count+
  ' files, Auth '+result.byDomain.auth+', Billing '+result.byDomain.billing+
  ', Battery/Audit '+result.byDomain.battery_audit+', Task '+result.byDomain.task+
  '. ALL release Gates still BLOCKED. Zero live migration/rollback approval.');
}
