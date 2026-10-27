/**
 * AI-1 R14 (offline only): issue R13 one-use deletion challenge from a CURRENT
 * Starry Auth D1 Session step-up; not from request JSON or cached UI claims.
 * No official Passkey/TOTP ceremony, Worker route, live D1 or paid resources.
 * Requires the Auth DB schema 001+007+011+012, all on ONE database.
 */
import {createDeletionChallengeVerifier,isTrustedPrincipal} from './index.ts';
import type {DeletionChallenge,TrustedPrincipal,TrustedScope,Session} from './index.ts';
import {createStarryD1Port} from './d1-ports.ts';
import type {D1Database} from './d1-ports.ts';

export const LIVE_STARRY_DELETION_CHALLENGE_ISSUANCE=false as const;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const fresh=(s:Session,now:number):boolean=>
 (s.step_up_method==='passkey'||s.step_up_method==='totp')&&
 time(s.step_up_verified_at)&&time(s.step_up_expires_at)&&
 s.step_up_verified_at<=now&&now-s.step_up_verified_at<=300&&
 s.step_up_expires_at>now;
function hexRandom(bytes:number):string {
 const b=new Uint8Array(bytes);
 crypto.getRandomValues(b);
 return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
}
export function createOfflineDeletionChallengeIssuer(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;db:D1Database;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!validId(scope.app_id)||
    !['development','staging'].includes(scope.environment))
   throw Error('DELETE_ISSUER_SCOPE_DENIED');
 const enabled=deps.enabled===true;
 const read=createStarryD1Port(deps.db,scope);
 return Object.freeze({
  /** Returns original AI-1 WeakSet-sealed proof, NOT a bearer token for UI. */
  async issue(principal:unknown,now:number):Promise<DeletionChallenge|null>{
   if(!enabled||!isTrustedPrincipal(principal)||!time(now))return null;
   try{
    const p=principal as TrustedPrincipal;
    if(p.brand_id!=='starry'||p.app_id!==scope.app_id||
       p.environment!==scope.environment||!validId(p.s_user_id)||
       !validId(p.session_id)||!time(p.checked_at)||!time(p.expires_at)||
       p.checked_at>now||now-p.checked_at>60||p.expires_at<=now)return null;
    const [member,session]=await Promise.all([
      read.readMember(p.s_user_id),read.readSession(p.session_id),
    ]);
    if(!member||member.status!=='active'||member.s_user_id!==p.s_user_id||
      member.auth_version!==p.auth_version||!session||
      session.session_id!==p.session_id||session.s_user_id!==p.s_user_id||
      session.app_id!==scope.app_id||session.environment!==scope.environment||
      session.auth_version!==p.auth_version||session.revoked_at!==null||
      !time(session.expires_at)||session.expires_at<=now||!fresh(session,now))
      return null;
    const expires=Math.min(now+120,session.expires_at,session.step_up_expires_at!);
    if(!time(expires)||expires<=now)return null;
    const challenge_ref=hexRandom(32); // 256 bits, server-only
    const eventId='starry-delete-'+hexRandom(32);
    // Single INSERT...SELECT + R14 triggers: re-check the ACTUAL current
    // member/session/step-up and prevent concurrently issued active proofs.
    const inserted=await deps.db.prepare(
      'INSERT INTO starry_deletion_challenges '+
      '(challenge_ref,s_user_id,session_id,auth_version,event_id,created_at,expires_at,consumed_at) '+
      'SELECT ?,m.s_user_id,s.session_id,m.auth_version,?,?,?,NULL '+
      'FROM starry_members m JOIN starry_sessions s ON s.s_user_id=m.s_user_id '+
      'WHERE m.s_user_id=? AND m.status=\'active\' AND m.auth_version=? '+
      'AND s.session_id=? AND s.app_id=? AND s.environment=? '+
      'AND s.auth_version=m.auth_version AND s.revoked_at IS NULL '+
      'AND s.expires_at>? AND s.step_up_method IN (\'passkey\',\'totp\') '+
      'AND s.step_up_verified_at BETWEEN ? AND ? AND s.step_up_expires_at>?'
    ).bind(challenge_ref,eventId,now,expires,p.s_user_id,p.auth_version,
      p.session_id,scope.app_id,scope.environment,now,Math.max(0,now-300),now,now).run();
    if(inserted.success===false||inserted.meta?.changes!==1)return null;
    // WeakSet proof is produced only AFTER persisted one-row INSERT success.
    // R13 consumption again checks original WeakSet and single-use DB row.
    const minted=createDeletionChallengeVerifier(async()=>({
      s_user_id:p.s_user_id,session_id:p.session_id,expires_at:expires,
      challenge_ref,
    }));
    return await minted(null);
   }catch{return null;}
  },
 });
}
