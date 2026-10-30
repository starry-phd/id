/**
 * Starry-only, server-side Google OIDC JWKS retrieval. SOURCE-ONLY / DEFAULT OFF.
 * This is a narrow acquisition port for the ORIGINAL oidc-crypto verifier:
 * it does not issue Sessions, approve Google OAuth, or register a Worker route.
 *
 * Google documentation pins the Discovery endpoint; the JWKS URI is checked
 * against the trusted Google endpoint so a compromised discovery document
 * cannot turn this code into arbitrary URL fetch/SSRF. Neither a client URL
 * nor an untrusted "jku" token header may select a signing key source.
 */
import type {PinnedOidcProvider} from './oidc-crypto.ts';

export const M1_GOOGLE_JWKS_SOURCE_LIVE=false as const;
export const M1_GOOGLE_DISCOVERY_URL=
 'https://accounts.google.com/.well-known/openid-configuration' as const;
export const M1_GOOGLE_JWKS_URL=
 'https://www.googleapis.com/oauth2/v3/certs' as const;

export type M1GoogleJwksConfig=Readonly<{
 enabled?:boolean;
 clientId:string;
 issuer:'https://accounts.google.com'|'accounts.google.com';
 /** Server-owned transport; never derived from request/query parameters. */
 transport:(url:string,init:RequestInit)=>Promise<Response>;
 /** Trusted server seconds. TTL is bounded; never trust response Date alone. */
 now:()=>number;
}>;

const safeTime=(value:unknown):value is number=>
 typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const safeClient=(value:unknown):value is string=>
 typeof value==='string'&&/^[A-Za-z0-9._:-]{5,180}$/.test(value);
const obj=(value:unknown):value is Record<string,unknown>=>
 value!==null&&typeof value==='object'&&!Array.isArray(value);
const base64url=/^[A-Za-z0-9_-]+$/;

/** No cache-control => NO authority: we cannot claim that fetched keys are fresh. */
function remainingSeconds(response:Response):number|null{
 const raw=response.headers.get('cache-control')??'';
 if(/(?:^|,)\s*(?:no-store|no-cache|private)\b/i.test(raw))return null;
 const matches=[...raw.matchAll(/(?:^|,)\s*max-age=(\d+)\s*(?=,|$)/gi)];
 if(matches.length!==1)return null;
 const maxAge=Number(matches[0][1]);
 const ageRaw=response.headers.get('age');
 if(ageRaw!==null&&!/^\d+$/.test(ageRaw))return null;
 const age=ageRaw===null?0:Number(ageRaw);
 if(!Number.isSafeInteger(maxAge)||!Number.isSafeInteger(age)||
   maxAge<1||maxAge>86400||age>=maxAge)return null;
 // Google controls the original TTL; our local cache cannot extend it.
 return Math.min(maxAge-age,3600);
}
async function boundedJson(response:Response,endpoint:string,max:number):Promise<unknown>{
 if(!response||typeof response!=='object'||response.status!==200||
    response.redirected!==false||
    (response.url!==''&&response.url!==endpoint)||
    !response.headers||typeof response.headers.get!=='function'||
    !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i
      .test(response.headers.get('content-type')??''))return null;
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d{1,8}$/.test(declared)||Number(declared)>max))
   return null;
 if(!response.body||typeof response.body.getReader!=='function')return null;
 const reader=response.body.getReader();
 const chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))return null;
   total+=value.byteLength;
   if(total>max){await reader.cancel();return null;}
   chunks.push(value);
  }
 }catch{return null;}
 finally{reader.releaseLock();}
 const data=new Uint8Array(total);let cursor=0;
 for(const chunk of chunks){data.set(chunk,cursor);cursor+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)) as unknown;}
 catch{return null;}
}
async function validatedKeys(raw:unknown):Promise<PinnedOidcProvider['jwks']|null>{
 if(!obj(raw)||!Array.isArray(raw.keys)||raw.keys.length<1||raw.keys.length>8)return null;
 const verified:Array<JsonWebKey & {kid?:string}>=[];
 const seen=new Set<string>();
 for(const value of raw.keys as unknown[]){
  if(!obj(value)||value.kty!=='RSA'||typeof value.kid!=='string'||
    !/^[A-Za-z0-9._-]{1,128}$/.test(value.kid)||seen.has(value.kid)||
    (value.alg!==undefined&&value.alg!=='RS256')||
    (value.use!==undefined&&value.use!=='sig')||
    (value.key_ops!==undefined&&
      (!Array.isArray(value.key_ops)||value.key_ops.length!==1||
       value.key_ops[0]!=='verify'))||
    typeof value.n!=='string'||!base64url.test(value.n)||
    value.n.length<250||value.n.length>900||
    typeof value.e!=='string'||!base64url.test(value.e)||
    value.e.length<2||value.e.length>12||
    Object.keys(value).some(k=>['d','p','q','dp','dq','qi','oth','k','x','y'].includes(k)))
   return null;
  // Import makes malformed or undersized key material fail closed. Private
  // key fields are never copied. Only the RS256 public verifier survives.
  const key:JsonWebKey & {kid:string}={
   kty:'RSA',kid:value.kid,alg:'RS256',use:'sig',
   n:value.n,e:value.e,key_ops:['verify'],
  };
  try{
   const imported=await crypto.subtle.importKey('jwk',key,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
   if(imported.type!=='public'||imported.algorithm.name!=='RSASSA-PKCS1-v1_5'||
      imported.extractable||!imported.usages.includes('verify'))return null;
   const rsa=imported.algorithm as RsaHashedKeyAlgorithm;
   if(rsa.modulusLength<2048)return null;
  }catch{return null;}
  seen.add(value.kid);
  verified.push(Object.freeze({...key,key_ops:Object.freeze(['verify']) as unknown as KeyUsage[]}));
 }
 return Object.freeze(verified);
}

export function createM1GoogleJwksSource(config:M1GoogleJwksConfig){
 if(!config||!safeClient(config.clientId)||
    !['https://accounts.google.com','accounts.google.com'].includes(config.issuer)||
    typeof config.transport!=='function'||typeof config.now!=='function')
   throw Error('M1_GOOGLE_JWKS_CONFIGURATION_DENIED');
 // Capture authority once. Mutable DI getters cannot redirect a refresh.
 const clientId=config.clientId,issuer=config.issuer;
 const transport=config.transport,now=config.now,enabled=config.enabled===true;
 let cached:Readonly<{provider:PinnedOidcProvider;expiresAt:number}>|null=null;
 let pending:Promise<PinnedOidcProvider|null>|null=null;
 async function fetchFresh():Promise<PinnedOidcProvider|null>{
  try{
   const opts:RequestInit={method:'GET',headers:{accept:'application/json'},
    credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'};
   const discovery=await transport(M1_GOOGLE_DISCOVERY_URL,opts);
   const details=await boundedJson(discovery,M1_GOOGLE_DISCOVERY_URL,16384);
   if(!obj(details)||details.issuer!=='https://accounts.google.com'||
      details.jwks_uri!==M1_GOOGLE_JWKS_URL)return null;
   const keysResponse=await transport(M1_GOOGLE_JWKS_URL,opts);
   const ttl=remainingSeconds(keysResponse);
   if(ttl===null)return null;
   const keys=await validatedKeys(await boundedJson(keysResponse,M1_GOOGLE_JWKS_URL,32768));
   if(!keys)return null;
   const time=now();
   if(!safeTime(time)||time>Number.MAX_SAFE_INTEGER-ttl)return null;
   const provider=Object.freeze({provider:'google' as const,clientId,issuer,jwks:keys});
   cached=Object.freeze({provider,expiresAt:time+ttl});
   return provider;
  }catch{return null;} // Never echo transport failures, keys or upstream internals.
 }
 async function acquire(force:boolean):Promise<PinnedOidcProvider|null>{
  if(!enabled)return null;
  try{
   const time=now();
   if(!safeTime(time))return null;
   if(!force&&cached&&time<cached.expiresAt)return cached.provider;
   if(pending)return pending;
   cached=null; // No stale-while-error acceptance after expiry/refresh.
   const promise=fetchFresh();
   pending=promise;
   try{return await promise;}
   finally{if(pending===promise)pending=null;}
  }catch{return null;}
 }
 return Object.freeze({
  source_only:true as const,live_enabled:M1_GOOGLE_JWKS_SOURCE_LIVE,
  getProvider:()=>acquire(false),
  /** Explicit local invalidation for rotation / previously unknown kid. */
  refresh:()=>acquire(true),
 });
}
