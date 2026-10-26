/** AI-1 Round 3: signed Starry-only short-lived Session bearer.
 * Actual HMAC WebCrypto with injected NON-EXTRACTABLE server key; testing uses ephemeral key.
 * AI-4 must load key from managed Worker secret and rotate kid, never hardcode.
 * Signature is necessary but insufficient: after verification ALWAYS load current D1
 * Session + member + stable provider association using createServerIdentityResolver.
 */
import type { VerifiedAuthEvidence,TrustedScope,Provider } from './index.ts';
import {bytesToBase64url} from './oidc-crypto.ts';
export type SessionClaims = VerifiedAuthEvidence & Readonly<{
  key_id:string; issued_at:number;
}>;
export type SessionSigningKey = Readonly<{kid:string;key:CryptoKey}>;
const decoder=new TextDecoder('utf-8',{fatal:true});
function decodeUrl(s:string):Uint8Array {
  if(!/^[A-Za-z0-9_-]+$/.test(s)||s.length>4000||s.length%4===1)throw Error('BAD_TOKEN');
  const bytes=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
  if(bytesToBase64url(bytes)!==s)throw Error('BAD_TOKEN');
  return bytes;
}
function validId(s:unknown):s is string{return typeof s==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(s);}
function validClaims(c:SessionClaims,scope:TrustedScope,now:number):boolean {
  return c.brand_id==='starry' && scope.brand_id==='starry'
    &&c.app_id===scope.app_id&&c.environment===scope.environment
    &&validId(c.s_user_id)&&validId(c.session_id)&&validId(c.provider_subject)
    &&(c.provider==='apple'||c.provider==='google')&&validId(c.key_id)
    &&Number.isSafeInteger(c.auth_version)&&c.auth_version>=1
    &&Number.isSafeInteger(c.issued_at)&&Number.isSafeInteger(c.expires_at)
    &&c.issued_at<=now+30 && c.issued_at>=now-900
    &&c.expires_at>now &&c.expires_at>c.issued_at&&c.expires_at-c.issued_at<=900;
}
export async function signServerSession(claims:SessionClaims,scope:TrustedScope,now:number,key:SessionSigningKey):Promise<string> {
  if(!validId(key.kid)||claims.key_id!==key.kid||!validClaims(claims,scope,now)||
    key.key.algorithm.name!=='HMAC'|| !key.key.usages.includes('sign'))throw Error('SESSION_SIGN_DENIED');
  const payload=bytesToBase64url(new TextEncoder().encode(JSON.stringify(claims)));
  const content='v1.'+payload;
  const digest=await crypto.subtle.sign('HMAC',key.key,new TextEncoder().encode(content));
  return content+'.'+bytesToBase64url(new Uint8Array(digest));
}
export function createVerifiedSignedSession(deps:Readonly<{
  scope:TrustedScope;getKey:(kid:string)=>Promise<CryptoKey|null>;
}>) {
  const scope=Object.freeze({...deps.scope});
  return async (opaque:unknown,now:number):Promise<VerifiedAuthEvidence|null>=>{
    if(typeof opaque!=='string'||opaque.length>8192||!Number.isSafeInteger(now)||now<0)return null;
    try{
      const parts=opaque.split('.');
      if(parts.length!==3||parts[0]!=='v1')return null;
      const data=JSON.parse(decoder.decode(decodeUrl(parts[1]))) as SessionClaims;
      if(!data||typeof data!=='object'||Array.isArray(data)||!validClaims(data,scope,now))return null;
      const key=await deps.getKey(data.key_id);
      if(!key||key.algorithm.name!=='HMAC'||!key.usages.includes('verify'))return null;
      const ok=await crypto.subtle.verify('HMAC',key,decodeUrl(parts[2]),
        new TextEncoder().encode(parts[0]+'.'+parts[1]));
      if(!ok)return null;
      // Client payload is never a trusted principal! AI-1 resolver verifies
      // current authoritative session/version/status/provider identity after this.
      return Object.freeze({
        brand_id:'starry' as const,app_id:data.app_id,environment:data.environment,
        s_user_id:data.s_user_id,session_id:data.session_id,
        provider:data.provider as Provider,provider_subject:data.provider_subject,
        auth_version:data.auth_version,expires_at:data.expires_at,
      });
    }catch{return null;}
  };
}
