// AI-4 M0 UP-07/08: evolving source review != historic SHA audit != release authority.
// Reviewed routing is inert: this policy cannot authorize a deploy or real binding.
import {parseDocument} from 'yaml';

const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (o, expected) => isRecord(o) &&
  Object.keys(o).sort().join('|') === [...expected].sort().join('|');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const GATES = ['G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1','G04-STORE',
  'G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE','G08-WORKER-SDK','G09-DEVICES','G10-OPS'];

// Only the currently checked-in *local or inert staging* Wrangler scope is accepted.
// Both TOML and the documented Wrangler JSON/JSONC-compatible JSON subset are parsed
// structurally. Unsupported JSONC extensions and TOML syntax fail closed.
function stripTomlComment(raw) {
  let quoted=false, esc=false;
  for(let i=0;i<raw.length;i++){
    const c=raw[i];
    if(esc){esc=false;continue;}
    if(c==='\\'&&quoted){esc=true;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(c==='#'&&!quoted)return raw.slice(0,i).trim();
  }
  if(quoted)throw Error('unterminated TOML string');
  return raw.trim();
}
function parseToml(source){
  const obj=Object.create(null);
  let section='';
  obj['']=Object.create(null);
  for(const [i,line] of source.split(/\r?\n/).entries()){
    const s=stripTomlComment(line);
    if(!s)continue;
    const table=/^\[([a-zA-Z][a-zA-Z0-9_.-]*)\]$/.exec(s);
    if(table){
      section=table[1];
      if(has(obj,section))throw Error('duplicate TOML table '+section);
      obj[section]=Object.create(null);continue;
    }
    if(s.startsWith('['))throw Error('unsupported nested/array TOML table at '+(i+1));
    const kv=/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(s);
    if(!kv)throw Error('unsupported or dotted TOML key at '+(i+1));
    if(has(obj[section],kv[1]))throw Error('duplicate TOML key '+kv[1]);
    try{obj[section][kv[1]]=JSON.parse(kv[2]);}
    catch{throw Error('nonliteral TOML value at '+(i+1));}
  }
  return {name:obj[''].name,main:obj[''].main,compatibility_date:obj[''].compatibility_date,
    workers_dev:obj[''].workers_dev,vars:obj.vars,
    env:Object.entries(obj).filter(([k])=>k.startsWith('env.'))
      .reduce((a,[k,v])=>{const parts=k.split('.');
        if(parts.length===2)a[parts[1]]={...(a[parts[1]]||{}),...v};
        else if(parts.length===3){a[parts[1]]={...(a[parts[1]]||{}),[parts[2]]:v};}
        else a[k]=v;
        return a;},Object.create(null)),
    __tables:Object.keys(obj)};
}
export function parseRestrictedWrangler(source){
  if(typeof source!=='string')throw Error('Wrangler source must be text');
  let data;
  if(source.trimStart().startsWith('{')){
    // JSON is a strict, valid subset of Wrangler JSONC.
    data=JSON.parse(source);
    if(!keys(data,['name','main','compatibility_date','workers_dev','vars','env']))
      throw Error('unknown Wrangler JSON root key');
  }else{
    data=parseToml(source);
    if(!keys(data[''],['name','main','compatibility_date','workers_dev']))
      throw Error('unknown TOML root configuration');
    if(data.__tables.sort().join('|') !==
      ['', 'vars','env.staging','env.staging.vars'].sort().join('|'))
      throw Error('unknown/nested TOML environment or resource binding');
  }
  if(!keys(data.vars,['STARRY_ENVIRONMENT','STARRY_APP_ID']) ||
     !keys(data.env,['staging']) ||
     !keys(data.env.staging,['name','workers_dev','vars']) ||
     !keys(data.env.staging.vars,['STARRY_ENVIRONMENT','STARRY_APP_ID']))
    throw Error('unknown or nested env/binding keys');
  if(data.name!=='starry-id-api-local'||data.main!=='src/index.ts'||
    data.compatibility_date!=='2026-10-01'||data.workers_dev!==false||
    data.vars.STARRY_ENVIRONMENT!=='development'||data.vars.STARRY_APP_ID!=='starry-id'||
    data.env.staging.name!=='starry-id-api-staging'||
    data.env.staging.workers_dev!==false||
    data.env.staging.vars.STARRY_ENVIRONMENT!=='staging'||
    data.env.staging.vars.STARRY_APP_ID!=='starry-id')
    throw Error('unreviewed runtime identity/environment');
  return {'':{name:data.name,main:data.main,compatibility_date:data.compatibility_date,
    workers_dev:data.workers_dev},vars:data.vars,
    'env.staging':{name:data.env.staging.name,workers_dev:data.env.staging.workers_dev},
    'env.staging.vars':data.env.staging.vars};
}

function safeYaml(raw){
  const doc=parseDocument(raw,{uniqueKeys:true,version:'1.2'});
  if(doc.errors.length)throw Error('invalid workflow YAML: '+doc.errors[0].message);
  const y=doc.toJS({maxAliasCount:0});
  if(!isRecord(y))throw Error('workflow is not a map');
  return y;
}
const hasUnsafeValue=x=>{
  if(typeof x==='string'){
    return /\$\{\{\s*(?:secrets\.|github\.token|env\.CLOUDFLARE_|vars\.STARRY_STAGING_ENABLED)/i.test(x) ||
      /(?:wrangler|npx\s+wrangler)\s+(?:deploy|publish)(?!\s+--dry-run)|wrangler-action|eas\s+(?:build|submit|update)|gh\s+(?:release|api)\s|curl\s.*(?:api\.cloudflare\.com|api\.github\.com)/i.test(x);
  }
  return Array.isArray(x)?x.some(hasUnsafeValue):isRecord(x)?Object.values(x).some(hasUnsafeValue):false;
};
export function inspectWorkflow(raw,kind){
  const issues=[];
  let y;
  try{y=safeYaml(raw);}catch(e){return [e.message];}
  const error = x => issues.push(x);
  const triggers=y.on;
  if(!isRecord(triggers))error('workflow triggers must be a map');
  else if(kind==='production'){
    if(!keys(triggers,['workflow_dispatch']))error('production must be manual dispatch only');
  }else{
    if(!keys(triggers,['pull_request','push','workflow_dispatch']) ||
      !keys(triggers.pull_request,['branches']) ||
      !keys(triggers.push,['branches']) ||
      JSON.stringify(triggers.pull_request.branches)!=='["main"]' ||
      JSON.stringify(triggers.push.branches)!=='["main"]')
      error('CI triggers must be restricted to PR/main and main push');
  }
  if(!keys(y.permissions,['contents'])||y.permissions.contents!=='read')
    error('workflow effective token permissions must be read-only');
  if(hasUnsafeValue(y))error('workflow has secrets, deployment or unsafe privileged expression');
  if(!isRecord(y.jobs))return [...issues,'workflow has no jobs'];
  for(const [name,job] of Object.entries(y.jobs)){
    if(!isRecord(job)||!Array.isArray(job.steps)||!job.steps.length)
      {error('job without valid steps: '+name);continue;}
    if(job.permissions && (!keys(job.permissions,['contents'])||job.permissions.contents!=='read'))
      error('job may not escalate token permissions: '+name);
    if(job.secrets || job.environment && kind!=='production')error('CI job has secrets/environment: '+name);
    if(job.steps.some(s=>s.with?.['persist-credentials']===true))
      error('checkout credentials persisted: '+name);
  }
  // Reject extra CI steps and disguised auto-deploy calls, not only known names.
  if(kind==='ci') {
    // Fail closed on edits to non-app jobs too: an extra repository-policy shell
    // command or aggregator command must never bypass the reviewed allowlist.
    const policy=y.jobs['repository-policy'];
    const policySteps=policy?.steps||[];
    const expectedDetect=[
      'if test -f package.json && test -f package-lock.json; then',
      '  echo "ready=true" >> "$GITHUB_OUTPUT"',
      'else',
      '  echo "ready=false" >> "$GITHUB_OUTPUT"',
      '  echo "App code/tests not initialized; repository policy PASS is NOT app-test PASS."',
      'fi',
    ].join('\n');
    if(policySteps.length!==3 ||
      policySteps[0]?.uses!=='actions/checkout@v4' ||
      policySteps[1]?.run?.trim()!=='python3 scripts/ci/validate_repository.py' ||
      policySteps[2]?.id!=='app'||policySteps[2]?.shell!=='bash'||
      policySteps[2]?.run?.trim()!==expectedDetect)
      error('unreviewed repository-policy shell or action step');
    const required=y.jobs['required-validation'];
    const aggregateSteps=required?.steps||[];
    const expectedAggregate=['test "$POLICY_RESULT" = success',
      'test "$APP_RESULT" = success'].join('\n');
    const requiredEnv=aggregateSteps[0]?.env;
    if(aggregateSteps.length!==1 ||
      aggregateSteps[0]?.run?.trim()!==expectedAggregate ||
      !keys(requiredEnv,['POLICY_RESULT','APP_RESULT']) ||
      requiredEnv.POLICY_RESULT!==('$'+'{{ needs.repository-policy.result }}') ||
      requiredEnv.APP_RESULT!==('$'+'{{ needs.app-tests.result }}'))
      error('unreviewed required-validation script or result bindings');
    const approvedRuns=new Set([
      'npm ci --no-audit --no-fund',
      'npm run typecheck','npm run lint','npm test',
      'npm run auth:typecheck','npm run w3:typecheck','npm run auth:test',
      'npm run mobile:config','npm run api:check','npm run api:runtime',
      'npm run release:blocked','npm run promotion:verify',
      'python3 scripts/ci/validate_repository.py',
      'node -e \'const s=require("./package.json").scripts||{}; for(const k of ["typecheck","lint","test"]) if(!s[k]) throw Error("Missing "+k)\'',
    ]);
    for(const [name,job] of Object.entries(y.jobs)){
      for(const step of job.steps||[]){
        if(step.uses && !['actions/checkout@v4','actions/setup-node@v4'].includes(step.uses))
          error('unapproved workflow action: '+step.uses);
        if(step.uses==='actions/checkout@v4' && step.with?.['persist-credentials']!==false)
          error('checkout must drop credentials');
        if(step.uses==='actions/setup-node@v4' && step.with?.['node-version']!=='22')
          error('unreviewed CI Node version');
        if(step.run && name==='app-tests' && !approvedRuns.has(step.run.trim()))
          error('unapproved App CI shell command');
      }
    }
  }
  if(kind==='production'){
    if(!keys(y.jobs,['blocked']))error('production must have only hard-blocked job');
    const blocked=y.jobs.blocked;
    if(!blocked||blocked.environment!=='production'||blocked.steps?.length!==1 ||
      typeof blocked.steps[0]?.run!=='string' ||
      !(() => {const lines=blocked.steps[0].run.trim().split(/\r?\n/).map(x=>x.trim());
        return lines.length===2 && lines[0].startsWith('echo "::error::Production deployment deliberately unavailable.') && lines[1]==='exit 1';})())
      error('production job must exit 1, with no side effects');
  }else{
    if(!keys(y.jobs,['required-validation','repository-policy','app-tests']))
      error('CI may not contain additional deploy jobs');
    const check=y.jobs['required-validation'];
    if(check?.if!=='always()'||
      JSON.stringify(check?.needs)!=='["repository-policy","app-tests"]'||
      !check.steps?.some(s=>typeof s.run==='string' &&
        s.run.includes('test "$POLICY_RESULT" = success') &&
        s.run.includes('test "$APP_RESULT" = success')))
      error('Required validation fail-closed aggregator missing');
    const runs=(y.jobs['app-tests']?.steps||[]).map(s=>s.run).filter(x=>typeof x==='string');
    for(const cmd of ['npm run typecheck','npm run lint','npm test',
      'npm run mobile:config','npm run api:check','npm run api:runtime',
      'npm run release:blocked','npm run promotion:verify']){
      if(!runs.some(x=>x.trim()===cmd))error('Missing mandatory CI command '+cmd);
    }
  }
  return issues;
}

const legacyManifest = [
  'docs/operations/AI4-W3-AUTH-SOURCE-CLOSURE.v1.json',
  'docs/operations/AI4-W3-FINAL-PROMOTION-CLOSURE.v1.json',
];
// Reviewed application changes are allowed by directory and a separate PR/review
// contract; original SHA snapshots stay intact in their historical manifests.
export function pathAllowed(path){
  if(path.startsWith('.github/workflows/'))
    return ['.github/workflows/starry-ci.yml','.github/workflows/starry-production.yml'].includes(path);
  if(/(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:secrets?|tokens?|credentials?)(?:\/|$)/i.test(path))return false;
  if(path==='package.json'||path==='package-lock.json'||path==='tsconfig.json'||path==='eslint.config.mjs')return true;
  if(/^(?:AGENTS\.md|\.gitignore|\.github\/(?:CODEOWNERS|dependabot\.yml|pull_request_template\.md|agents\/[\w-]+\.agent\.md))$/.test(path))return true;
  if(/^docs\/(?:ai|contracts|operations|release-readiness)\/[\w./-]+\.(?:md|mjs|json|yaml|yml)$/.test(path))return true;
  if(/^scripts\/(?:promotion|ci)\/[\w./-]+\.(?:mjs|py|json)$/.test(path))return true;
  if(/^apps\/api\/(?:src|schema|test|test-support)\/[\w./-]+\.(?:ts|mjs|sql|json)$/.test(path))return true;
  if(/^apps\/api\/(?:package\.json|wrangler\.(?:toml|json|jsonc)|openapi\.yaml)$/.test(path))return true;
  if(/^apps\/mobile\/[\w./-]+\.(?:tsx?|mjs|json|md)$/.test(path))return true;
  if(/^modules\/starry-id-v1\/(?:src|test|schema)\/[\w./-]+\.(?:tsx?|mjs|sql|json)$/.test(path))return true;
  if(/^modules\/starry-id-v1\/(?:tsconfig\.json|[\w-]+\.md)$/.test(path))return true;
  if(/^packages\/(?:sdk|integration|rebuild-billing|rebuild-ai3)\/[\w./-]+\.(?:tsx?|mjs|json|md|sql)$/.test(path))return true;
  return false;
}
export function validateCapability(c){
  const errs=[];
  const bad = e => errs.push(e);
  if(!isRecord(c)||c.schema!=='starry.ai4.m0.platform-capabilities.v2'||
    c.stage!=='source_only_not_publishable'||c.production_enabled!==false)
    return ['Invalid capability schema/stage/release boundary'];
  if(!Array.isArray(c.routes)||c.routes.length!==2)bad('expected health and inert staging member route');
  const routeOk=(r,method,path,auth,enabled,envs)=>
    keys(r,['method','path','auth','environments','enabled','aliases','bindings']) &&
    r.method===method&&r.path===path&&r.auth===auth&&r.enabled===enabled&&
    JSON.stringify(r.environments)===JSON.stringify(envs)&&
    Array.isArray(r.aliases)&&r.aliases.length===0;
  const [health,member]=c.routes||[];
  if(!routeOk(health,'GET','/v1/health','none',true,['development','staging'])||
    !Array.isArray(health.bindings)||health.bindings.length!==0)
    bad('unreviewed public health route');
  if(!routeOk(member,'GET','/v1/starry-id/members/me','starry-session',false,['staging'])||
    !Array.isArray(member.bindings)||member.bindings.length!==1||
    !keys(member.bindings[0],['name','kind','provisioned'])||
    member.bindings[0].name!=='STARRY_SESSION_DB'||member.bindings[0].kind!=='injected-test-port'||
    member.bindings[0].provisioned!==false)
    bad('member route must remain inert / staging-only / no real binding');
  if(!Array.isArray(c.reviewed_source_paths)||
    new Set(c.reviewed_source_paths).size!==c.reviewed_source_paths.length||
    c.reviewed_source_paths.some(p=>!pathAllowed(p)||p.startsWith('.github/')))
    bad('unreviewed source path or duplicate');
  return errs;
}
export function inspectM0({read,trackedPaths,hashOf}){
  const out={release:[],provenance:[],capability:[],runtime:[]};
  const fail=(g,msg)=>out[g].push(msg);
  const readSafe=(p,g)=>{try{return read(p);}catch{fail(g,'Missing artifact: '+p);return null;}};
  const official=readSafe('docs/release-readiness/release-readiness.v0.json','release');
  if(official){
    try{
      const r=JSON.parse(official);
      if(!Array.isArray(r.gates)||r.gates.length!==11||
        r.gates.some((g,i)=>g.id!==GATES[i]||g.status!=='blocked'||!Array.isArray(g.evidence)||g.evidence.length!==0)||
        r.release_authorization?.granted!==false||
        r.deployment_automation?.enabled!==false||
        r.deployment_automation?.can_auto_deploy!==false)
        fail('release','G00-G10 / release permissions not blocked');
    }catch{fail('release','Invalid official readiness JSON');}
  }
  const immutableLedgerHashes = ['cde8818735567636c6076dc45e477038983a029a',
    '9b4bb59979024e2b8c55eaf5ba08106153469eb9'];
  for(const [i,p] of legacyManifest.entries()){
    if(typeof hashOf === 'function' && hashOf(p)!==immutableLedgerHashes[i])
      fail('provenance','Historical source ledger altered: '+p);
    const s=readSafe(p,'provenance');
    if(!s)continue;
    try{
      const m=JSON.parse(s);
      if(!Array.isArray(m.source_files)||![20,10].includes(m.selected_count)||
        m.source_files.length!==m.selected_count||
        new Set(m.source_files.map(x=>x.path)).size!==m.selected_count||
        m.source_files.some(x=>typeof x.path!=='string'||!pathAllowed(x.path)||
          !/^[0-9a-f]{40}$/.test(x.sha)))
        fail('provenance','Invalid immutable historical source ledger: '+p);
    }catch{fail('provenance','Unreadable historical ledger: '+p);}
  }
  for(const [p,kind] of [
    ['.github/workflows/starry-ci.yml','ci'],
    ['.github/workflows/starry-production.yml','production'],
  ]){
    const x=readSafe(p,'release');
    if(x!==null)out.release.push(...inspectWorkflow(x,kind).map(e=>p+': '+e));
  }
  const cap=readSafe('docs/operations/AI4-M0-PLATFORM-CAPABILITIES.v1.json','capability');
  if(cap){try{out.capability.push(...validateCapability(JSON.parse(cap)));}
    catch{fail('capability','Invalid capability JSON');}}
  for(const p of trackedPaths){
    if(!pathAllowed(p))fail('provenance','Unexpected/sensitive tracked path: '+p);
  }
  const wr=readSafe('apps/api/wrangler.toml','runtime');
  if(wr)try{parseRestrictedWrangler(wr);}
    catch(e){fail('runtime','Wrangler denied: '+e.message);}
  if(!trackedPaths.includes('apps/api/test/workerd-runtime.test.mjs')||
    !trackedPaths.includes('scripts/promotion/m0-guard-policy.test.mjs'))
    fail('runtime','Runtime/guard tests absent');
  return out;
}
export const flattenM0=r=>Object.entries(r).flatMap(([g,a])=>a.map(e=>'M0 '+g.toUpperCase()+': '+e));
