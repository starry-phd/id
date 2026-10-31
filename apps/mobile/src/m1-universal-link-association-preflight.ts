/**
 * M1 Starry-only Universal Link / Android App Link SOURCE preflight.
 *
 * Pure, offline and deny-by-default. It compares the Expo source configuration
 * with supplied association documents. It neither fetches the real HTTPS
 * documents nor proves domain ownership, OS verification, device install,
 * signing identity custody or release authorization.
 */
export const M1_LINK_ASSOCIATION_PREFLIGHT_LIVE=false as const;
export const M1_LINK_ASSOCIATION_PREFLIGHT_CONTRACT=
 'starry.ai0.m1.link-association-source-preflight.v1' as const;

type Input=Readonly<{
 appReturnUri:string;
 expoConfig:unknown;
 iosTeamId:string;
 iosBundleId:string;
 androidPackageName:string;
 androidSigningCertSha256:string;
 appleAppSiteAssociation:unknown;
 androidAssetLinks:unknown;
}>;
type Reason='RETURN_URI_INVALID'|'APP_IDENTITY_INVALID'|'EXPO_APP_IDENTITY_MISMATCH'|
 'EXPO_IOS_ASSOCIATED_DOMAIN_MISSING'|'EXPO_ANDROID_INTENT_FILTER_MISSING'|
 'AASA_EXACT_PATH_MISSING'|'ASSETLINKS_EXACT_APP_MISSING';
const obj=(x:unknown):Record<string,unknown>|null=>
 x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null;
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[];
const strings=(x:unknown):string[]=>arr(x).filter((v):v is string=>typeof v==='string');
const fingerprint=/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const bundle=/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const team=/^[A-Z0-9]{10}$/;
// AASA "paths" and "components" are ordered first-match rules, not a
// bag of positive entries. A preceding exclusion or broad rule may override
// a later exact allow. Keep this source preflight deliberately conservative:
// an ambiguous rule cannot establish the pinned callback's exact association.
type AasaDecision='allow'|'deny'|'none';
const matchesAasaPattern=(value:unknown,path:string):boolean=>{
 if(typeof value!=='string'||value.length>256)return false;
 const pattern='^'+[...value].map(ch=>
  ch==='*'?'.*':ch==='?'?'.':'.^$+()[]{}|\\'.includes(ch)?'\\'+ch:ch
 ).join('')+'

export function checkM1UniversalLinkAssociationPreflight(input:Input){
 const reasons:Reason[]=[];
 const add=(code:Reason)=>{if(!reasons.includes(code))reasons.push(code);};
 let url:URL|null=null;
 try{
  if(typeof input?.appReturnUri!=='string')throw Error('invalid');
  const parsed=new URL(input.appReturnUri);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||
    parsed.search||parsed.hash||parsed.port||parsed.pathname==='/'||
    parsed.href!==input.appReturnUri||parsed.hostname.includes('*'))
   throw Error('invalid');
  url=parsed;
 }catch{add('RETURN_URI_INVALID');}
 const validIds=typeof input?.iosTeamId==='string'&&team.test(input.iosTeamId)&&
  typeof input?.iosBundleId==='string'&&bundle.test(input.iosBundleId)&&
  typeof input?.androidPackageName==='string'&&bundle.test(input.androidPackageName)&&
  typeof input?.androidSigningCertSha256==='string'&&
  fingerprint.test(input.androidSigningCertSha256);
 if(!validIds)add('APP_IDENTITY_INVALID');
 const expo=obj(input?.expoConfig);
 const config=obj(expo?.expo)??expo;
 const ios=obj(config?.ios);
 const android=obj(config?.android);
 if(!validIds||ios?.bundleIdentifier!==input.iosBundleId||
   android?.package!==input.androidPackageName)
  add('EXPO_APP_IDENTITY_MISMATCH');
 const host=url?.hostname??'';
 const path=url?.pathname??'';
 if(!url||!strings(ios?.associatedDomains).includes('applinks:'+host))
  add('EXPO_IOS_ASSOCIATED_DOMAIN_MISSING');
 const filters=arr(android?.intentFilters);
 const androidFilterPresent=!!url&&filters.some(item=>{
  const filter=obj(item);
  return filter?.action==='VIEW'&&filter.autoVerify===true&&
   strings(filter.category).includes('BROWSABLE')&&
   strings(filter.category).includes('DEFAULT')&&
   arr(filter.data).some(d=>{
    const x=obj(d);
    return x?.scheme==='https'&&x.host===host&&x.path===path&&
     x.pathPrefix===undefined&&x.pathPattern===undefined;
   });
 });
 if(!androidFilterPresent)add('EXPO_ANDROID_INTENT_FILTER_MISSING');
 const details=arr(obj(obj(input?.appleAppSiteAssociation)?.applinks)?.details);
 const appId=input?.iosTeamId+'.'+input?.iosBundleId;
 let aasaDecision:AasaDecision='none';
 if(url&&validIds)for(const item of details){
  const x=obj(item);if(!x)continue;
  const identities=[...(typeof x.appID==='string'?[x.appID]:[]),...strings(x.appIDs)];
  const decision=firstAasaDecision(x,path);
  if(decision==='none')continue;
  // A preceding positive association for a different app is not proof
  // the OS will route this exact link to the configured Starry app.
  aasaDecision=identities.includes(appId)?decision:'deny';
  break;
 }
 if(aasaDecision!=='allow')add('AASA_EXACT_PATH_MISSING');
 const androidExact=!!url&&validIds&&arr(input?.androidAssetLinks).some(item=>{
  const x=obj(item);const target=obj(x?.target);
  return strings(x?.relation).includes('delegate_permission/common.handle_all_urls')&&
   target?.namespace==='android_app'&&target.package_name===input.androidPackageName&&
   strings(target.sha256_cert_fingerprints).includes(input.androidSigningCertSha256);
 });
 if(!androidExact)add('ASSETLINKS_EXACT_APP_MISSING');
 return Object.freeze({
  contract:M1_LINK_ASSOCIATION_PREFLIGHT_CONTRACT,
  source_only:true as const,
  live_enabled:M1_LINK_ASSOCIATION_PREFLIGHT_LIVE,
  source_config_consistent:reasons.length===0,
  remote_https_verified:false as const,
  ios_device_verified:false as const,
  android_device_verified:false as const,
  release_gate_satisfied:false as const,
  reasons:Object.freeze(reasons),
 });
}
;
 return new RegExp(pattern).test(path);
};
const firstAasaDecision=(entry:Record<string,unknown>,path:string):AasaDecision=>{
 const modern=Array.isArray(entry.components);
 if(modern&&Array.isArray(entry.paths))return 'deny';
 const rules=arr(modern?entry.components:entry.paths);
 for(const rule of rules){
  if(modern){
   const component=obj(rule);
   if(!component||typeof component['/']!=='string')return 'deny';
   if(!matchesAasaPattern(component['/'],path))continue;
   if(component['?']!==undefined||component['#']!==undefined||
      component.caseSensitive===false||component.percentEncoded===false||
      (component.exclude!==undefined&&component.exclude!==false))
    return 'deny';
   return component['/']===path?'allow':'deny';
  }
  if(typeof rule!=='string')return 'deny';
  const excluded=rule.startsWith('NOT ');
  const pattern=excluded?rule.slice(4):rule;
  if(!matchesAasaPattern(pattern,path))continue;
  return !excluded&&pattern===path?'allow':'deny';
 }
 return 'none';
};

export function checkM1UniversalLinkAssociationPreflight(input:Input){
 const reasons:Reason[]=[];
 const add=(code:Reason)=>{if(!reasons.includes(code))reasons.push(code);};
 let url:URL|null=null;
 try{
  if(typeof input?.appReturnUri!=='string')throw Error('invalid');
  const parsed=new URL(input.appReturnUri);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||
    parsed.search||parsed.hash||parsed.port||parsed.pathname==='/'||
    parsed.href!==input.appReturnUri||parsed.hostname.includes('*'))
   throw Error('invalid');
  url=parsed;
 }catch{add('RETURN_URI_INVALID');}
 const validIds=typeof input?.iosTeamId==='string'&&team.test(input.iosTeamId)&&
  typeof input?.iosBundleId==='string'&&bundle.test(input.iosBundleId)&&
  typeof input?.androidPackageName==='string'&&bundle.test(input.androidPackageName)&&
  typeof input?.androidSigningCertSha256==='string'&&
  fingerprint.test(input.androidSigningCertSha256);
 if(!validIds)add('APP_IDENTITY_INVALID');
 const expo=obj(input?.expoConfig);
 const config=obj(expo?.expo)??expo;
 const ios=obj(config?.ios);
 const android=obj(config?.android);
 if(!validIds||ios?.bundleIdentifier!==input.iosBundleId||
   android?.package!==input.androidPackageName)
  add('EXPO_APP_IDENTITY_MISMATCH');
 const host=url?.hostname??'';
 const path=url?.pathname??'';
 if(!url||!strings(ios?.associatedDomains).includes('applinks:'+host))
  add('EXPO_IOS_ASSOCIATED_DOMAIN_MISSING');
 const filters=arr(android?.intentFilters);
 const androidFilterPresent=!!url&&filters.some(item=>{
  const filter=obj(item);
  return filter?.action==='VIEW'&&filter.autoVerify===true&&
   strings(filter.category).includes('BROWSABLE')&&
   strings(filter.category).includes('DEFAULT')&&
   arr(filter.data).some(d=>{
    const x=obj(d);
    return x?.scheme==='https'&&x.host===host&&x.path===path&&
     x.pathPrefix===undefined&&x.pathPattern===undefined;
   });
 });
 if(!androidFilterPresent)add('EXPO_ANDROID_INTENT_FILTER_MISSING');
 const details=arr(obj(obj(input?.appleAppSiteAssociation)?.applinks)?.details);
 const appId=input?.iosTeamId+'.'+input?.iosBundleId;
 const aasaExact=!!url&&validIds&&details.some(item=>{
  const x=obj(item);if(!x)return false;
  const identities=[...(typeof x.appID==='string'?[x.appID]:[]),...strings(x.appIDs)];
  if(!identities.includes(appId))return false;
  const directPaths=strings(x.paths).some(p=>isExactPath(p,path));
  const componentPaths=arr(x.components).some(component=>{
   const c=obj(component);
   return c?.exclude!==true&&c?.['?']===undefined&&c?.['#']===undefined&&
    isExactPath(c?.['/'],path);
  });
  return directPaths||componentPaths;
 });
 if(!aasaExact)add('AASA_EXACT_PATH_MISSING');
 const androidExact=!!url&&validIds&&arr(input?.androidAssetLinks).some(item=>{
  const x=obj(item);const target=obj(x?.target);
  return strings(x?.relation).includes('delegate_permission/common.handle_all_urls')&&
   target?.namespace==='android_app'&&target.package_name===input.androidPackageName&&
   strings(target.sha256_cert_fingerprints).includes(input.androidSigningCertSha256);
 });
 if(!androidExact)add('ASSETLINKS_EXACT_APP_MISSING');
 return Object.freeze({
  contract:M1_LINK_ASSOCIATION_PREFLIGHT_CONTRACT,
  source_only:true as const,
  live_enabled:M1_LINK_ASSOCIATION_PREFLIGHT_LIVE,
  source_config_consistent:reasons.length===0,
  remote_https_verified:false as const,
  ios_device_verified:false as const,
  android_device_verified:false as const,
  release_gate_satisfied:false as const,
  reasons:Object.freeze(reasons),
 });
}
