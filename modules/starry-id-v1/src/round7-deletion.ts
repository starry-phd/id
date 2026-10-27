/** AI-1 Q88=A/Q97=A draft: immediate auth-version CAS and Starry-only
 * deletion events. Cloudflare D1 atomic batch / physical backup policy must
 * be proven at the release Gate. No H-Global or Store modifications.
 */
import {createStarryD1Port} from './d1-ports.ts';
import type {D1Database,D1Prepared,D1Result} from './d1-ports.ts';
import {isTrustedPrincipal,planSelfDeletion} from './index.ts';
import type {TrustedScope,TrustedPrincipal} from './index.ts';
type AtomicD1=D1Database&Readonly<{batch:(statements:D1Prepared[])=>Promise<D1Result[]>}>;
const id=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(s);
const epoch=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const ev=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9._:-]{20,180}$/.test(s);
export function createOfflineStarryAccountDeletion(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;db:AtomicD1;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!id(scope.app_id)||
  !['development','staging'].includes(scope.environment))throw Error('DELETE_SCOPE_DENIED');
 const active=deps.enabled===true,read=createStarryD1Port(deps.db,scope);
 return Object.freeze({
  async remove(principal:unknown,challenge:unknown,eventId:string,now:number):Promise<boolean>{
   if(!active||!isTrustedPrincipal(principal)||!ev(eventId)||!epoch(now))return false;
   const p=principal as TrustedPrincipal;
   if(p.brand_id!=='starry'||p.app_id!==scope.app_id||p.environment!==scope.environment||
     now-p.checked_at>60||now<p.checked_at||now>=p.expires_at||!id(p.s_user_id))return false;
   try{
    // Current member authority is re-read, never accepted as client JSON.
    const current=await read.readMember(p.s_user_id);
    if(!current||current.status!=='active'||current.auth_version!==p.auth_version||
     !Number.isSafeInteger(current.profile_revision)||current.profile_revision<1||
     current.profile_revision>=Number.MAX_SAFE_INTEGER)return false;
    // A second verified proof issued by the existing AI-1 backend verifier is mandatory.
    const next=planSelfDeletion(p,scope,current,challenge,now);
    const writes=[
      // Auth-version CAS makes ALL pre-deletion sessions in ALL Starry Apps
      // instantly fail authoritative identity resolution, even if a token survives.
      deps.db.prepare("UPDATE starry_members SET status='deleted',auth_version=?,display_name=NULL,directory_opt_in=0,display_name_public=0,profile_revision=?,updated_at=? WHERE s_user_id=? AND status='active' AND auth_version=? AND profile_revision=?")
       .bind(next.auth_version,next.profile_revision,now,p.s_user_id,current.auth_version,current.profile_revision),
      deps.db.prepare("UPDATE starry_sessions SET revoked_at=? WHERE s_user_id=? AND revoked_at IS NULL "+
       "AND EXISTS(SELECT 1 FROM starry_members WHERE s_user_id=? "+
       "AND status='deleted' AND auth_version=? AND updated_at=?)")
       .bind(now,p.s_user_id,p.s_user_id,next.auth_version,now),
      // Outbox is minimal Starry-only reference, no OAuth sub/email/raw tokens.
      deps.db.prepare("INSERT INTO starry_deletion_outbox(event_id,s_user_id,occurred_at,event_type) SELECT ?,s_user_id,?,'account_deleted' FROM starry_members WHERE s_user_id=? AND status='deleted' AND auth_version=? AND updated_at=? AND NOT EXISTS(SELECT 1 FROM starry_deletion_outbox WHERE s_user_id=?)")
       .bind(eventId,now,p.s_user_id,next.auth_version,now,p.s_user_id),
    ];
    const result=await deps.db.batch(writes);
    // Must be exactly-one member CAS and exactly-one append-only event.
    // No success on retries, even if session revoke touched zero rows.
    return result.length===3&&result.every(r=>r.success!==false)&&
      result[0].meta?.changes===1&&result[2].meta?.changes===1;
   }catch{return false;}
  },
 });
}
