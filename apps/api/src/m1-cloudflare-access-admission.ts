/**
 * Source-only M1 Cloudflare Access TESTER admission before Google OAuth state.
 *
 * Cloudflare's Cf-Access-Jwt-Assertion is an UNTRUSTED HTTP header until its
 * RS256 signature, exact team issuer, application AUD, token type, time and
 * signed invitee subject are verified against the pinned team's HTTPS JWKS.
 *
 * This does not configure Cloudflare Access or add a public Worker route.
 * The real Access application/policy, ingress enforcement and reviewer
 * evidence remain external deployment prerequisites; default OFF.
 *
 * Official docs:
 * https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 * https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/
 */
export const M1_CF_ACCESS_ADMISSION_LIVE=false as const;
export type M1CfAccessAdmissionConfig=Readonly<{
 enabled?:boolean;
 environment:'staging';
 /** Owner-verified: https://<team>.cloudflareaccess.com */
 teamDomain:string;
 /** Owner-verified Access application AUD; NEVER taken from HTTP. */
 applicationAud:string;
 /** Only explicitly invited, signed Access SUB values; not email headers. */
 allowedSubjects:readonly string[];
 /** Trusted server fetch, never a caller-controlled URL. */
 transport:(url:string,init:RequestInit)=>Promise<Response>;
 /** Trusted server clock, Unix seconds. */
 now:()=>number;
}>;

const decoder=new TextDecoder('utf-8',{fatal:true});
const encoder=new TextEncoder();
const data=(v:unknown):v is Record<string,unknown>=>
 v!==null&&typeof v==='object'&&!Array.isArray(v);
const subjectPattern=/^[A-Za-z0-9._@:-]{1,256}$/;
const audPattern=/^[A-Za-z0-9_-]{16,128}$/;
const b64Pattern=/^[A-Za-z0-9_-]+$/;
const validClock=(v:unknown):v is number=>
 typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function bytesToB64(v:Uint8Array):string {
 let raw='';for(const n of v)raw+=String.fromCharCode(n);
 return btoa(raw).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function decode(raw:string,limit:number):Uint8Array {
 if(typeof raw!=='string'||raw.length<1||raw.length>limit||
   !b64Pattern.test(raw)||raw.length%4===1)throw Error('BAD_B64');
 const decoded=atob(raw.replace(/-/g,'+').replace(/_/g,'/')+
   '='.repeat((4-raw.length%4)%4));
 const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
 if(bytesToB64(bytes)!==raw)throw Error('BAD_B64');
 return bytes;
}
function parsed(raw:string,limit:number):Record<string,unknown> {
 const bytes=decode(raw,limit);
 const value:unknown=JSON.parse(decoder.decode(bytes));
 if(!data(value))throw Error('BAD_JSON');
 return value;
}
function teamOrigin(input:string):string{
 let url:URL;
 try{url=new URL(input);}catch{throw Error('M1_CF_ACCESS_CONFIGURATION_DENIED');}
 if(url.protocol!=='https:'||!/^[-a-z0-9]{1,63}\.cloudflareaccess\.com$/.test(url.hostname)||
   url.username||url.password||url.port||url.pathname!=='/'||
   url.search||url.hash||url.href!==url.origin+'/')
  throw Error('M1_CF_ACCESS_CONFIGURATION_DENIED');
 return url.origin;
}
function accessHeader(token:unknown):{parts:string[];kid:string}|null {
 try{
  if(typeof token!=='string'||token.length<80||token.length>10000)return null;
  const parts=token.split('.');
  if(parts.length!==3)return null;
  const h=parsed(parts[0],1024);
  if(Object.keys(h).some(k=>!['alg','kid','typ'].includes(k))||
     h.alg!=='RS256'||(h.typ!==undefined&&h.typ!=='JWT')||
     typeof h.kid!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(h.kid))
   return null;
  decode(parts[1],6144);decode(parts[2],2048);
  return {parts,kid:h.kid};
 }catch{return null;}
}
async function boundedCerts(response:Response,url:string):Promise<unknown>{
 if(response.status!==200||response.redirected||
   (response.url!==''&&response.url!==url)||
   !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i
    .test(response.headers.get('content-type')??''))return null;
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d{1,6}$/.test(length)||Number(length)>32768))return null;
 if(!response.body)return null;
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];
 let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array))return null;
   total+=value.byteLength;
   if(total>32768){await reader.cancel();return null;}
   chunks.push(value);
  }
 }catch{return null;}finally{reader.releaseLock();}
 const combined=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(decoder.decode(combined)) as unknown;}
 catch{return null;}
}
async function trustedAccessKey(body:unknown,kid:string):Promise<CryptoKey|null>{
 if(!data(body)||!Array.isArray(body.keys)||
   body.keys.length<1||body.keys.length>16)return null;
 let chosen:Record<string,unknown>|null=null;
 for(const item of body.keys as unknown[]){
  if(!data(item))return null;
  if(item.kid===kid){
   if(chosen)return null;
   chosen=item;
  }
 }
 if(!chosen||chosen.kty!=='RSA'||chosen.kid!==kid||
   (chosen.alg!==undefined&&chosen.alg!=='RS256')||
   (chosen.use!==undefined&&chosen.use!=='sig')||
   (chosen.key_ops!==undefined&&(!Array.isArray(chosen.key_ops)||
     chosen.key_ops.length!==1||chosen.key_ops[0]!=='verify'))||
   Object.keys(chosen).some(k=>['d','p','q','dp','dq','qi','oth','k'].includes(k))||
   typeof chosen.n!=='string'||!/^[A-Za-z0-9_-]{250,900}$/.test(chosen.n)||
   typeof chosen.e!=='string'||!/^[A-Za-z0-9_-]{2,12}$/.test(chosen.e))
  return null;
 try{
  const key=await crypto.subtle.importKey('jwk',{
   kty:'RSA',alg:'RS256',use:'sig',key_ops:['verify'],
   n:chosen.n,e:chosen.e,
  },{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(key.type!=='public'||key.extractable||!key.usages.includes('verify')||
    (key.algorithm as RsaHashedKeyAlgorithm).modulusLength<2048)return null;
  return key;
 }catch{return null;}
}
function validClaims(body:Record<string,unknown>,issuer:string,aud:string,
 subjects:ReadonlySet<string>,now:number):boolean{
 if(body.iss!==issuer||body.type!=='app'||
   !Array.isArray(body.aud)||body.aud.length!==1||body.aud[0]!==aud||
   typeof body.sub!=='string'||!subjects.has(body.sub)||
   !validClock(body.iat)||!validClock(body.exp)||
   (body.nbf!==undefined&&!validClock(body.nbf)))return false;
 const issued=body.iat as number,expires=body.exp as number;
 return issued<=now+30&&expires>now&&expires>issued&&
   expires-issued<=86400&&now-issued<=86400&&
   (body.nbf===undefined||(body.nbf as number)<=now);
}
/** Validates Access app token only, never trusts unsigned email/identity headers. */
export function createM1CloudflareAccessAdmission(config:M1CfAccessAdmissionConfig){
 if(!config||config.environment!=='staging'||
   (config.enabled!==undefined&&typeof config.enabled!=='boolean')||
   !audPattern.test(config.applicationAud)||
   !Array.isArray(config.allowedSubjects)||config.allowedSubjects.length<1||
   config.allowedSubjects.length>32||
   config.allowedSubjects.some(s=>typeof s!=='string'||!subjectPattern.test(s))||
   new Set(config.allowedSubjects).size!==config.allowedSubjects.length||
   typeof config.transport!=='function'||typeof config.now!=='function')
  throw Error('M1_CF_ACCESS_CONFIGURATION_DENIED');
 const issuer=teamOrigin(config.teamDomain);
 const jwks=issuer+'/cdn-cgi/access/certs';
 const aud=config.applicationAud;
 const subjects=new Set<string>(config.allowedSubjects);
 const enabled=config.enabled===true;
 const transport=config.transport,now=config.now;
 return Object.freeze({
  contract:'starry.ai0.m1.cf-access-signed-tester-admission.v1' as const,
  source_only:true as const,live_enabled:M1_CF_ACCESS_ADMISSION_LIVE,
  async verify(request:Request):Promise<boolean>{
   if(!enabled||!(request instanceof Request))return false;
   const header=accessHeader(request.headers.get('cf-access-jwt-assertion'));
   if(!header)return false; // Reject forged identity headers before any fetch.
   const clock=now();
   if(!validClock(clock))return false;
   try{
    const response=await transport(jwks,{method:'GET',
     headers:{accept:'application/json'},credentials:'omit',
     cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
    const key=await trustedAccessKey(await boundedCerts(response,jwks),header.kid);
    if(!key)return false;
    const {parts}=header;
    const sig=decode(parts[2],2048);
    const signature=new ArrayBuffer(sig.length);
    new Uint8Array(signature).set(sig);
    const verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
      key,signature,encoder.encode(parts[0]+'.'+parts[1]));
    if(!verified)return false;
    return validClaims(parsed(parts[1],6144),issuer,aud,subjects,clock);
   }catch{return false;} // No network/secret/provider errors returned to HTTP.
  },
 });
}
