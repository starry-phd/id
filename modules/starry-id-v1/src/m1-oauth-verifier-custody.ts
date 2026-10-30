/** AI-1 M1: authenticated at-rest custody for OAuth PKCE verifier.
 * Storage is untrusted. Key material and key rotation remain server-owned.
 * This is not a production key-manager or an OAuth callback HTTP route.
 */
export const M1_PKCE_SEALED_FORMAT = 'm1gcm1' as const;
export type M1VerifierBinding=Readonly<{
  state:string;provider:'apple'|'google';clientId:string;
  appId:string;environment:'development'|'staging';expiresAt:number;
}>;
export type M1VerifierCustody=Readonly<{
  seal:(verifier:string,binding:M1VerifierBinding)=>Promise<string|null>;
  open:(stored:string,binding:M1VerifierBinding)=>Promise<string|null>;
}>;
type KeyRecord=Readonly<{kid:string;key:CryptoKey}>;
type Dependencies=Readonly<{
  activeKey:()=>Promise<KeyRecord|null>;
  findKey:(kid:string)=>Promise<CryptoKey|null>;
  /** Only injectable for in-process deterministic tests; production uses WebCrypto. */
  randomBytes?:(length:number)=>Uint8Array;
}>;
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const safeId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v);
function validBinding(b:M1VerifierBinding):boolean{
  return b&&/^[A-Za-z0-9_-]{32,256}$/.test(b.state)&&
    ['apple','google'].includes(b.provider)&&safeId(b.clientId)&&
    b.appId==='starry-id'&&['development','staging'].includes(b.environment)&&
    Number.isSafeInteger(b.expiresAt)&&b.expiresAt>0;
}
function validKey(key:unknown,usage:'encrypt'|'decrypt'):key is CryptoKey{
  return key instanceof CryptoKey && !key.extractable &&
    key.algorithm.name==='AES-GCM' &&
    ('length' in key.algorithm) && key.algorithm.length===256 &&
    key.usages.includes(usage);
}
function bytes(value:Uint8Array):ArrayBuffer{
  const copy=new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return copy;
}
function encode64(b:Uint8Array):string{
  let raw='';for(const c of b)raw+=String.fromCharCode(c);
  return btoa(raw).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
}
function decode64(value:string):Uint8Array{
  if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length>512||value.length%4===1)
    throw Error('M1_PKCE_FORMAT_DENIED');
  const raw=atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4));
  const out=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(encode64(out)!==value)throw Error('M1_PKCE_FORMAT_DENIED');
  return out;
}
function associatedData(b:M1VerifierBinding):Uint8Array{
  return encoder.encode(JSON.stringify([
    M1_PKCE_SEALED_FORMAT,'starry',b.appId,b.environment,b.provider,
    b.clientId,b.state,b.expiresAt,
  ]));
}
function secureBytes(n:number):Uint8Array{
  const out=new Uint8Array(n);crypto.getRandomValues(out);return out;
}
export function createM1OAuthVerifierCustody(deps:Dependencies):M1VerifierCustody{
  if(!deps||typeof deps.activeKey!=='function'||typeof deps.findKey!=='function')
    throw Error('M1_PKCE_CUSTODY_CONFIGURATION_DENIED');
  const random=deps.randomBytes??secureBytes;
  return Object.freeze({
    async seal(verifier:string,binding:M1VerifierBinding):Promise<string|null>{
      try{
        if(typeof verifier!=='string'|| !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||
          !validBinding(binding))return null;
        const active=await deps.activeKey();
        if(!active||!safeId(active.kid)||!validKey(active.key,'encrypt'))return null;
        const iv=random(12);
        if(!(iv instanceof Uint8Array)||iv.byteLength!==12)return null;
        const cipher=await crypto.subtle.encrypt({
          name:'AES-GCM',iv:bytes(iv),additionalData:bytes(associatedData(binding)),tagLength:128,
        },active.key,encoder.encode(verifier));
        return [M1_PKCE_SEALED_FORMAT,active.kid,encode64(iv),encode64(new Uint8Array(cipher))].join('.');
      }catch{return null;}
    },
    async open(stored:string,binding:M1VerifierBinding):Promise<string|null>{
      try{
        if(typeof stored!=='string'||stored.length>512||!validBinding(binding))return null;
        const parts=stored.split('.');
        if(parts.length!==4||parts[0]!==M1_PKCE_SEALED_FORMAT||!safeId(parts[1]))return null;
        const iv=decode64(parts[2]),cipher=decode64(parts[3]);
        if(iv.byteLength!==12||cipher.byteLength<59||cipher.byteLength>144)return null;
        const key=await deps.findKey(parts[1]);
        if(!validKey(key,'decrypt'))return null;
        const plain=await crypto.subtle.decrypt({
          name:'AES-GCM',iv:bytes(iv),additionalData:bytes(associatedData(binding)),tagLength:128,
        },key,bytes(cipher));
        const value=decoder.decode(plain);
        return /^[A-Za-z0-9._~-]{43,128}$/.test(value)?value:null;
      }catch{return null;}
    },
  });
}
