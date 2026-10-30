/** Starry AI-1 M1: trusted, opt-in Google authorization-code exchange only.
 * Nothing in this module registers an HTTP route or downloads JWKS. The
 * verified OIDC callback MUST verify the returned idToken signature/claims.
 */
import type {TrustedOAuthBackend} from './oidc-crypto.ts';

export const M1_GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token' as const;
export const M1_GOOGLE_EXCHANGE_LIVE_ENABLED = false as const;

type Params = Parameters<TrustedOAuthBackend['exchangeCode']>[0];
type Dependencies = Readonly<{
  enabled?:boolean;
  clientId:string;
  redirectUri:string;
  /** Only injected server-owned, secret-manager material; never client input. */
  readClientSecret:()=>Promise<string|null>;
  /** Injected trusted server transport, not an HTTP-user supplied function. */
  transport:(url:string,init:RequestInit)=>Promise<Response>;
}>;
const safeClientId = (v:unknown):v is string =>
  typeof v==='string' && /^[A-Za-z0-9._-]{5,180}$/.test(v);
const safeVerifier = (v:unknown):v is string =>
  typeof v==='string' && /^[A-Za-z0-9._~-]{43,128}$/.test(v);
const safeCode = (v:unknown):v is string =>
  typeof v==='string' && v.length>=1 && v.length<=2048 &&
  !/[\u0000-\u001f\u007f]/.test(v);

async function boundedResponse(response:Response):Promise<string|null>{
  const length=response.headers.get('content-length');
  if(length!==null && (!/^\d{1,8}$/.test(length)||Number(length)>16384))return null;
  if(!response.body)return null;
  const reader=response.body.getReader();
  const parts:Uint8Array[]=[];let count=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      count+=value.byteLength;
      if(count>16384){await reader.cancel();return null;}
      parts.push(value);
    }
    const buffer=new Uint8Array(count);let offset=0;
    for(const part of parts){buffer.set(part,offset);offset+=part.byteLength;}
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  }finally{reader.releaseLock();}
}

/** Must be injected explicitly by the approved server composition root. */
export function createM1GoogleCodeExchange(deps:Dependencies):TrustedOAuthBackend['exchangeCode']{
  if(!safeClientId(deps.clientId)||
    typeof deps.readClientSecret!=='function'||typeof deps.transport!=='function')
    throw Error('M1_GOOGLE_EXCHANGE_CONFIGURATION_DENIED');
  const clientId=deps.clientId;
  let redirect:URL;
  try{redirect=new URL(deps.redirectUri);}catch{throw Error('M1_GOOGLE_REDIRECT_DENIED');}
  if(redirect.protocol!=='https:'||redirect.username||redirect.password||
    redirect.search||redirect.hash||redirect.pathname==='/'||
    redirect.href!==deps.redirectUri)
    throw Error('M1_GOOGLE_REDIRECT_DENIED');
  const redirectUri=redirect.href;
  const enabled=deps.enabled===true;
  return async (input:Params):Promise<{idToken:string}|null>=>{
    if(!enabled||!input||input.provider!=='google'||input.clientId!==clientId||
      !safeCode(input.code)||!safeVerifier(input.verifier))return null;
    try{
      const secret=await deps.readClientSecret();
      if(typeof secret!=='string'||secret.length<8||secret.length>1024||
        /[\u0000-\u001f\u007f]/.test(secret))return null;
      const form=new URLSearchParams({
        grant_type:'authorization_code',code:input.code,client_id:clientId,
        client_secret:secret,redirect_uri:redirectUri,code_verifier:input.verifier,
      });
      const response=await deps.transport(M1_GOOGLE_TOKEN_ENDPOINT,{
        method:'POST',body:form.toString(),
        headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8',accept:'application/json'},
        redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
      });
      if(response.status!==200||response.redirected||
        (response.url!==''&&response.url!==M1_GOOGLE_TOKEN_ENDPOINT)||
        !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type')??''))return null;
      const raw=await boundedResponse(response);
      if(raw===null)return null;
      const value:unknown=JSON.parse(raw);
      if(!value||typeof value!=='object'||Array.isArray(value))return null;
      const token=(value as Record<string,unknown>).id_token;
      if(typeof token!=='string'||token.length<10||token.length>16000||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return null;
      // Never expose access_token, refresh_token, profile, scopes or errors.
      return Object.freeze({idToken:token});
    }catch{return null;} // No remote error, request or secret propagation.
  };
}
