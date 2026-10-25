import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const reviewed=JSON.parse(readFileSync(new URL('./fixtures/typed-financial-model-policies.json',import.meta.url),'utf8'));
// Keep the historical policies intact. Only the individually reviewed equivalent
// model declarations can change; unexpected additions/removals still fail equality.
export function typedFinancialPolicies(expected,group){
  const result={...expected};
  for(const [name,{before,after}] of Object.entries(reviewed[group])){
    if(before===null)assert.equal(Object.hasOwn(result,name),false,name);
    else assert.equal(result[name],before,name);
    result[name]=after;
  }
  return result;
}
