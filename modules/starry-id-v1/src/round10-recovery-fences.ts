/**
 * AI-1 R10: Starry ID anti-resurrection fence reader for AI-3 isolated restore.
 *
 * OFFLINE / default-OFF / read-only. Fences in the same D1 backup alone
 * CANNOT detect PITR rollback: require a separately stored, independently
 * authenticated and RECENT checkpoint from a non-rollbackable authority.
 * This is an integration contract, not proof that such infrastructure exists.
 */
import type {TrustedScope} from './index.ts';
import type {D1Database} from './d1-ports.ts';

export const LIVE_STARRY_RECOVERY_FENCES_ENABLED=false as const;
export type AuthFenceCounters=Readonly<{
 deleted_members:number;
 revoked_sessions:number;
 claimed_registration_gifts:number;
}>;
export type IndependentAuthCheckpoint=Readonly<{
 brand_id:'starry';environment:'development'|'staging';
 source:'independent_append_only';
 witness_ref:string;observed_at:number;
 counters:AuthFenceCounters;
}>;
export type RecoveryFenceReview=Readonly<{
 disposition:'review_only';may_restore:false;
 counters:AuthFenceCounters;checked_at:number;
}>;
const keys=['deleted_members','revoked_sessions','claimed_registration_gifts'] as const;
const validCounter=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v);
function counters(v:unknown):v is AuthFenceCounters{
 try {
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return false;
  const own=Reflect.ownKeys(v);
  if(own.length!==3)return false;
  return keys.every(k=>{
   const d=Object.getOwnPropertyDescriptor(v,k);
   return d!==undefined&&d.enumerable&&'value' in d&&validCounter(d.value);
  });
 }catch{return false;}
}
function independent(v:unknown,scope:TrustedScope,now:number):v is IndependentAuthCheckpoint{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return false;
  const descriptors=Object.getOwnPropertyDescriptors(v);
  const fields=['brand_id','environment','source','witness_ref','observed_at','counters'];
  if(Reflect.ownKeys(v).length!==fields.length||
   !fields.every(k=>Object.hasOwn(descriptors,k)&&'value' in descriptors[k]&&
     descriptors[k].enumerable))return false;
  return descriptors.brand_id.value==='starry'&&
   descriptors.environment.value===scope.environment&&
   descriptors.source.value==='independent_append_only'&&
   id(descriptors.witness_ref.value)&&
   validCounter(descriptors.observed_at.value)&&
   descriptors.observed_at.value<=now&&now-descriptors.observed_at.value<=30&&
   counters(descriptors.counters.value);
 }catch{return false;}
}
/** Auth-only counters; AI-3 owns the OTHER four fences and the global proof. */
export function createOfflineStarryRecoveryFenceAuthority(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;db:D1Database;
 // Must not consult the snapshot being reviewed or any state restored with it.
 privacyAndRecoveryApprovedNow:()=>Promise<boolean>;
 readIndependentCheckpoint:()=>Promise<IndependentAuthCheckpoint|null>;
 verifyIndependentAttestation:(witness:IndependentAuthCheckpoint)=>Promise<boolean>;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!id(scope.app_id)||
   !['development','staging'].includes(scope.environment))
   throw Error('RECOVERY_AUTH_SCOPE_DENIED');
 const enabled=deps.enabled===true;
 return Object.freeze({
  async review(now:number):Promise<RecoveryFenceReview|null>{
   if(!enabled||!validCounter(now))return null;
   try{
    // Do not access D1, backing store or any potentially sensitive checkpoint
    // until the current lawful review purpose has been approved.
    if(await deps.privacyAndRecoveryApprovedNow()!==true)return null;
    const witness=await deps.readIndependentCheckpoint();
    if(!independent(witness,scope,now)||
      await deps.verifyIndependentAttestation(witness)!==true)return null;
    const row=await deps.db.prepare(
     "SELECT deleted_members,revoked_sessions,claimed_registration_gifts "+
     "FROM starry_auth_recovery_fence WHERE realm='starry' LIMIT 1"
    ).first<AuthFenceCounters>();
    if(!counters(row))return null;
    if(keys.some(k=>row[k]!==witness.counters[k]))return null;
    // No full recovery manifest is created and RESTORE is NEVER permitted.
    const safe=Object.freeze({...row});
    return Object.freeze({disposition:'review_only' as const,
     may_restore:false as const,counters:safe,checked_at:now});
   }catch{return null;}
  },
 });
}
