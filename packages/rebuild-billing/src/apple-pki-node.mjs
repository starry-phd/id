/**
 * AI-2 Round5 NODE-ONLY Apple X.509 chain verifier candidate.
 * This is NOT a Cloudflare Workers-compatible implementation or an Apple
 * certificate source. AI-4 must bind separately-approved Apple Root DER and
 * implement authenticated, cryptographically-validated OCSP responder checks.
 * Never trust a root from the JWS x5c array as its own trust anchor.
 */
import {X509Certificate,timingSafeEqual,webcrypto} from 'node:crypto';

function guard(ok,code){if(!ok)throw new Error(code);}
function fail(code){throw new Error(code);}
function tlv(bytes,offset){
  guard(offset>=0&&offset<bytes.length,'APPLE_DER_DENIED');
  const tag=bytes[offset];let pos=offset+1;
  guard(pos<bytes.length,'APPLE_DER_DENIED');
  let size=bytes[pos++];
  if(size&128){
    const n=size&127;
    guard(n>=1&&n<=3&&pos+n<=bytes.length,'APPLE_DER_DENIED');
    size=0;
    for(let i=0;i<n;i++)size=size*256+bytes[pos++];
    guard(size>=128,'APPLE_DER_DENIED');
  }
  guard(pos+size<=bytes.length,'APPLE_DER_DENIED');
  return {tag,start:offset,value:pos,end:pos+size};
}
function parts(bytes,item){
  const out=[];
  for(let at=item.value;at<item.end;){
    const part=tlv(bytes,at);out.push(part);at=part.end;
    guard(out.length<=64,'APPLE_DER_DENIED');
  }
  return out;
}
function oid(bytes,item){
  guard(item.tag===0x06,'APPLE_DER_DENIED');
  let value=0;const arcs=[];
  for(let i=item.value;i<item.end;i++){
    value=value*128+(bytes[i]&127);
    guard(Number.isSafeInteger(value),'APPLE_DER_DENIED');
    if(!(bytes[i]&128)){arcs.push(value);value=0;}
  }
  guard(value===0&&arcs.length>0,'APPLE_DER_DENIED');
  const first=arcs.shift();
  const major=first>=80?2:Math.floor(first/40);
  const minor=first>=80?first-80:first%40;
  return [major,minor,...arcs].join('.');
}
/** Parse the actual v3 X509 extensions field [3], NOT raw-byte substring OIDs. */
function hasCertExtension(cert,required){
  const bytes=cert.raw;
  const root=tlv(bytes,0);
  guard(root.tag===0x30&&root.end===bytes.length,'APPLE_DER_DENIED');
  const certificateParts=parts(bytes,root);
  const tbs=certificateParts[0];
  guard(tbs?.tag===0x30,'APPLE_DER_DENIED');
  const context=parts(bytes,tbs).find(p=>p.tag===0xa3);
  if(!context)return false;
  const outer=parts(bytes,context);
  if(outer.length!==1||outer[0].tag!==0x30)return false;
  const extensions=parts(bytes,outer[0]);
  return extensions.some(ext=>{
    if(ext.tag!==0x30)return false;
    const fields=parts(bytes,ext);
    return fields[0]?.tag===0x06&&oid(bytes,fields[0])===required
      &&fields.some(field=>field.tag===0x04);
  });
}
function base64Cert(value){
  guard(typeof value==='string'&&value.length>64&&value.length<=8192
    &&/^[A-Za-z0-9+/]+={0,2}$/.test(value),'APPLE_X5C_DENIED');
  const bytes=Buffer.from(value,'base64');
  guard(bytes.length>0&&bytes.toString('base64')===value,'APPLE_X5C_DENIED');
  return new X509Certificate(bytes);
}
function dateValid(cert,at){
  return Number.isFinite(at)&&at>=Date.parse(cert.validFrom)&&at<=Date.parse(cert.validTo);
}
export function createPinnedNodeApplePkiCandidate({
  appleRootDer,serverNowMs,verifyOcspEvidence,
}){
  guard((appleRootDer instanceof Uint8Array||Buffer.isBuffer(appleRootDer))
    &&typeof serverNowMs==='function'&&typeof verifyOcspEvidence==='function',
    'APPLE_TRUST_BINDING_REQUIRED');
  const root=new X509Certificate(appleRootDer);
  guard(root.ca===true&&root.subject===root.issuer&&root.verify(root.publicKey),
    'APPLE_ROOT_DENIED');
  // The root is pinned by the server. Never obtain the trusted root from x5c.
  const anchor=Buffer.from(root.raw);
  return Object.freeze({
    async trustedAppleLeafKey(x5c){
      guard(Array.isArray(x5c)&&x5c.length===3,'APPLE_X5C_DENIED');
      const [leaf,intermediate,receivedRoot]=x5c.map(base64Cert);
      guard(anchor.length===receivedRoot.raw.length
        &&timingSafeEqual(anchor,receivedRoot.raw),'APPLE_ROOT_UNTRUSTED');
      const now=serverNowMs();
      guard(Number.isSafeInteger(now)&&now>0,'APPLE_TRUST_CLOCK_DENIED');
      guard([leaf,intermediate,root].every(c=>dateValid(c,now)),'APPLE_CERT_EXPIRED');
      guard(leaf.ca===false&&intermediate.ca===true&&root.ca===true,
        'APPLE_CA_DENIED');
      guard(leaf.issuer===intermediate.subject && intermediate.issuer===root.subject
        &&leaf.verify(intermediate.publicKey)&&intermediate.verify(root.publicKey),
        'APPLE_CHAIN_SIGNATURE_DENIED');
      guard(hasCertExtension(leaf,'1.2.840.113635.100.6.11.1')
        &&hasCertExtension(intermediate,'1.2.840.113635.100.6.2.1'),
        'APPLE_CERT_PURPOSE_DENIED');
      const leafKey=leaf.publicKey;
      guard(leafKey.asymmetricKeyType==='ec'
        &&leafKey.asymmetricKeyDetails?.namedCurve==='prime256v1',
        'APPLE_LEAF_KEY_DENIED');
      // An actual OCSP verifier MUST validate signed response, cert serial/issuer,
      // nonce/freshness and responder trust; callback merely models that boundary.
      // Unreachable/revoked/unknown cannot be treated as clean.
      let status;
      try{status=await verifyOcspEvidence({leaf,intermediate,root,at:now});}
      catch{fail('APPLE_REVOCATION_UNVERIFIED');}
      guard(status?.outcome==='good'
        &&Number.isSafeInteger(status.validUntilMs)
        &&status.validUntilMs>=now&&status.validUntilMs<=now+24*60*60*1000,
        'APPLE_REVOCATION_UNVERIFIED');
      return webcrypto.subtle.importKey('spki',leafKey.export({type:'spki',format:'der'}),
        {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    },
  });
}
