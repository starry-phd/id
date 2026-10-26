/**
 * TEST SUPPORT ONLY. Ephemeral signed-session fixture, not Apple/Google OIDC/JWKS,
 * refresh-token rotation, persistent session storage, or a deployable verifier.
 * Never import this module from apps/api/src/index.ts or production Workers.
 */
import type {VerifiedAuthEvidence} from '../../../modules/starry-id-v1/src/index.ts';

const encode = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const decode = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_TOKEN');
  const b64=value.replace(/-/g,'+').replace(/_/g,'/');
  const binary=atob(b64+'='.repeat((4-b64.length%4)%4));
  return Uint8Array.from(binary, c=>c.charCodeAt(0));
};
/** Generate an in-memory nonextractable key in tests only; no checked-in secrets. */
export async function createEphemeralTestKey():Promise<CryptoKey>{
  return crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign','verify']) as Promise<CryptoKey>;
}
export async function signTestSession(key: CryptoKey, evidence: VerifiedAuthEvidence): Promise<string> {
  const body=encode(new TextEncoder().encode(JSON.stringify(evidence)));
  const signed='v1.'+body;
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(signed)));
  return signed+'.'+encode(signature);
}
/** Accepted evidence comes ONLY from a cryptographically verified signed token. */
export function createTestHmacVerifier(key: CryptoKey) {
  return async (request: unknown):Promise<VerifiedAuthEvidence|null>=>{
    if (!(request instanceof Request)) return null;
    const header=request.headers.get('authorization')??'';
    const m=/^Bearer (v1\.[A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header);
    if (!m) return null;
    try {
      const ok=await crypto.subtle.verify('HMAC',key,decode(m[2]),new TextEncoder().encode(m[1]));
      if (!ok) return null;
      const parsed:unknown=JSON.parse(new TextDecoder().decode(decode(m[1].slice(3))));
      if (!parsed || typeof parsed!=='object'||Array.isArray(parsed)
        || Object.getPrototypeOf(parsed)!==Object.prototype) return null;
      const v=parsed as Record<string,unknown>;
      const fields=['brand_id','app_id','environment','provider','provider_subject',
        's_user_id','session_id','auth_version','expires_at'];
      if (Object.keys(v).length!==fields.length||Object.keys(v).some(x=>!fields.includes(x))) return null;
      if (typeof v.provider_subject!=='string'||typeof v.s_user_id!=='string'
        ||typeof v.session_id!=='string'||!Number.isSafeInteger(v.auth_version)
        ||!Number.isSafeInteger(v.expires_at)) return null;
      return v as unknown as VerifiedAuthEvidence;
    }catch{return null;}
  };
}
