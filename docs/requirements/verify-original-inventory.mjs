import fs from 'node:fs';
const inv=JSON.parse(fs.readFileSync(new URL('./original-inventory.v0.json',import.meta.url),'utf8'));
const bad=msg=>{throw new Error(msg);};
if(inv.coverage!=='master_heading_index_complete_only')bad('coverage assertion');
if(!Array.isArray(inv.entries)||inv.entries.length!==128)bad('not 128 headings');
const ids=new Set();
const count={legacy_function:0,admin_prep:0,new_architecture_rule:0};
for(const item of inv.entries){
 if(!/^(?:[0-9]{2}[.][0-9]{2}|P[0-9]{2}|N[0-9]{2})$/.test(item.id))bad('bad id '+item.id);
 if(ids.has(item.id))bad('duplicate '+item.id);
 ids.add(item.id);
 if(!item.title||item.review_state!=='not_reconciled'||!item.source_url)bad('bad source-only row '+item.id);
 if(!Object.hasOwn(count,item.section))bad('bad section '+item.id);
 count[item.section]++;
}
if(count.legacy_function!==108||count.admin_prep!==10||count.new_architecture_rule!==10)bad('incorrect section counts');
const seed=JSON.parse(fs.readFileSync(new URL('./registry.v0.json',import.meta.url),'utf8'));
if(seed.coverage!=='seed_only')bad('seed registry has unexpected coverage - review inventory transition');
if(!seed.features.some(x=>x.id==='ID-S-001'&&x.status==='approved'))bad('Starry member service missing');
if(!seed.features.some(x=>x.id==='ID-H-001'&&x.status==='approved'))bad('H-Global member service missing');
console.log('Source heading index validated: 108 original features + 10 admin-prep + 10 architecture items = 128. Official seed registry unaffected.');
