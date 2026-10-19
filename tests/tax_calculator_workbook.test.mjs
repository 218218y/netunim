import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAnnual,createProfile} from '../shared/tax-calculator/contracts.js';
import {defaultRules} from '../shared/tax-calculator/rules.js';
import {calculateTax} from '../shared/tax-calculator/compute.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/tax-workbook-regression.json',import.meta.url),'utf8'));
for(const scenario of fixture.cases)test('original workbook formulas with synthetic inputs: '+scenario.label,()=>{
  const profile={...createProfile(),...scenario.profile};
  const input={...createAnnual(2026,profile,defaultRules()),...scenario.input};
  const computed=calculateTax(input);
  for(const [key,expected] of Object.entries(scenario.expected))assert.ok(Math.abs(computed.annual[key]-expected)<=5,`${key}: calculated ${computed.annual[key]}, formula ${expected}`);
});
