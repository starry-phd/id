/** AI-1 Round4: offline-executable, fail-closed trusted JWKS retrieval/cache.
 * Transport is injected by the Worker owner. This file DOES NOT make requests.
 * Production transport must enforce HTTPS TLS, timeouts, no redirects, bounded body,
 * and pinned DNS/host. Never accept an HTTP-supplied URL or provider registry.
 */
import type {OidcProvider,PinnedOidcProvider} from './oidc-crypto.ts';

export type JsonResponse = Readonly<{status:number;body:unknown;maxAgeSeconds:number}>;
export type TrustedJwksTransport = (url:string)=>Promise<JsonResponse>;
export type ProviderRegistry = Readonly<{
  provider:OidcProvider;clientId:string;issuer:PinnedOidcProvider['issuer'];
}>;
const endpoint=Object.freeze({
  apple:'https://appleid.apple.com/auth/keys',
  google:'https://www.googleapis.com/oauth2/v3/certs',
});
const pattern=/^[A-Za-z0-9._:-]{1,180}$/;
function validRegistry(c:ProviderRegistry):boolean {
  return (c.provider==='apple'&&c.issuer==='https://appleid.apple.com'||
          c.provider==='google'&&c.issuer==='https://accounts.google.com')
    &&pattern.test(c.clientId);
}
function validJwk(v:unknown):v is JsonWebKey&{kid:string} {
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const j=v as Record<string,unknown>;
 // RSA 2048+ modulus, conventional exponent 65537; reject private key material.
 return j.kty==='RSA' && typeof j.kid==='string'&&pattern.test(j.kid)&&
    typeof j.n==='string' && /^[A-Za-z0-9_-]{342,1024}$/.test(j.n) &&
    j.e==='AQAB' && (j.alg===undefined||j.alg==='RS256') &&
    (j.use===undefined||j.use==='sig') &&
    (j.key_ops===undefined||(Array.isArray(j.key_ops)&&j.key_ops.length===1&&j.key_ops[0]==='verify')) &&
    !['d','p','q','dp','dq','qi','oth','k','x5u','jku'].some(k=>Object.hasOwn(j,k));
}
export function createTrustedProviderJwksCache(
  providerConfig:ReadonlyArray<ProviderRegistry>,transport:TrustedJwksTransport,
) {
 const registry=new Map<OidcProvider,ProviderRegistry>();
 for(const c of providerConfig){
   if(!validRegistry(c)||registry.has(c.provider))throw Error('JWKS_REGISTRY_DENIED');
   registry.set(c.provider,Object.freeze({...c}));
 }
 if(registry.size===0)throw Error('JWKS_REGISTRY_DENIED');
 const cache=new Map<OidcProvider,{expiresAt:number;lastFetch:number;keys:ReadonlyArray<JsonWebKey&{kid:string}>}>();
 const inflight=new Map<OidcProvider,Promise<boolean>>();
 async function refresh(provider:OidcProvider,now:number):Promise<boolean>{
   if(inflight.has(provider))return inflight.get(provider)!;
   const task=(async()=>{
     const current=cache.get(provider);
     // Unknown-kid flooding must not become uncontrolled provider requests.
     if(current&&now-current.lastFetch<30)return false;
     // Mark attempted fetch BEFORE awaiting transport; deny fail-open stale keys.
     cache.set(provider,{expiresAt:0,lastFetch:now,keys:[]});
     try{
       const response=await transport(endpoint[provider]);
       if(response.status!==200||!Number.isSafeInteger(response.maxAgeSeconds))return false;
       const raw=response.body;
       if(!raw||typeof raw!=='object'||Array.isArray(raw)||
         Object.keys(raw).join('|')!=='keys')return false;
       const arr=(raw as {keys?:unknown}).keys;
       if(!Array.isArray(arr)||arr.length<1||arr.length>12||!arr.every(validJwk))return false;
       const seen=new Set<string>();
       for(const k of arr){
         if(seen.has(k.kid))return false;
         seen.add(k.kid);
       }
       const ttl=Math.min(3600,Math.max(60,response.maxAgeSeconds));
       cache.set(provider,{expiresAt:now+ttl,lastFetch:now,
         keys:Object.freeze(arr.map(k=>Object.freeze({...k})))});
       return true;
     }catch{return false;}
   })();
   inflight.set(provider,task);
   try{return await task;}finally{inflight.delete(provider);}
 }
 return Object.freeze({
  /** Only a trusted key set, not successful login; verify token RS256 yourself. */
  async keysFor(provider:OidcProvider,kid:string,now:number):Promise<PinnedOidcProvider|null>{
    const c=registry.get(provider);
    if(!c||!pattern.test(kid)||!Number.isSafeInteger(now)||now<0)return null;
    let snapshot=cache.get(provider);
    if(!snapshot||snapshot.expiresAt<=now||!snapshot.keys.some(k=>k.kid===kid)){
      await refresh(provider,now);
      snapshot=cache.get(provider);
    }
    if(!snapshot||snapshot.expiresAt<=now||!snapshot.keys.some(k=>k.kid===kid))return null;
    return Object.freeze({...c,jwks:snapshot.keys});
  },
 });
}
