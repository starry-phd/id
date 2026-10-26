import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {X509Certificate,sign} from 'node:crypto';
import {createPinnedNodeApplePkiCandidate} from '../src/apple-pki-node.mjs';
import {verifyAppleSandboxSignedTransaction} from '../src/sandbox-providers.ts';
const folder=mkdtempSync(join(tmpdir(),'ai2-apple-x5c-'));
after(()=>rmSync(folder,{recursive:true,force:true}));
const path=name=>join(folder,name);
const openssl=(...args)=>execFileSync('openssl',args,{cwd:folder,stdio:'pipe'});
const getCert=name=>new X509Certificate(readFileSync(path(name),'utf8'));
const b64=name=>getCert(name).raw.toString('base64');
const now=Date.now();
function setup(){
 openssl('req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes',
  '-keyout','root.key','-out','root.crt','-days','2','-subj','/CN=FixtureRoot',
  '-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
 openssl('req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes',
  '-keyout','int.key','-out','int.csr','-subj','/CN=FixtureIntermediate');
 writeFileSync(path('int.ext'),'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=ASN1:NULL\n');
 openssl('x509','-req','-in','int.csr','-CA','root.crt','-CAkey','root.key',
  '-CAcreateserial','-out','int.crt','-days','2','-extfile','int.ext');
 openssl('req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes',
  '-keyout','leaf.key','-out','leaf.csr','-subj','/CN=FixtureLeaf');
 writeFileSync(path('leaf.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=ASN1:NULL\n');
 openssl('x509','-req','-in','leaf.csr','-CA','int.crt','-CAkey','int.key',
  '-CAcreateserial','-out','leaf.crt','-days','2','-extfile','leaf.ext');
 writeFileSync(path('wrong.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature\n');
 openssl('x509','-req','-in','leaf.csr','-CA','int.crt','-CAkey','int.key',
  '-CAcreateserial','-out','wrong.crt','-days','2','-extfile','wrong.ext');
}
setup();
const x5c=[b64('leaf.crt'),b64('int.crt'),b64('root.crt')];
const rootDer=getCert('root.crt').raw;
function trust(extra={}){
 const flags={count:0,revoked:false,...extra};
 const service=createPinnedNodeApplePkiCandidate({
  appleRootDer:rootDer,serverNowMs:()=>flags.time??Date.now(),
  verifyOcspEvidence:async()=>{
   flags.count++;
   return flags.revoked?{outcome:'revoked',validUntilMs:Date.now()+500000}
    :{outcome:'good',validUntilMs:Date.now()+300000};
  },
 });
 return {service,flags};
}
test('X509 pinned root validates leaf/intermediate certificate and Apple OIDs',async()=>{
 const t=trust();const key=await t.service.trustedAppleLeafKey(x5c);
 assert.equal(key.type,'public');assert.equal(key.algorithm.name,'ECDSA');
 assert.equal(t.flags.count,1);
});
test('Apple JWS signature verified with ephemeral pinned PKI, no fixtures trusted by default',async()=>{
 const header={alg:'ES256',x5c},payload={
  environment:'Sandbox',bundleId:'phd.starry.test',productId:'test.monthly',
  originalTransactionId:'o_123',transactionId:'t_123',appAccountToken:'bind_123',
  signedDate:now,purchaseDate:now-1000,expiresDate:now+80000000,
 };
 const b64url=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const input=b64url(header)+'.'+b64url(payload);
 const sig=sign('sha256',Buffer.from(input),{
  key:readFileSync(path('leaf.key')),dsaEncoding:'ieee-p1363'});
 const t=trust();
 const value=await verifyAppleSandboxSignedTransaction(input+'.'+sig.toString('base64url'),{
  brandId:'starry',appId:'starry.test',environment:'staging',storeEnvironment:'sandbox',
  store:'apple',storeAppId:'phd.starry.test',catalog:{'test.monthly':'subscription'},
 },t.service);
 assert.equal(value.state,'PAID');assert.equal(value.accountBinding,'bind_123');
});
test('untrusted root, chain truncation, missing purpose OID deny before revocation',async()=>{
 const t=trust();
 await assert.rejects(t.service.trustedAppleLeafKey(x5c.slice(0,2)),/APPLE_X5C_DENIED/);
 await assert.rejects(t.service.trustedAppleLeafKey([x5c[0],x5c[1],x5c[1]]),/APPLE_ROOT_UNTRUSTED/);
 await assert.rejects(t.service.trustedAppleLeafKey([b64('wrong.crt'),x5c[1],x5c[2]]),
  /APPLE_CERT_PURPOSE_DENIED/);
 assert.equal(t.flags.count,0);
});
test('expired certificate, revoked and missing OCSP evidence fail closed',async()=>{
 await assert.rejects(trust({time:Date.now()+3*86400000}).service.trustedAppleLeafKey(x5c),/APPLE_CERT_EXPIRED/);
 await assert.rejects(trust({revoked:true}).service.trustedAppleLeafKey(x5c),/APPLE_REVOCATION_UNVERIFIED/);
 const noOcsp=createPinnedNodeApplePkiCandidate({
  appleRootDer:rootDer,serverNowMs:()=>Date.now(),
  verifyOcspEvidence:async()=>{throw new Error('unavailable');},
 });
 await assert.rejects(noOcsp.trustedAppleLeafKey(x5c),/APPLE_REVOCATION_UNVERIFIED/);
});
test('certificate root from client is never its own trust anchor',async()=>{
 assert.throws(()=>createPinnedNodeApplePkiCandidate({
  appleRootDer:getCert('leaf.crt').raw,serverNowMs:()=>Date.now(),
  verifyOcspEvidence:async()=>({outcome:'good',validUntilMs:Date.now()+1000}),
 }),/APPLE_ROOT_DENIED/);
});
