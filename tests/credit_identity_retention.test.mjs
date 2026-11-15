import {mergeCreditMonthSnapshot} from '../shared/credit-month-integrity.js';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCreditSync as kupa,mergeCreditSyncResult as mergeKupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {normalizeCreditSync as orders,mergeCreditSyncResult as mergeOrders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
const profile=(profileId,id)=>({profileId,provider:'max',ownerLabel:'Same owner',accounts:[{accountNumber:'1234',months:[{month:'2020-01',fetchStatus:'success',transactions:[{id,date:'2020-01-01',processedDate:'2020-01-10',chargedAmount:-100,originalAmount:-100,originalCurrency:'ILS',chargedCurrency:'ILS'}]}]}]});
for(const [name,normalize,merge] of [['kupa',kupa,mergeKupa],['orders',orders,mergeOrders]]){
 test(name+' shared owner/issuer/card suffix does not authorize dropping another profile history',()=>{
  const input={version:4,profiles:[profile('first','A'),profile('second','B')],cardMappings:{'first:1234':{included:true,account:'עסקי'},'second:1234':{included:true,account:'ביתי'}}};
  const result=normalize(input);
  assert.equal(result.profiles.length,2);
  assert.deepEqual(result.profiles.flatMap(p=>p.accounts.flatMap(a=>a.months.flatMap(m=>m.transactions.map(t=>t.id)))).sort(),['A','B']);
  assert.equal(result.cardMappings['first:1234'].account,'עסקי');assert.equal(result.cardMappings['second:1234'].account,'ביתי');
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(result))),result);
 });
 test(name+' a newly observed different profile cannot inherit another card inclusion or role',()=>{
  const base=normalize({version:4,profiles:[profile('first','A')],cardMappings:{'first:1234':{included:true,account:'ביתי'}}});
  const next=merge(base,{profiles:[{...profile('import:other','B'),coreComplete:true}],errors:[]});
  assert.equal(next.profiles.length,2);assert.equal(next.cardMappings['import:other:1234'].included,false);
  assert.equal(next.cardMappings['first:1234'].account,'ביתי');
 });
}

for(const file of ['netunim-kupa/site/assets/js/domains/credit/sync-feed.js','netunim-orders/site/assets/js/domains/finance/credit-feed.js'])test(file+' identity guard mutation reproduces silent same-month loss',async()=>{
  const url=new URL('../'+file,import.meta.url),guard='return !!a?.profileId&&a.profileId===b?.profileId;';
  let source=readFileSync(url,'utf8');assert.equal(source.split(guard).length,2);
  source=source.replace(guard,'return true;').replace(/from (['"])(\.[^'"]+)\1/g,(_,quote,path)=>'from '+JSON.stringify(new URL(path,url).href));
  const mutated=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const result=mutated.normalizeCreditSync({version:4,profiles:[profile('first','A'),profile('second','B')]});
  assert.equal(result.profiles.length,1);assert.equal(result.profiles[0].accounts[0].months[0].transactions.length,1);
});

for(const [observed,billing] of [['2026-10-31T22:30:00Z','2026-11-01'],['2026-12-31T22:30:00Z','2027-01-01'],['2024-02-28T22:30:00Z','2024-02-29']])test('Jerusalem billing day is protected before UTC midnight: '+billing,()=>{
 const prior={month:billing.slice(0,7),tier:'core',status:'fresh',fetchStatus:'success',fetchedAt:observed,lastErrorCode:'',lastErrorAt:null,transactions:[{id:'same-day',status:'completed',date:billing,processedDate:billing+'T00:00:00Z',chargedAmount:-100}]};
 const next=mergeCreditMonthSnapshot(prior,{...prior,transactions:[]},observed);
 assert.equal(next.transactions.length,1);assert.equal(next.fetchStatus,'schema_error');
});
