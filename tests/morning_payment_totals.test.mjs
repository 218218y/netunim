import test from 'node:test';
import assert from 'node:assert/strict';
import {morningPaymentTotalCents} from '../netunim-orders/site/assets/js/domains/customers/morning-payments.js';

test('Morning payment totals are summed in integer agorot',()=>{
  assert.equal(morningPaymentTotalCents([{price:10.01},{price:'20.02'},{price:0},{price:''}]),3003);
  assert.equal(morningPaymentTotalCents([{price:0.1},{price:0.2}]),30);
  assert.equal(morningPaymentTotalCents([{price:-10},{price:'bad'},{}]),0);
});
