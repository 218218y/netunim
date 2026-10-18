import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaSearchModel} from '../netunim-kupa/site/assets/js/domains/search/model.js';

test('search uses only the requested read capabilities and preserves domain navigation identities', () => {
  const calls = [];
  const state = {bank: {feed: {transactions: [{id: 'bank-row', amount: 2}]}}, cash: [{id: 'cash-row', type: 'income', amount: 3}]};
  const before = structuredClone(state);
  const search = createKupaSearchModel({
    credit: {
      monthlyDetail: value => {assert.equal(value, state); calls.push('credit'); return {months: [{key: '2026-10', items: [{source: 'manual', description: 'credit-row', amount: 4}]}]};},
      itemIdentity: () => 'credit-navigation-id', providerLabels: {},
    },
    bank: {transactionIdentity: (row, role, index) => {calls.push(['bank', row.id, role, index]); return 'bank-navigation-id';}},
    cash: {typeLabel: (collection, type) => {calls.push(['cash', collection, type]); return 'income-label';}},
  });
  assert.deepEqual(search.buildKupaSearchFragment(state, 'notes'), []);
  assert.deepEqual(calls, []);
  assert.equal(search.buildKupaSearchFragment(state, 'bank')[0].id, 'bank-navigation-id');
  assert.equal(search.buildKupaSearchFragment(state, 'credit')[0].id, 'credit-navigation-id');
  assert.equal(search.buildKupaSearchFragment(state, 'cash')[0].title, 'income-label');
  assert.deepEqual(calls, [['bank', 'bank-row', 'business', 0], 'credit', ['cash', 'cash', 'income']]);
  assert.deepEqual(state, before);
});
