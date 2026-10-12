import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaDashboardCapability} from '../netunim-kupa/site/assets/js/composition/dashboard.js';
import {createKupaBankQueries} from '../netunim-kupa/site/assets/js/composition/bank-queries.js';

test('Dashboard construction and binding are inert, validated and single use', () => {
  const unexpected = () => assert.fail('composition performed IO or read unhydrated business state');
  let subscribed = 0, released = 0;
  const cap = createKupaDashboardCapability({model:{state:null}, ui:{currentPage:'cash'}, runFinance:unexpected, touchRevision:unexpected,
    access:{current:unexpected, subscribe:() => { subscribed++; return () => { released++; }; }},
    remote:{readMeta:unexpected, readDocument:unexpected}, platform:{isOnline:unexpected, clock:unexpected}});
  const bank = Object.fromEntries(['balance','asOfDate','forecast','projectedBalance','longTermPosition'].map(name => [name, unexpected]));
  const view = {bank, checks:{active:unexpected, deposited:unexpected}, localBankSnapshot:unexpected};
  assert.throws(() => cap.runtime.start(), /view_not_bound/);
  assert.throws(() => cap.bindView({...view, bank:{}}), /balance_required/);
  cap.bindView(view);
  assert.equal(cap.assertReady(), true);
  assert.throws(() => cap.bindView(view), /already_bound/);
  assert.equal(subscribed, 0);
  assert.equal(cap.queries.ordersSummary(), null);
  assert.equal('view' in cap, false); assert.equal('controller' in cap, false);
  assert.equal(cap.runtime.start(), true); assert.equal(cap.runtime.start(), false);
  assert.equal(subscribed, 1);
  assert.equal(cap.runtime.stop(), true); assert.equal(cap.runtime.stop(), false);
  assert.equal(released, 1);
  assert.equal(cap.runtime.start(), true);
  assert.equal(cap.runtime.dispose(), true); assert.equal(cap.runtime.dispose(), false);
  assert.equal(released, 2);
  assert.equal(cap.presentation.renderDashboard(), false);
  assert.throws(() => cap.runtime.start(), /disposed/);
});

test('Bank queries preserve independent account balances, dates and authoritative model replacement', () => {
  const model = {state:null}, checksSession = {sharedChecksBankEvents:[]};
  const bank = createKupaBankQueries({model, checksSession});
  assert.equal(model.state, null);
  model.state = {bank:{currentBalance:1000, asOfDate:'2026-10-10', adjustments:[{amount:20},{type:'check_deposit',amount:200}],
    snapshotSeq:9, homeFeed:{balance:500, syncedAt:'2026-10-11T00:00:00Z'}}};
  assert.equal(bank.balance('business'), 1020);
  assert.equal(bank.balance('home'), 500);
  assert.equal(bank.asOfDate('business'), '2026-10-10');
  assert.equal(bank.asOfDate('home'), '2026-10-11');
  assert.equal(bank.observedCheckSequence(), 9);
  model.state = {bank:{currentBalance:null, homeFeed:{balance:700}}};
  assert.equal(bank.balance('business'), null);
  assert.equal(bank.balance('home'), 700);
  for (const method of ['balance','asOfDate','forecast','projectedBalance']) assert.throws(() => bank[method]('unknown'), /account_required/);
});
