/** AI-1 Round 3: real WebCrypto RS256 OIDC ID-token signature verification.
 * Verifies caller-pinned Apple/Google JWKS; NO live provider fetch/code exchange here.
 * Server-only authorization-code exchange and one-time OAuth state are mandatory.
 */
export type OidcProvider = 'apple'|'google';
export type PinnedOidcProvider = Readonly<{
  provider:OidcProvider;
  clientId:string;
  issuer:'https://appleid.apple.com'|'https://accounts.google.com'|'accounts.google.com';
  jwks:ReadonlyArray<JsonWebKey & {kid?:string}>;
}>;
export type OAuthAttempt = Readonly<{
  state:string; codeVerifier:string; codeChallenge:string; nonce:string;
  provider:OidcProvider; clientId:string; appId:string;
  environment:'development'|'staging'|'production'; expiresAt:number; consumedAt:number|null;
}>;
export type VerifiedProviderSubject = Readonly<{
  provider:OidcProvider; providerSubject:string; issuer:string; audience:string;
}>;
const decoder = new TextDecoder('utf-8',{fatal:true});
function base64urlToBytes(input:string):Uint8Array {
  if(!/^[A-Za-z0-9_-]+$/.test(input) || input.length>12000 || input.length%4===1)
    throw Error('BAD_BASE64URL');
  const value=atob(input.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-input.length%4)%4));
  const bytes=Uint8Array.from(value,c=>c.charCodeAt(0));
  if(bytesToBase64url(bytes)!==input)throw Error('NON_CANONICAL_BASE64URL');
  return bytes;
}
export function bytesToBase64url(data:Uint8Array):string {
  let s='';for(const b of data)s+=String.fromCharCode(b);
  return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function parseObject<T>(raw:string):T {
  const obj:unknown=JSON.parse(raw);
  if(!obj || typeof obj!=='object' || Array.isArray(obj))throw Error('NOT_OBJECT');
  return obj as T;
}
function equalString(a:string,b:string):boolean {
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
export async function verifyPkceS256(codeVerifier:string,codeChallenge:string):Promise<boolean> {
  if(typeof codeVerifier!=='string'|| !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) ||
    typeof codeChallenge!=='string'|| !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))return false;
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(codeVerifier));
  return equalString(bytesToBase64url(new Uint8Array(hash)),codeChallenge);
}
export async function verifySignedOidcIdToken(token:unknown,expected:Readonly<{
  issuer:PinnedOidcProvider; nonce:string; now:number;
}>):Promise<VerifiedProviderSubject|null> {
  try{
    const {issuer,nonce,now}=expected;
    if(typeof token!=='string'||token.length>16000 ||!Number.isSafeInteger(now) ||
      typeof nonce!=='string'||nonce.length<16||nonce.length>256)return null;
    if(issuer.provider==='apple' && issuer.issuer!=='https://appleid.apple.com')return null;
    if(issuer.provider==='google' && !['https://accounts.google.com','accounts.google.com'].includes(issuer.issuer))return null;
    if(!/^[A-Za-z0-9._:-]{1,180}$/.test(issuer.clientId))return null;
    const parts=token.split('.');if(parts.length!==3)return null;
    const header=parseObject<Record<string,unknown>>(decoder.decode(base64urlToBytes(parts[0])));
    // Never follow attacker-controlled jku/x5u/jwk or accept alg=none/HS256.
    if(Object.keys(header).some(k=>!['alg','kid','typ'].includes(k))||
      header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>128||
      (header.typ!==undefined&&header.typ!=='JWT'))return null;
    const matches=issuer.jwks.filter(j=>j.kid===header.kid && j.kty==='RSA' &&
      (j.alg===undefined||j.alg==='RS256')&&(j.use===undefined||j.use==='sig') &&
      (!j.key_ops||j.key_ops.includes('verify')) && typeof j.n==='string'&&typeof j.e==='string');
    if(matches.length!==1)return null;
    const key=await crypto.subtle.importKey('jwk',matches[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const data=new TextEncoder().encode(parts[0]+'.'+parts[1]);
    // Copy decoded signature into a genuine ArrayBuffer for WebCrypto/TS 5.9.
    const decodedSignature=base64urlToBytes(parts[2]);
    const signatureBuffer=new ArrayBuffer(decodedSignature.byteLength);
    new Uint8Array(signatureBuffer).set(decodedSignature);
    const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signatureBuffer,data);
    if(!ok)return null;
    const claims=parseObject<Record<string,unknown>>(decoder.decode(base64urlToBytes(parts[1])));
    if(claims.iss!==issuer.issuer || typeof claims.sub!=='string'||claims.sub.length<1||claims.sub.length>256||
      claims.nonce!==nonce || !Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat) ||
      (claims.exp as number)<=now || (claims.iat as number)>now+60 ||
      (claims.iat as number)<now-600 || (claims.exp as number)>(claims.iat as number)+3600 ||
      (claims.nbf!==undefined && (!Number.isSafeInteger(claims.nbf)||(claims.nbf as number)>now+60)))return null;
    const aud=claims.aud;
    if(typeof aud==='string'){if(aud!==issuer.clientId)return null;}
    else if(Array.isArray(aud)&&aud.length>0&&aud.every(x=>typeof x==='string')){
      if(!aud.includes(issuer.clientId)||claims.azp!==issuer.clientId)return null;
    }else return null;
    if(claims.azp!==undefined && claims.azp!==issuer.clientId)return null;
    return Object.freeze({provider:issuer.provider,providerSubject:claims.sub,issuer:issuer.issuer,audience:issuer.clientId});
  }catch{return null;}
}
/** Exchange and state storage are trusted BACKEND ports, never forged HTTP callbacks. */
export type TrustedOAuthBackend = Readonly<{
  readAttempt:(state:string)=>Promise<OAuthAttempt|null>;
  consumeAttemptCAS:(state:string,provider:OidcProvider,now:number)=>Promise<boolean>;
  exchangeCode:(params:Readonly<{provider:OidcProvider;code:string;clientId:string;verifier:string}>)=>Promise<{idToken:string}|null>;
}>;
/**
 * Input is untrusted runtime data, not necessarily a plain JSON object.
 * Reading data descriptors does not execute JS getters which might change
 * the OAuth code/state between validation, D1 CAS and provider exchange.
 */
function ownFieldSnapshot<T extends string>(
  source:unknown,fields:readonly T[],exact=false,
):Record<T,unknown>|null{
  try{
    if(!source||typeof source!=='object'||Array.isArray(source))return null;
    const descriptors=Object.getOwnPropertyDescriptors(source);
    // Only one ownKeys reflection, including for Proxies. Do not trigger a
    // second caller-controlled trap via Object.keys() after snapshotting.
    if(exact){
      const actual=Reflect.ownKeys(descriptors);
      if(actual.length!==fields.length||actual.some(
        key=>typeof key!=='string'||!fields.includes(key as T),
      ))return null;
    }
    const values={} as Record<T,unknown>;
    for(const key of fields){
      const descriptor=descriptors[key];
      if(!descriptor||!Object.hasOwn(descriptor,'value'))return null;
      values[key]=descriptor.value;
    }
    return values;
  }catch{return null;}
}
export function createVerifiedOidcCallback(deps:Readonly<{
  config:PinnedOidcProvider; appId:string; environment:OAuthAttempt['environment']; backend:TrustedOAuthBackend;
  /** Server-owned JWKS; fetch only after durable OAuth state + PKCE checks. */
  getVerificationProvider?:()=>Promise<PinnedOidcProvider|null>;
  /** Read the SAME trusted server clock after awaited JWKS/DB/token calls.
   * A fixed timestamp captured at callback entry cannot validate a later
   * Google token or authorize consumption of an expired OAuth attempt. */
  getTrustedNow?:()=>number;
}>) {
  // Capture the caller's pinned provider, JWKS and trusted backend functions
  // ONCE at construction; no await may shift an authorized issuer or CAS port.
  const provider=deps.config;
  const config={
    provider:provider.provider,
    clientId:provider.clientId,
    issuer:provider.issuer,
    jwks:(Array.isArray(provider.jwks)?provider.jwks:[]).map(
      jwk=>({...jwk,key_ops:jwk.key_ops?[...jwk.key_ops]:undefined}),
    ),
  } as PinnedOidcProvider;
  const appId=deps.appId,environment=deps.environment;
  const backend=deps.backend;
  const getVerificationProvider=deps.getVerificationProvider;
  const getTrustedNow=deps.getTrustedNow;
  if(getTrustedNow!==undefined&&typeof getTrustedNow!=='function')
    throw Error('OIDC_CALLBACK_CONFIGURATION_DENIED');
  if(getVerificationProvider!==undefined&&
    (typeof getVerificationProvider!=='function'||config.provider!=='google'))
    throw Error('OIDC_CALLBACK_CONFIGURATION_DENIED');
  if(!backend||typeof backend.readAttempt!=='function'||
    typeof backend.consumeAttemptCAS!=='function'||
    typeof backend.exchangeCode!=='function')
    throw Error('OIDC_CALLBACK_CONFIGURATION_DENIED');
  const readAttempt=backend.readAttempt.bind(backend);
  const consumeAttemptCAS=backend.consumeAttemptCAS.bind(backend);
  const exchangeCode=backend.exchangeCode.bind(backend);

  return async (untrusted:unknown,now:number):Promise<VerifiedProviderSubject|null>=>{
    if(!Number.isSafeInteger(now)||now<0)return null;
    const input=ownFieldSnapshot(untrusted,['code','state'],true);
    if(!input||
       typeof input.code!=='string'||!/^.{1,2048}$/.test(input.code)||
       /[\u0000-\u001f\u007f]/.test(input.code)||
       typeof input.state!=='string'||!(/^[A-Za-z0-9_-]{32,256}$/).test(input.state))
      return null;
    const {code,state}=input;
    try{
      const attempt=await readAttempt(state);
      // A backend row may be mutable after awaited D1/PKCE or CAS calls.
      // Snapshot all verified attempt authority fields BEFORE first PKCE await.
      const frozen=ownFieldSnapshot(attempt,[
        'state','codeVerifier','codeChallenge','nonce','provider','clientId',
        'appId','environment','expiresAt','consumedAt',
      ]);
      if(!frozen)return null;
      const tx=frozen as unknown as OAuthAttempt;
      if(tx.state!==state||tx.provider!==config.provider||
        tx.clientId!==config.clientId||tx.appId!==appId||
        tx.environment!==environment||tx.consumedAt!==null||
        !Number.isSafeInteger(tx.expiresAt)||tx.expiresAt<=now||
        !await verifyPkceS256(tx.codeVerifier,tx.codeChallenge))return null;
      // Only a real, scoped, unconsumed, PKCE-valid attempt may fetch JWKS.
      // Wrong/random/replayed state never consumes Google public-key traffic.
      let verificationProvider=config;
      if(getVerificationProvider){
        const fresh=await getVerificationProvider();
        if(!fresh||fresh.provider!==config.provider||
          fresh.clientId!==config.clientId||fresh.issuer!==config.issuer||
          !Array.isArray(fresh.jwks)||fresh.jwks.length<1||fresh.jwks.length>8)
          return null; // Fail closed without static-key fallback.
        verificationProvider={
          provider:config.provider,clientId:config.clientId,issuer:config.issuer,
          jwks:fresh.jwks.map(jwk=>({...jwk,key_ops:jwk.key_ops?[...jwk.key_ops]:undefined})),
        };
      }
      // OIDC Discovery/JWKS and PKCE may have awaited long enough to expire
      // this OAuth attempt. Never consume it using the callback-entry clock.
      const beforeConsume=getTrustedNow?getTrustedNow():now;
      if(!Number.isSafeInteger(beforeConsume)||beforeConsume<now||
         beforeConsume>=tx.expiresAt)return null;
      // One-winner atomic consume before exchanging. Use exactly the state,
      // provider, verifier and code that were just checked (never re-read).
      if(!await consumeAttemptCAS(tx.state,tx.provider,beforeConsume))return null;
      const exchange=await exchangeCode({
        provider:tx.provider,code,clientId:tx.clientId,verifier:tx.codeVerifier,
      });
      // Google may take seconds to return its ID Token. A token expired
      // during that await MUST NOT be checked against the original time.
      const atVerification=getTrustedNow?getTrustedNow():now;
      if(!Number.isSafeInteger(atVerification)||
         atVerification<beforeConsume||atVerification>=tx.expiresAt)
        return null;
      return exchange && await verifySignedOidcIdToken(exchange.idToken,{
        issuer:verificationProvider,nonce:tx.nonce,now:atVerification,
      });
    }catch{return null;}
  };
}
