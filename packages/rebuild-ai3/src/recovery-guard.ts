/** Q116: OFFLINE-only restore evidence gate, not a D1/R2/Queue adapter. */
export const LIVE_RECOVERY_ENABLED = false as const;
export const RESTORE_MUTATION_ALLOWED = false as const;
export const FENCE_NAMES = [
  'deleted_members', 'revoked_sessions', 'claimed_registration_gifts',
  'battery_journal', 'committed_ai_tasks', 'billing_outbox', 'audit_events',
] as const;
export type FenceName = typeof FENCE_NAMES[number];
export type Fences = Readonly<Record<FenceName,number>>;
export type RestoreScope = Readonly<{
  brand_id:'starry'; environment:'isolated-test'; dataset:'battery'|'audit'|'appeals';
}>;
export type RecoveryArtifact = Readonly<{
  source:'d1_pitr'|'independent_backup'; artifact_ref:string; manifest_sha256:string;
  captured_ms:number; checkpoints:Fences;
}>;
export type RecoveryBundle = Readonly<{
  scope:RestoreScope; artifacts:readonly [RecoveryArtifact,RecoveryArtifact];
  request_ref:string; requested_ms:number;
}>;
export type RecoveryDecision = Readonly<{
  disposition:'blocked'|'review_only'; reason:string;
  blocked_fences:readonly FenceName[];
  may_restore:false;
}>;
/** Server-injected adapters; none can be supplied by an HTTP request. */
export type TrustedRecoveryPorts = Readonly<{
  verifyPitr:(artifact:RecoveryArtifact,scope:RestoreScope)=>Promise<boolean>;
  verifyIndependentBackup:(artifact:RecoveryArtifact,scope:RestoreScope)=>Promise<boolean>;
  readAuthoritativeFences:(scope:RestoreScope)=>Promise<Fences|null>;
  readLegalHold:(scope:RestoreScope)=>Promise<'clear'|'held'|'unknown'>;
  verifyOperatorStepUp:(scope:RestoreScope,request_ref:string)=>Promise<boolean>;
  recordReviewEvidence:(scope:RestoreScope,request_ref:string,artifacts:readonly string[])=>Promise<boolean>;
}>;
const id=/^[a-z][A-Za-z0-9._:-]{3,95}$/;
const digest=/^[a-f0-9]{64}$/;
const safe=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function plain(x:unknown):x is Record<string,unknown> {
  try {
    if(x===null||typeof x!=='object'||Array.isArray(x))return false;
    const proto=Object.getPrototypeOf(x);
    if(proto!==Object.prototype&&proto!==null)return false;
    return Reflect.ownKeys(x).every(k=>{
      const d=Object.getOwnPropertyDescriptor(x,k);
      return typeof k==='string'&&d!==undefined&&d.enumerable&&'value' in d;
    });
  } catch{return false;}
}
function exact(x:unknown,keys:readonly string[]):x is Record<string,unknown> {
  return plain(x)&&Reflect.ownKeys(x).length===keys.length&&
    keys.every(k=>Object.hasOwn(x,k));
}
function fenceValid(x:unknown):x is Fences {
  return exact(x,FENCE_NAMES)&&FENCE_NAMES.every(k=>safe(x[k]));
}
function scopeValid(x:unknown):x is RestoreScope {
  return exact(x,['brand_id','environment','dataset'])&&x.brand_id==='starry'&&
    x.environment==='isolated-test'&&['battery','audit','appeals'].includes(x.dataset as string);
}
function artifactValid(x:unknown):x is RecoveryArtifact {
  return exact(x,['source','artifact_ref','manifest_sha256','captured_ms','checkpoints'])&&
    (x.source==='d1_pitr'||x.source==='independent_backup')&&
    typeof x.artifact_ref==='string'&&id.test(x.artifact_ref)&&
    typeof x.manifest_sha256==='string'&&digest.test(x.manifest_sha256)&&
    safe(x.captured_ms)&&fenceValid(x.checkpoints);
}
function bundleValid(x:unknown):x is RecoveryBundle {
  if(!exact(x,['scope','artifacts','request_ref','requested_ms'])||
    !scopeValid(x.scope)||typeof x.request_ref!=='string'||!id.test(x.request_ref)||
    !safe(x.requested_ms))return false;
  try {
    if(!Array.isArray(x.artifacts)||x.artifacts.length!==2||
      Reflect.ownKeys(x.artifacts).length!==3)return false;
    // The length and both elements must be intrinsic data; no accessor values.
    return [0,1].every(n=>{
      const d=Object.getOwnPropertyDescriptor(x.artifacts,String(n));
      return d&&'value' in d&&d.enumerable&&artifactValid(d.value);
    });
  }catch{return false;}
}
const denied=(reason:string,blocked_fences:readonly FenceName[]=[]):RecoveryDecision=>
  Object.freeze({disposition:'blocked',reason,blocked_fences:Object.freeze([...blocked_fences]),may_restore:false});
const review=():RecoveryDecision=>Object.freeze({disposition:'review_only',reason:'ISOLATED_REVIEW_NO_MUTATION',
  blocked_fences:Object.freeze([]),may_restore:false});

/**
 * Proves compatibility with a fresh authoritative fence; a stale PITR or R2
 * copy must never resurrect revoked sessions, deleted users or gift claims.
 * The only successful outcome is a documented review, NEVER a restore command.
 */
export async function assessIsolatedRestore(bundle:unknown,ports:TrustedRecoveryPorts,
 now_ms:number):Promise<RecoveryDecision>{
  if(!safe(now_ms)||!bundleValid(bundle))return denied('INVALID_UNTRUSTED_MANIFEST');
  const [pitr,backup]=bundle.artifacts;
  if(pitr.source!=='d1_pitr'||backup.source!=='independent_backup'||
    pitr.artifact_ref===backup.artifact_ref||pitr.manifest_sha256===backup.manifest_sha256||
    bundle.requested_ms>now_ms||pitr.captured_ms>now_ms||backup.captured_ms>now_ms)
    return denied('NON_INDEPENDENT_OR_FUTURE_EVIDENCE');
  // Drift between snapshots requires isolated reconciliation. Never use the
  // older snapshot as an automatic source of current live entitlements.
  const disagreement=FENCE_NAMES.filter(k=>pitr.checkpoints[k]!==backup.checkpoints[k]);
  if(disagreement.length)return denied('SOURCES_DISAGREE_REPLAY_REVIEW',disagreement);
  if(!ports||typeof ports.verifyPitr!=='function'||
    typeof ports.verifyIndependentBackup!=='function'||
    typeof ports.readAuthoritativeFences!=='function'||
    typeof ports.readLegalHold!=='function'||
    typeof ports.verifyOperatorStepUp!=='function'||
    typeof ports.recordReviewEvidence!=='function')return denied('TRUSTED_PORTS_MISSING');
  try {
    // Both sources verified server-side before any restoration is considered.
    if(await ports.verifyPitr(pitr,bundle.scope)!==true||
      await ports.verifyIndependentBackup(backup,bundle.scope)!==true)
      return denied('CRYPTOGRAPHIC_BACKUP_PROOF_DENIED');
    const current=await ports.readAuthoritativeFences(bundle.scope);
    if(!fenceValid(current))return denied('LIVE_FENCE_UNAVAILABLE');
    const drift=FENCE_NAMES.filter(k=>current[k]!==pitr.checkpoints[k]);
    if(drift.length)return denied('PITR_STALE_OR_DIVERGENT',drift);
    const hold=await ports.readLegalHold(bundle.scope);
    if(hold!=='clear')return denied('LEGAL_HOLD_OR_UNKNOWN');
    if(await ports.verifyOperatorStepUp(bundle.scope,bundle.request_ref)!==true)
      return denied('OPERATOR_STEPUP_DENIED');
    if(await ports.recordReviewEvidence(bundle.scope,bundle.request_ref,
      [pitr.artifact_ref,backup.artifact_ref])!==true)
      return denied('REVIEW_EVIDENCE_NOT_DURABLE');
    return review();
  }catch{return denied('AUTHORITY_UNAVAILABLE');}
}
