import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertEntityCollection} from '../shared/data-invariants.js';
import {validateCustomerDebtProgress} from '../shared/customer-debt-progress.js';
import {assertValidOrderCloudState,validOrderCloudState} from '../netunim-orders/site/assets/js/state/validation.js';

const base=()=>Object.fromEntries(['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryCategoryOrder','inventoryEvents','warehouseOrders','notes'].map(key=>[key,[]]));
const workbook=()=>({sheets:[{id:'S',name:'Sheet'}],columns:[{id:'C',sheetId:'S'}],rows:[{id:'R',sheetId:'S'}]});

test('Orders cloud admission validates document identities, workbook parents and debt evidence without replacing the input',()=>{
  const state={...base(),notesSheet:workbook(),customerDebts:[{id:'D',amount:-100,debtProgress:[{id:'P',kind:'payment',amount:25}]}]};
  assert.equal(assertValidOrderCloudState(state),state);
  assert.equal(validOrderCloudState(state),true);
  assert.equal(validOrderCloudState({...base(),notesSheet:undefined}),true);
  for(const bad of [null,[],true,{},{...state,checks:[]},{...state,inventoryCategoryOrder:'bad'},
    {...state,suppliers:[{id:1}]},{...state,notes:[{id:'N'},{id:'N'}]},
    {...state,notesSheet:{...workbook(),rows:[{id:'R',sheetId:'missing'}]}},
    {...state,notesSheet:{...workbook(),sheets:[{id:'S',name:' '}]}},
    {...state,customerDebts:[{id:'D',debtProgress:[{id:'P',kind:'bank',amount:25}]}]},
    {...state,customerDebts:[{id:'D',debtProgress:[{id:'R',kind:'payment',action:'reset',clears:['P'],amount:1}]}]},
  ]){
    assert.equal(validOrderCloudState(bad),false);
    assert.throws(()=>assertValidOrderCloudState(bad),/invalid entity IDs or document shape/);
  }
});

async function mutant(relative,from,to){
  const file=new URL(relative,import.meta.url),source=readFileSync(file,'utf8'),changed=source.replace(from,to);
  assert.notEqual(changed,source,from);
  const absolute=changed.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_all,_quote,target)=>`from ${JSON.stringify(new URL(target,file).href)}`);
  return import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'));
}
test('runtime mutations cannot silently remove document, identity or debt admission checks',async()=>{
  const invalid={...base(),inventoryCategoryOrder:'bad'};
  assert.throws(()=>assertValidOrderCloudState(invalid));
  const document=await mutant('../netunim-orders/site/assets/js/state/validation.js','if(!validOrderCloudState(d))','if(false)');
  assert.equal(document.assertValidOrderCloudState(invalid),invalid);
  const duplicate=[{id:'D'},{id:'D'}];assert.throws(()=>assertEntityCollection(duplicate,'rows'));
  const entities=await mutant('../shared/data-invariants.js','if(seen.has(id))','if(false)');
  assert.equal(entities.assertEntityCollection(duplicate,'rows'),duplicate);
  const debt={debtProgress:[{id:'P',kind:'bank',amount:25}]};assert.throws(()=>validateCustomerDebtProgress(debt));
  const progress=await mutant('../shared/customer-debt-progress.js','if(!PROGRESS_KINDS.has(row.kind))','if(false)');
  assert.equal(progress.validateCustomerDebtProgress(debt),debt);
});
