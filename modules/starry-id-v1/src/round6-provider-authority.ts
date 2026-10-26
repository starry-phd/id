/**
 * AI-1 Round6: server-only OFFLINE Apple/Google authorization endpoint and JWKS
 * transport evidence policy. THIS MODULE NEVER fetches or redirects.
 * "TrustedJwksHttpAdapter" MUST be implemented by AI-4 from backend-only
 * configuration after a separately approved provider/TLS/Secrets release Gate.
 */
import type {TrustedScope} from './index.ts';
import type {OidcProvider,PinnedOidcProvider} from './oidc-crypto.ts';
import {createTrustedProviderJwksCache} from './jwks-cache.ts';

export type PinnedOfficialEndpoints=Readonly<{
  provider:OidcProvider;issuer:PinnedOidcProvider['issuer'];
  authorizeUrl:string;tokenUrl:string;jwksUrl:string;
}>;
const APPLE:PinnedOfficialEndpoints=Object.freeze({
  provider:'apple',issuer:'https://appleid.apple.com',
  authorizeUrl:'https://appleid.apple.com/auth/authorize',
  tokenUrl:'https://appleid.apple.com/auth/token',
  jwksUrl:'https://appleid.apple.com/auth/keys',
});
const GOOGLE:PinnedOfficialEndpoints=Object.freeze({
  provider:'google',issuer:'https://accounts.google.com',
  authorizeUrl:'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl:'https://oauth2.googleapis.com/token',
  jwksUrl:'https://www.googleapis.com/oauth2/v3/certs',
});
const ENDPOINTS:Readonly<Record<OidcProvider,PinnedOfficialEndpoints>>=Object.freeze({
  apple:APPLE,google:GOOGLE,
});
export type ServerProviderOptions=Readonly<{
  provider:OidcProvider;clientId:string;redirectUri:string;
}>;
export type TrustedHttpEvidence=Readonly<{
  requestedUrl:string;finalUrl:string;status:number;redirectCount:number;
  contentType:string;byteLength:number;durationMs:number;
  body:unknown;maxAgeSeconds:number;
}>;
export type TrustedJwksHttpAdapter=(fixedUrl:string)=>Promise<TrustedHttpEvidence>;
const ident=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v);
function canonicalHttpsUrl(s:unknown):s is string {
 if(typeof s!=='string'||s.length>500||/[\s#?]/.test(s)||!s.startsWith('https://'))return false;
 try{
  const u=new URL(s);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port
    &&u.origin+u.pathname===s &&u.pathname.startsWith('/')&&!u.pathname.includes('//')
    &&!u.hostname.endsWith('.')&&u.hostname.includes('.');
 }catch{return false;}
}
function validContentType(type:unknown):boolean {
 return typeof type==='string'&&/^application\/json(?:\s*;\s*charset=(?:utf-8|UTF-8))?$/.test(type);
}
function validFetchProof(raw:unknown,expectedUrl:string):raw is TrustedHttpEvidence {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 return x.requestedUrl===expectedUrl&&x.finalUrl===expectedUrl&&x.status===200&&
  x.redirectCount===0&&validContentType(x.contentType)&&
  typeof x.byteLength==='number'&&Number.isSafeInteger(x.byteLength)&&x.byteLength>0&&x.byteLength<=65536&&
  typeof x.durationMs==='number'&&Number.isSafeInteger(x.durationMs)&&x.durationMs>=0&&x.durationMs<=5000&&
  typeof x.maxAgeSeconds==='number'&&Number.isSafeInteger(x.maxAgeSeconds)&&x.maxAgeSeconds>=0&&
  x.body!==null&&typeof x.body==='object'&&!Array.isArray(x.body);
}
/**
 * Runtime gate cannot be toggled via an HTTP input. Options and origins are
 * loaded from a trusted Worker/server registry, never from incoming JSON.
 */
export function createOfflineOfficialProviderAuthority(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;callbackOrigins:ReadonlyArray<string>;
 providers:ReadonlyArray<ServerProviderOptions>;trustedHttp:TrustedJwksHttpAdapter;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!ident(scope.app_id)||
   !['development','staging'].includes(scope.environment))throw Error('PROVIDER_SCOPE_DENIED');
 if(!Array.isArray(deps.callbackOrigins)||deps.callbackOrigins.length<1||
   deps.callbackOrigins.length>5||!deps.callbackOrigins.every(x=>canonicalHttpsUrl(x)&&new URL(x).pathname==='/'))
   throw Error('CALLBACK_ORIGINS_DENIED');
 const origins=new Set(deps.callbackOrigins);
 const entries=new Map<OidcProvider,Readonly<ServerProviderOptions>>();
 for(const item of deps.providers){
  if(!ENDPOINTS[item.provider]||!ident(item.clientId)||!canonicalHttpsUrl(item.redirectUri)||
    !origins.has(new URL(item.redirectUri).origin+'/')||entries.has(item.provider))
   throw Error('PROVIDER_CONFIG_DENIED');
  entries.set(item.provider,Object.freeze({...item}));
 }
 if(entries.size===0)throw Error('PROVIDER_CONFIG_DENIED');
 const enabled=deps.enabled===true;
 const cache=createTrustedProviderJwksCache(
   [...entries.values()].map(v=>({
    provider:v.provider,issuer:ENDPOINTS[v.provider].issuer,clientId:v.clientId,
   })),
   async url=>{
    // Only the official fixed JWKS URL can reach the trusted adapter.
    const expected=Object.values(ENDPOINTS).some(e=>e.jwksUrl===url);
    if(!enabled||!expected)throw Error('PROVIDER_GATE_DISABLED');
    const r=await deps.trustedHttp(url);
    // This validates SERVER-returned evidence, not a client-provided boolean.
    // HTTP adapter itself MUST guarantee TLS, no redirects and bounded reads.
    if(!validFetchProof(r,url))throw Error('JWKS_TRANSPORT_EVIDENCE_DENIED');
    return {status:200,body:r.body,maxAgeSeconds:r.maxAgeSeconds};
   },
 );
 return Object.freeze({
  /** Pure metadata for server integration testing. Does not start login. */
  authorizedEndpoints(provider:OidcProvider):Readonly<PinnedOfficialEndpoints&{
    clientId:string;redirectUri:string;
  }>|null{
   if(!enabled||!entries.has(provider))return null;
   return Object.freeze({...ENDPOINTS[provider],...entries.get(provider)!});
  },
  /** Pinned key set still requires WebCrypto JWT signature/issuer/aud/nonce. */
  async pinnedJwks(provider:OidcProvider,kid:string,now:number){
   if(!enabled||!entries.has(provider))return null;
   return cache.keysFor(provider,kid,now);
  },
 });
}
