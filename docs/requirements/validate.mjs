import fs from 'node:fs';
const file=new URL('./registry.v0.json',import.meta.url);
const doc=JSON.parse(fs.readFileSync(file,'utf8'));
const fail=message=>{throw Error(message)};
if(doc.coverage!=='seed_only'&&doc.coverage!=='complete')fail('invalid coverage');
if(!Array.isArray(doc.features)||doc.features.length===0)fail('empty registry');
const ids=new Set(),allowed=new Set(['approved','candidate','deferred','rejected','superseded']);
const brands=new Set(['starry','hglobal','both']);
const owners=new Set(['AI-0','AI-1','AI-2','AI-3','AI-4']);
for(const [index,feature] of doc.features.entries()){
  const field=(k)=>typeof feature[k]==='string'&&feature[k].length>0;
  if(!field('id')||!field('summary')||!field('decision_source'))fail('required metadata at '+index);
  if(ids.has(feature.id))fail('duplicate id '+feature.id);
  ids.add(feature.id);
  if(!allowed.has(feature.status)||!brands.has(feature.brand)||!owners.has(feature.owner))fail('bad status, brand or owner '+feature.id);
  if(!['not_started','draft','ci_verified','merged','deployed'].includes(feature.implementation))fail('invalid implementation '+feature.id);
  if(!Array.isArray(feature.depends_on))fail('missing dependencies '+feature.id);
}
for(const feature of doc.features)for(const dependency of feature.depends_on)if(!ids.has(dependency))fail('missing dependency '+feature.id+' -> '+dependency);
const starry=doc.features.find(f=>f.id==='ID-S-001');
const hglobal=doc.features.find(f=>f.id==='ID-H-001');
if(starry?.brand!=='starry'||starry.status!=='approved'||hglobal?.brand!=='hglobal'||hglobal.status!=='approved')fail('separate ID services must remain explicit');
if(doc.coverage==='complete'&&doc.features.length<50)fail('seed registry cannot claim full coverage without traceability');
console.log('requirements registry validated:',doc.features.length,'seed entries; coverage:',doc.coverage);
