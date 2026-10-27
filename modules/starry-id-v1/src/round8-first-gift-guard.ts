/**
 * AI-1 R8 Q119: OFFLINE-only, privacy-gated candidate for avoiding a second
 * Starry first-registration Battery grant after account deletion/re-enrollment.
 *
 * A keyed pseudonym is STILL personal data in many jurisdictions; encryption
 * or HMAC alone does NOT establish legal basis, retention rights or consent.
 * NEVER enable before the separate AI-0 Privacy Gate and cross-D1 grant policy.
 *
 * This is a READ-ONLY preflight, not an atomic Battery grant/authorization:
 * the final claim uniqueness check + first free Battery ledger write MUST be
 * atomic in an AI-3 owned authority. Do not rely on this read against races.
 */
import {isTrustedPrincipal} from './index.ts';
import type {TrustedPrincipal,TrustedScope,Member,Provider} from './index.ts';
import type {D1Database} from './d1-ports.ts';

const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v);
const safeNow=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export type InitialGiftPreflight='BLOCKED'|'ALREADY_CLAIMED'|'UNCLAIMED_NOT_AUTHORIZED_TO_GRANT';
export type ServerCanonicalSubject=Readonly<{provider:Provider;subject:string;s_user_id:string}>;
export type InitialGiftEvidence=Readonly<{
  purpose:'registration_gift_deduplication'; brand_id:'starry';
  environment:'development'|'staging';s_user_id:string;
  fingerprint:string;checked_at:number;
}>;
const issued=new WeakSet<object>();
export function isInitialGiftEvidence(x:unknown):x is InitialGiftEvidence {
 return !!x&&typeof x==='object'&&issued.has(x);
}
export function createOfflineFirstGiftPreflight(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;db:D1Database;hmacKey:CryptoKey;
 // PRIVACY GATE APPROVAL is server-authoritative, not a client or config flag.
 // Must be re-checked per request, with reviewed purpose, region and retention.
 privacyApprovedNow:()=>Promise<boolean>;
 // Must re-check canonical verified login subject in Starry ID authority.
 readCanonicalSubject:(principal:TrustedPrincipal)=>Promise<ServerCanonicalSubject|null>;
 readCurrentMember:(userId:string)=>Promise<Member|null>;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!validId(scope.app_id)||
   !['development','staging'].includes(scope.environment))
   throw Error('INITIAL_GIFT_SCOPE_DENIED');
 const enabled=deps.enabled===true;
 const key=deps.hmacKey;
 if(!key||key.type!=='secret'||key.extractable||
   key.algorithm.name!=='HMAC'||!key.usages.includes('sign')||
   // enforce 256-bit or longer HMAC-SHA256 secret, server supplied
   (key.algorithm as HmacKeyAlgorithm).hash.name!=='SHA-256'||
   (key.algorithm as HmacKeyAlgorithm).length<256)
   throw Error('INITIAL_GIFT_SECRET_DENIED');
 return Object.freeze({
  async check(principal:unknown,now:number):Promise<Readonly<{
   status:InitialGiftPreflight;evidence?:InitialGiftEvidence;
  }>>{
   const blocked=Object.freeze({status:'BLOCKED' as const});
   if(!enabled||!isTrustedPrincipal(principal)||!safeNow(now))return blocked;
   const p=principal as TrustedPrincipal;
   if(p.brand_id!=='starry'||p.app_id!==scope.app_id||
     p.environment!==scope.environment||p.member_status!=='active'||
     !validId(p.s_user_id)||now<p.checked_at||now-p.checked_at>60||
     now>=p.expires_at)return blocked;
   try{
    // Never read verified sub or hash it when the privacy Gate is not approved.
    if(await deps.privacyApprovedNow()!==true)return blocked;
    const [member,identity]=await Promise.all([
     deps.readCurrentMember(p.s_user_id),deps.readCanonicalSubject(p),
    ]);
    if(!member||member.s_user_id!==p.s_user_id||member.status!=='active'||
      member.auth_version!==p.auth_version||!identity||
      identity.s_user_id!==p.s_user_id||
      !['apple','google'].includes(identity.provider)||!validId(identity.subject))
      return blocked;
    // Purpose + environment isolate the pseudonym; do NOT include app_id,
    // because first-registration gifts are shared ACROSS Starry Apps.
    // Use length delimiters to avoid concatenation collisions.
    const parts=['starry','registration_gift_once','v1',scope.environment,
      identity.provider,identity.subject];
    const material=parts.map(x=>x.length+':'+x).join('|');
    const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(material));
    const fingerprint=Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('');
    if(!/^[a-f0-9]{64}$/.test(fingerprint))return blocked;
    const row=await deps.db.prepare(
      'SELECT 1 AS claimed FROM starry_first_gift_claims WHERE fingerprint=? LIMIT 1'
    ).bind(fingerprint).first<{claimed:number}>();
    if(row===null){
      const evidence=Object.freeze({
        purpose:'registration_gift_deduplication' as const,brand_id:'starry' as const,
        environment:scope.environment as 'development'|'staging',
        s_user_id:p.s_user_id,fingerprint,checked_at:now,
      });
      issued.add(evidence);
      return Object.freeze({
        status:'UNCLAIMED_NOT_AUTHORIZED_TO_GRANT' as const,evidence,
      });
    }
    if(row.claimed===1)return Object.freeze({status:'ALREADY_CLAIMED' as const});
    return blocked;
   }catch{return blocked;}
  },
 });
}
