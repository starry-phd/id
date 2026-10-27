/**
 * AI-1 R13 Q88: server-only ONE-SQL-statement Starry account deletion.
 *
 * Uses a server-verified WeakSet second-factor proof with an opaque random
 * challenge_ref persisted in the SAME Auth D1 as member/session/deletion outbox.
 * Schema 011 triggers atomically consume one challenge, CAS-delete member,
 * revoke every Starry app session and append ONE unique deletion event.
 * No real D1 migration/route/Secrets. Default OFF, development/staging only.
 * Legacy R7 deletion remains an offline adapter; production must NOT expose it.
 */
import {isTrustedPrincipal,planSelfDeletion} from './index.ts';
import type {DeletionChallenge,TrustedPrincipal,TrustedScope} from './index.ts';
import {createStarryD1Port} from './d1-ports.ts';
import type {D1Database} from './d1-ports.ts';
export const LIVE_ONE_USE_DELETION_ENABLED=false as const;
const id=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(s);
const ref=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function createOfflineOneUseAccountDeletion(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;db:D1Database;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!id(scope.app_id)||
  !['development','staging'].includes(scope.environment))
  throw Error('ONE_USE_DELETE_SCOPE_DENIED');
 const read=createStarryD1Port(deps.db,scope),enabled=deps.enabled===true;
 return Object.freeze({
  async remove(principal:unknown,challenge:unknown,now:number):Promise<boolean>{
   if(!enabled||!isTrustedPrincipal(principal)||!time(now))return false;
   try {
    const p=principal as TrustedPrincipal;
    if(p.brand_id!=='starry'||p.environment!==scope.environment||
      p.app_id!==scope.app_id||!id(p.s_user_id)||!id(p.session_id)||
      !time(p.checked_at)||!time(p.expires_at)||p.checked_at>now||
      now-p.checked_at>60||p.expires_at<=now)return false;
    // A proof object is ONLY accepted if minted by the existing second-factor
    // verifier. planSelfDeletion checks the original WeakSet and user/session.
    // Do NOT accept client JSON with challenge_ref or verified:true.
    const current=await read.readMember(p.s_user_id);
    if(!current||current.status!=='active'||current.auth_version!==p.auth_version)return false;
    planSelfDeletion(p,scope,current,challenge,now);
    const challengeRef=(challenge as DeletionChallenge).challenge_ref;
    if(!ref(challengeRef))return false;
    // ONE SQL statement is the entire mutation boundary. Triggers in schema
    // 011 re-check the CURRENT member/session state before modifying ANY row.
    // The event_id and TTL are persisted at challenge issuance (server-only).
    // A repeated/refired challenge cannot consume a second time.
    const result=await deps.db.prepare(
      'UPDATE starry_deletion_challenges SET consumed_at=? '+
      'WHERE challenge_ref=? AND s_user_id=? AND session_id=? '+
      'AND auth_version=? AND created_at<=? AND expires_at>? '+
      'AND consumed_at IS NULL'
    ).bind(now,challengeRef,p.s_user_id,p.session_id,p.auth_version,now,now).run();
    return result.success!==false&&result.meta?.changes===1;
   }catch{return false;}
  },
 });
}
