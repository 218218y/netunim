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
  assert.match(amountRangeMarkup({action:'credit-amount',escapeHtml:x=>x}),/data-change="credit-amount-from"/);
});
