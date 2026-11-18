import test from 'node:test';
import assert from 'node:assert/strict';
import {amountRangeMatch,amountRangeMarkup} from '../shared/search.js';
test('movement ranges include endpoints, cents, debits/refunds and independent open bounds',()=>{
  for(const amount of [-150,150,-200,250])assert.equal(amountRangeMatch(amount,'150','250'),true);
  for(const amount of [-149.99,250.01,null,undefined,''])assert.equal(amountRangeMatch(amount,'150','250'),false);
  assert.equal(amountRangeMatch(0,'0','0'),true);
  assert.equal(amountRangeMatch(-300,'150',''),true);
  assert.equal(amountRangeMatch(-100,'','250'),true);
  assert.equal(amountRangeMatch(null,'',''),true);
  for(const [from,to] of [['250','150'],['invalid',''],['-1','250']])assert.equal(amountRangeMatch(200,from,to),false);
  const markup=amountRangeMarkup({action:'credit-amount',from:'150.25',to:'250.75',escapeHtml:x=>x});
  assert.match(markup,/data-change="credit-amount-from"/);
  assert.equal((markup.match(/step="1" inputmode="decimal"/g)||[]).length,2);
  assert.match(markup,/value="150\.25"/);assert.match(markup,/value="250\.75"/);
  assert.equal(amountRangeMatch(150.25,'150.25','250.75'),true);
  assert.equal(amountRangeMatch(150.24,'150.25','250.75'),false);
});
