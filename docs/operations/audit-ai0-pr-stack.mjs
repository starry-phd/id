import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const SHA=/^[0-9a-f]{40}$/;
const BRANCH=/^ai0\/[a-zA-Z0-9._/-]+$/;

/**
 * Audit a GitHub PR metadata SNAPSHOT. This does NOT call GitHub,
 * check main's contents, or certify the PR list is still current.
 */
export function auditDraftStack(snapshot,release){
 const failures=[];
 const fail=s=>failures.push(s);
 if(!snapshot||typeof snapshot!=='object'||!Array.isArray(snapshot.prs))return {ok:false,failures:['invalid manifest'],count:0};
 if(snapshot.repository!=='starry-phd/id'||snapshot.scope!=='snapshot_only_no_live_queries'||snapshot.not_release_permission!==true)
   fail('manifest claims incorrect scope or permission');
 if(snapshot.upstream_of_first_pr_not_checked!==true||snapshot.r12_owner_prs_excluded_as_in_progress!==true)
   fail('snapshot boundaries not disclosed');
 if(snapshot.first_audited_pr!==64||snapshot.latest_verified_integration_pr!==88||!SHA.test(snapshot.latest_verified_integration_sha||''))
   fail('verified integration anchor missing or unrecognized');
 if(snapshot.prs.length!==9)fail('expected exactly nine R7-R11 AI-0 dependency entries');
 const seenPr=new Set(),seenHead=new Set(),seenSha=new Set();
 for(let i=0;i<snapshot.prs.length;i++){
   const p=snapshot.prs[i]||{};
   if(!Number.isSafeInteger(p.pr)||p.pr<1||seenPr.has(p.pr))fail('duplicate/invalid PR at '+i);
   seenPr.add(p.pr);
   if(p.url!==`https://github.com/starry-phd/id/pull/${p.pr}`)fail('PR URL mismatch at '+i);
   if(typeof p.base_branch!=='string'||!BRANCH.test(p.base_branch)||p.base_branch.includes('..'))
     fail('unexpected base at '+i);
   if(typeof p.head_branch!=='string'||!BRANCH.test(p.head_branch)||p.head_branch.includes('..')||seenHead.has(p.head_branch))
     fail('unexpected/duplicate head at '+i);
   seenHead.add(p.head_branch);
   if(typeof p.head_sha!=='string'||!SHA.test(p.head_sha)||seenSha.has(p.head_sha))
     fail('invalid/duplicate SHA at '+i);
   seenSha.add(p.head_sha);
   if(p.base_branch===p.head_branch)fail('self-referential PR at '+i);
   if(p.state!=='open'||p.draft!==true||p.merged!==false)
     fail('status differs from observed Draft snapshot at '+i);
   if(i>0&&p.base_branch!==snapshot.prs[i-1].head_branch)
     fail('broken sequential PR branch dependency: '+p.pr);
 }
 if(snapshot.prs[0]?.pr!==snapshot.first_audited_pr)
   fail('audited chain starts on wrong PR');
 const last=snapshot.prs.at(-1);
 if(last?.pr!==snapshot.latest_verified_integration_pr||last?.head_sha!==snapshot.latest_verified_integration_sha)
   fail('verified integration HEAD differs from chain tip');
 const knownIds=['G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1','G04-STORE','G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE','G08-WORKER-SDK','G09-DEVICES','G10-OPS'];
 if(!release||!Array.isArray(release.gates)||release.gates.length!==knownIds.length||
    knownIds.some(id=>!release.gates.some(g=>g.id===id&&g.status==='blocked')))
   fail('official release Gate set not all blocked');
 if(release?.release_authorization?.granted!==false||
    release?.deployment_automation?.can_auto_deploy!==false)
   fail('official authorization state changed');
 return {ok:failures.length===0,failures,count:snapshot.prs.length,
   snapshot_tip:last?.head_sha,verified_release:false,
   warning:'This is an offline historical snapshot audit; refresh current GitHub PR refs, protected checks and main ancestry before any promotion.'};
}
const me=fileURLToPath(import.meta.url);
if(process.argv[1]&&resolve(process.argv[1])===me){
 const root=new URL('../../',import.meta.url);
 const read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
 const res=auditDraftStack(read('docs/operations/ai0-pr-stack-snapshot-r11.json'),
   read('docs/release-readiness/release-readiness.v0.json'));
 if(!res.ok){console.error('AI-0 PR stack audit FAILED:',res.failures.join(' | '));process.exitCode=1;}
 else console.log('AI-0 PR stack historical snapshot PASS: '+res.count+' Draft entries, verified R11 tip '+res.snapshot_tip+', 11/11 release Gates BLOCKED. Live GitHub refs NOT checked; no merge/deploy authorization.');
}
