/**
 * Starry M1 staging-only Worker Secret -> NON-EXTRACTABLE WebCrypto keyring.
 *
 * NO hard-coded or public client keys, storage, live Worker route or deploy.
 * Owner provisions versioned secret values via approved Worker secret custody.
 * Session HMAC and sealed PKCE AES-GCM use DISTINCT 256-bit keys and KIDs.
 * The previous signing key is VERIFY-only; previous AES key is DECRYPT-only.
 * Raw decoded bytes are zeroed after WebCrypto import. No secret values/logs.
 */
import {createM1OAuthVerifierCustody} from
 '../../../modules/starry-id-v1/src/m1-oauth-verifier-custody.ts';
import type {SessionSigningKey} from
 '../../../modules/starry-id-v1/src/session-crypto.ts';

export const M1_STAGING_WORKER_KEYRING_LIVE=false as const;
type Pair=Readonly<{kid:string;secretB64url:string}>;
export type M1StagingWorkerKeyMaterial=Readonly<{
 sessionActive:Pair;
 pkceActive:Pair;
 /** Optional previous key is verify-only; never used to issue new sessions. */
 sessionPrevious?:Pair;
 /** Optional previous key is decrypt-only; never used to seal new verifiers. */
 pkcePrevious?:Pair;
}>;
export type M1StagingWorkerKeyringConfig=Readonly<{
 enabled?:boolean;
 appId:'starry-id';
 environment:'staging';
 /** Server-only imported from Cloudflare secrets; never HTTP or public Expo env. */
 material?:M1StagingWorkerKeyMaterial;
}>;
const safeKid=(value:unknown):value is string=>
 typeof value==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(value);
const b64url=/^[A-Za-z0-9_-]{43}$/;
function secretBytes(raw:unknown):Uint8Array{
 if(typeof raw!=='string'||!b64url.test(raw))throw Error('M1_KEYRING_MATERIAL_DENIED');
 const decoded=atob(raw.replace(/-/g,'+').replace(/_/g,'/')+'=');
 if(decoded.length!==32)throw Error('M1_KEYRING_MATERIAL_DENIED');
 const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
 let canonical='';
 for(const n of bytes)canonical+=String.fromCharCode(n);
 if(btoa(canonical).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')!==raw)
  throw Error('M1_KEYRING_MATERIAL_DENIED');
 return bytes;
}
function validPair(v:unknown):v is Pair{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const data=v as Record<string,unknown>;
 return safeKid(data.kid)&&typeof data.secretB64url==='string'&&
  b64url.test(data.secretB64url);
}
async function imported(pair:Pair,purpose:'session'|'pkce',previous:boolean):
 Promise<CryptoKey>{
 const bytes=secretBytes(pair.secretB64url);
 const array=new ArrayBuffer(bytes.byteLength);
 new Uint8Array(array).set(bytes);
 bytes.fill(0);
 try{
  const isSession=purpose==='session';
  const usages:KeyUsage[]=isSession?
   (previous?['verify']:['sign','verify']):
   (previous?['decrypt']:['encrypt','decrypt']);
  const key=await crypto.subtle.importKey('raw',array,isSession?
   {name:'HMAC',hash:'SHA-256'}:{name:'AES-GCM'},false,usages);
  if(key.extractable||key.type!=='secret'||key.algorithm.name!==
    (isSession?'HMAC':'AES-GCM')||!usages.every(u=>key.usages.includes(u)))
   throw Error('M1_KEYRING_IMPORT_DENIED');
  return key;
 }catch{throw Error('M1_KEYRING_IMPORT_DENIED');}
 finally{new Uint8Array(array).fill(0);}
}
const disabled=()=>{
 const verifierCustody=createM1OAuthVerifierCustody({
  activeKey:async()=>null,findKey:async()=>null,
 });
 return Object.freeze({
  contract:'starry.ai0.m1.staging-worker-secret-keyring.v1' as const,
  source_only:true as const,live_enabled:M1_STAGING_WORKER_KEYRING_LIVE,
  keyring_enabled:false as boolean,
  activeKey:async():Promise<SessionSigningKey>=>{
   throw Error('M1_KEYRING_DISABLED');
  },
  getVerificationKey:async(_kid:string):Promise<CryptoKey|null>=>null,
  verifierCustody,
 });
};
/** Import keys exactly once during Worker composition, not per HTTP request. */
export async function createM1StagingWorkerSecretKeyring(
 config:M1StagingWorkerKeyringConfig,
){
 if(!config||config.appId!=='starry-id'||config.environment!=='staging'||
  (config.enabled!==undefined&&typeof config.enabled!=='boolean'))
  throw Error('M1_KEYRING_CONFIGURATION_DENIED');
 if(config.enabled!==true)return disabled();
 const raw=config.material;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  !validPair(raw.sessionActive)||!validPair(raw.pkceActive)||
  (raw.sessionPrevious!==undefined&&!validPair(raw.sessionPrevious))||
  (raw.pkcePrevious!==undefined&&!validPair(raw.pkcePrevious)))
  throw Error('M1_KEYRING_CONFIGURATION_DENIED');
 const all=[raw.sessionActive,raw.pkceActive,
  ...(raw.sessionPrevious?[raw.sessionPrevious]:[]),
  ...(raw.pkcePrevious?[raw.pkcePrevious]:[])];
 const kids=all.map(x=>x.kid);
 const secrets=all.map(x=>x.secretB64url);
 if(new Set(kids).size!==kids.length||
  new Set(secrets).size!==secrets.length)
  throw Error('M1_KEYRING_CONFIGURATION_DENIED');
 // Snapshot the owner-controlled raw primitives synchronously BEFORE import.
 // Caller mutations after await cannot swap any active/previous keys.
 const snap=all.map(x=>Object.freeze({kid:x.kid,secretB64url:x.secretB64url}));
 let index=0;
 const sa=snap[index++],pa=snap[index++];
 const sp=raw.sessionPrevious?snap[index++]:null;
 const pp=raw.pkcePrevious?snap[index++]:null;
 const sessionKey=await imported(sa,'session',false);
 const pkceKey=await imported(pa,'pkce',false);
 const previousSession=sp?await imported(sp,'session',true):null;
 const previousPkce=pp?await imported(pp,'pkce',true):null;
 const sessions=new Map<string,CryptoKey>([[sa.kid,sessionKey]]);
 if(sp&&previousSession)sessions.set(sp.kid,previousSession);
 const verifiers=new Map<string,CryptoKey>([[pa.kid,pkceKey]]);
 if(pp&&previousPkce)verifiers.set(pp.kid,previousPkce);
 const active=Object.freeze({kid:sa.kid,key:sessionKey});
 const verifierCustody=createM1OAuthVerifierCustody({
  activeKey:async()=>Object.freeze({kid:pa.kid,key:pkceKey}),
  findKey:async kid=>verifiers.get(kid)??null,
 });
 return Object.freeze({
  contract:'starry.ai0.m1.staging-worker-secret-keyring.v1' as const,
  source_only:true as const,live_enabled:M1_STAGING_WORKER_KEYRING_LIVE,
  keyring_enabled:true as boolean,
  activeKey:async():Promise<SessionSigningKey>=>active,
  getVerificationKey:async(kid:string):Promise<CryptoKey|null>=>
   sessions.get(kid)??null,
  verifierCustody,
 });
}
