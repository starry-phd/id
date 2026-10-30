/**
 * AI-3 M2/M4: local, side-effect-free PITR reconciliation risk analyzer.
 *
 * Neither an independent witness nor an authorization to restore is created
 * here. Inputs are strictly offline synthetic records. The result can ONLY
 * quarantine a candidate and describe risks; it cannot approve restore,
 * publish, grant Battery, write D1, ACK Queue or replay deletion.
 *
 * Physically independent custody, lawful witness retention (Q104/Q119),
 * provenance and real recovery replay remain separate AI-0/Gate decisions.
 */
export const M2_PITR_RECONCILER_LIVE_ENABLED = false as const;
export type OfflineRecoveryRisk =
  | 'SNAPSHOT_BEHIND_WITNESS'
  | 'DELETED_MEMBER_REAPPEARED'
  | 'DELETED_PROFILE_REAPPEARED'
  | 'AUTH_VERSION_ROLLBACK'
  | 'OLD_SESSION_UNREVOKED'
  | 'SESSION_ACTIVE_AFTER_DELETION'
  | 'CANDIDATE_MEMBER_NOT_IN_WITNESS';

export type OfflineRecoveryReview = Readonly<{
  status: 'quarantined_review_required';
  risks: readonly OfflineRecoveryRisk[];
  member_count: number;
  witness_count: number;
  may_restore: false;
  may_open_api: false;
  may_grant_battery: false;
  may_ack_queue: false;
  independent_witness_verified: false;
  requires_authoritative_reconciliation: true;
  live_enabled: false;
}>;

const identifier = /^[a-zA-Z0-9_-]{8,64}$/;
const goodVersion = (x:unknown):x is number =>
  typeof x==='number' && Number.isSafeInteger(x) && x>=1;
function record(x:unknown,keys:readonly string[]): x is Record<string,unknown> {
  if (!x || typeof x!=='object' || Array.isArray(x))return false;
  try {
    if (Object.getPrototypeOf(x)!==Object.prototype)return false;
    const own=Reflect.ownKeys(x);
    if (own.length!==keys.length || own.some(k=>typeof k!=='string'||!keys.includes(k)))return false;
    return own.every(k=>Object.getOwnPropertyDescriptor(x,k)?.value !== undefined &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
  }catch{return false;}
}
const validId=(x:unknown):x is string=>typeof x==='string'&&identifier.test(x);
function scope(v:Record<string,unknown>):boolean {
  return v.brand_id==='starry' && v.app_id==='starry-id' &&
    (v.environment==='development'||v.environment==='staging');
}
const cKeys=['brand_id','app_id','environment','snapshot_generation','members'];
const wKeys=['brand_id','app_id','environment','observed_generation','records'];
const memberKeys=['member_ref','status','auth_version','profile_present','sessions'];
const sessionKeys=['session_ref','auth_version','revoked_at'];
const witnessKeys=['member_ref','minimum_auth_version','deleted'];

function parseCandidate(input:unknown){
  if(!record(input,cKeys)||!scope(input)||!goodVersion(input.snapshot_generation)||
    !Array.isArray(input.members)||input.members.length>500)
    throw Error('AI3_RECOVERY_EVIDENCE_DENIED');
  const unique=new Set<string>();
  const members=new Map<string,{status:string;auth_version:number;profile_present:boolean;sessions:{auth_version:number;revoked_at:null|number}[]}>();
  for(const m of input.members){
    if(!record(m,memberKeys)||!validId(m.member_ref)||
      !['active','suspended','deleted'].includes(m.status as string)||
      !goodVersion(m.auth_version)||typeof m.profile_present!=='boolean'||
      !Array.isArray(m.sessions)||m.sessions.length>50||unique.has(m.member_ref))
      throw Error('AI3_RECOVERY_EVIDENCE_DENIED');
    unique.add(m.member_ref);
    const sesUnique=new Set<string>();
    const sessions:{auth_version:number;revoked_at:null|number}[]=[];
    for(const s of m.sessions){
      if(!record(s,sessionKeys)||!validId(s.session_ref)||sesUnique.has(s.session_ref)||
        !goodVersion(s.auth_version)||
        !(s.revoked_at===null||goodVersion(s.revoked_at)))
        throw Error('AI3_RECOVERY_EVIDENCE_DENIED');
      sesUnique.add(s.session_ref);
      sessions.push({auth_version:s.auth_version,revoked_at:s.revoked_at});
    }
    members.set(m.member_ref,{
      status:m.status as string,auth_version:m.auth_version,
      profile_present:m.profile_present,sessions,
    });
  }
  return {input, members};
}
function parseWitness(input:unknown){
  if(!record(input,wKeys)||!scope(input)||!goodVersion(input.observed_generation)||
    !Array.isArray(input.records)||input.records.length>500)
    throw Error('AI3_RECOVERY_EVIDENCE_DENIED');
  const records=new Map<string,{minimum_auth_version:number;deleted:boolean}>();
  for(const r of input.records){
    if(!record(r,witnessKeys)||!validId(r.member_ref)||
      !goodVersion(r.minimum_auth_version)||typeof r.deleted!=='boolean'||
      records.has(r.member_ref))throw Error('AI3_RECOVERY_EVIDENCE_DENIED');
    records.set(r.member_ref,{
      minimum_auth_version:r.minimum_auth_version,deleted:r.deleted,
    });
  }
  return {input,records};
}

/** This is NEVER a real recovery admission or cryptographic witness check. */
export function reviewOfflinePitrCandidate(candidate:unknown,witness:unknown):OfflineRecoveryReview{
  const c=parseCandidate(candidate),w=parseWitness(witness);
  if((c.input as Record<string,unknown>).environment!==(w.input as Record<string,unknown>).environment)
    throw Error('AI3_RECOVERY_SCOPE_DENIED');
  const risks=new Set<OfflineRecoveryRisk>();
  // Both generations were strictly validated as safe integers by the parsers.
  const snapshotGeneration=(c.input as Record<string,number>).snapshot_generation;
  const witnessedGeneration=(w.input as Record<string,number>).observed_generation;
  if(snapshotGeneration<witnessedGeneration)
    risks.add('SNAPSHOT_BEHIND_WITNESS');
  for(const [id,m] of c.members){
    const record=w.records.get(id);
    if(!record){risks.add('CANDIDATE_MEMBER_NOT_IN_WITNESS');continue;}
    if(m.auth_version<record.minimum_auth_version)risks.add('AUTH_VERSION_ROLLBACK');
    if(record.deleted&&m.status!=='deleted')risks.add('DELETED_MEMBER_REAPPEARED');
    if(record.deleted&&m.profile_present)risks.add('DELETED_PROFILE_REAPPEARED');
    for(const s of m.sessions){
      if(s.revoked_at===null && s.auth_version<record.minimum_auth_version)
        risks.add('OLD_SESSION_UNREVOKED');
      if(record.deleted&&s.revoked_at===null)
        risks.add('SESSION_ACTIVE_AFTER_DELETION');
    }
  }
  return Object.freeze({
    status:'quarantined_review_required' as const,
    risks:Object.freeze([...risks].sort()),
    member_count:c.members.size,witness_count:w.records.size,
    may_restore:false as const,may_open_api:false as const,
    may_grant_battery:false as const,may_ack_queue:false as const,
    independent_witness_verified:false as const,
    requires_authoritative_reconciliation:true as const,
    live_enabled:M2_PITR_RECONCILER_LIVE_ENABLED,
  });
}
