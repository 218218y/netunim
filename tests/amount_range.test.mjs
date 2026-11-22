import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmountRangeMatcher,createAmountRangeSearch,amountRangeMarkup} from '../shared/search.js';
test('movement ranges include endpoints, cents, debits/refunds and independent open bounds',()=>{
  const within=createAmountRangeMatcher('150','250');
  for(const amount of [-150,150,-200,250])assert.equal(within(amount),true);
  for(const amount of [-149.99,250.01,null,undefined,''])assert.equal(within(amount),false);
  assert.equal(createAmountRangeMatcher('0','0')(0),true);
  assert.equal(createAmountRangeMatcher('150','')(-300),true);
  assert.equal(createAmountRangeMatcher('','250')(-100),true);
  assert.equal(createAmountRangeMatcher('','')(null),true);
  for(const [from,to] of [['250','150'],['invalid',''],['-1','250']])assert.equal(createAmountRangeMatcher(from,to)(200),false);
  const markup=amountRangeMarkup({action:'credit-amount',from:'150.25',to:'250.75',escapeHtml:x=>x});
  assert.match(markup,/data-change="credit-amount-from"/);
  assert.match(markup,/data-input="credit-amount-from"/);
  assert.equal((markup.match(/step="1" inputmode="decimal"/g)||[]).length,2);
  assert.match(markup,/value="150\.25"/);assert.match(markup,/value="250\.75"/);
  const decimal=createAmountRangeMatcher('150.25','250.75');
  assert.equal(decimal(150.25),true);
  assert.equal(decimal(150.24),false);
});

test('range input shares the text search schedule and ignores duplicate or incomplete edits',()=>{
  const ui={bankSearchValue:'הפקדה'},calls=[],active=[];
  const toggle={classList:{toggle:(name,value)=>active.push([name,value])}};
  const input={value:'200',validity:{badInput:false},closest:()=>({querySelector:()=>toggle})};
  const range=createAmountRangeSearch(ui,'bank',(...args)=>calls.push(args));
  range.from(input);range.from(input);
  assert.equal(ui.bankAmountFrom,'200');
  assert.deepEqual(calls,[['הפקדה',input]]);
  input.value='';input.validity.badInput=true;range.from(input);
  assert.equal(ui.bankAmountFrom,'200');
  input.validity.badInput=false;range.from(input);
  assert.equal(ui.bankAmountFrom,'');
  assert.deepEqual(active,[['active',true],['active',false]]);
  assert.equal(calls.length,2);
});
