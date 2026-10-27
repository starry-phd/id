import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=new URL('../../',import.meta.url);
const canonical=['auth','billing','battery','task','audit'];
const authoritative=['G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1','G04-STORE','G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE','G08-WORKER-SDK','G09-DEVICES','G10-OPS'];
const SHA=/^[a-f0-9]{40}$/;
export const readJson=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
export function validateTrustPreflight(registry,release){
  const errors=[],fail=m=>errors.push(m);
  if(!registry||!Array.isArray(registry.domains))return {ok:false,errors:['invalid trust registry']};
  if(registry.classification!=='AI0_DRAFT_TRUST_ROOT_READINESS_NOT_IMPLEMENTATION' ||
    registry.scope!=='starry_only_hglobal_excluded' ||
    registry.fixed_verified_baseline?.pr!==94 ||
    !SHA.test(registry.fixed_verified_baseline?.sha??''))
    fail('baseline / scope / classification mismatch');
  for(const k of ['real_credentials_recorded','deploy_authorized','signing_authority_ready','independent_nonrollbackable_anchor_ready','data_residency_approved','initial_staging_cost_approved']){
    if(registry[k]!==false)fail('trust readiness incorrectly asserted: '+k);
  }
  if(registry.all_release_gates_blocked!==true||registry.production_use_prohibited!==true)
    fail('release safety assertion disabled');
  if(!Array.isArray(registry.global_conditions)||registry.global_conditions.length<7)
    fail('cross-domain global obligations missing');
  if(registry.domains.length!==5)fail('expected five separate Starry trust domains');
  const seen=new Set(),keys=new Set(),modules=new Set();
  for(const domain of registry.domains){
    if(!domain||!canonical.includes(domain.id)||seen.has(domain.id))fail('invalid or repeated trust domain');
    seen.add(domain?.id);
    if(!/^AI-[1-4]$/.test(domain?.owner??''))fail('missing valid owner for '+domain?.id);
    if(typeof domain.key_namespace!=='string'||!domain.key_namespace.startsWith('starry.')||keys.has(domain.key_namespace))
      fail('shared or invalid key namespace: '+domain?.id);
    keys.add(domain.key_namespace);
    if(typeof domain.source_file!=='string'||modules.has(domain.source_file)||!domain.source_file.includes('/src/'))
      fail('invalid or repeated module: '+domain?.id);
    modules.add(domain.source_file);
    if(domain.signed_issuer!=='not_provisioned' ||
       domain.protected_independent_head!=='not_provisioned' ||
       domain.rotation!=='not_approved' ||
       domain.authority_location!=='UNKNOWN' ||
       domain.lawful_retention!=='pending_review' ||
       domain.staging_evidence!==null)
      fail('invented or assumed live trust evidence: '+domain?.id);
    if(!/^LIVE_[A-Z0-9_]+$/.test(domain.live_flag)&&domain.live_flag!=='SIGNED_TASK_PROOF_LIVE'&&domain.live_flag!=='BILLING_SIGNED_WITNESS_LIVE_ENABLED')
      fail('flag missing: '+domain?.id);
  }
  if(canonical.some(id=>!seen.has(id)))fail('trust domain coverage incomplete');
  if(!release||!Array.isArray(release.gates)||release.gates.length!==11||
      authoritative.some(id=>!release.gates.some(g=>g.id===id&&g.status==='blocked'))||
      release.release_authorization?.granted!==false||
      release.deployment_automation?.can_auto_deploy!==false)
    fail('official release permissions/G00–G10 changed');
  return {ok:errors.length===0,errors,domain_count:registry.domains.length,level:'historical_document_and_offline_guards_only'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=validateTrustPreflight(readJson('docs/operations/r13-trust-roots.v0.json'),readJson('docs/release-readiness/release-readiness.v0.json'));
 if(!result.ok){console.error(result.errors.join('\n'));process.exitCode=1;}
 else console.log('R13 trust-root preflight PASS (5 proposal-only domains; 11 release Gates BLOCKED; no live authority)');
}
